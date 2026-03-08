import { PORT_NAME, DEFAULT_ANTHROPIC_CONFIG } from '@/shared/constants';
import type { AnnotationRequest, PortMessage, ProviderConfig, RequestMessage, ResponseMessage, SessionState } from '@/shared/types';
import { anthropicProvider } from './llm/anthropic';
import { sessionTracker } from './memory/session-tracker';
import { getMemoryContext } from './memory/memory-retriever';
import { profileManager } from './memory/profile-manager';
import { readingGraph } from './memory/reading-graph';
import { usageTracker } from './usage-tracker';

console.log('Marginalia service worker started');

const SESSION_IDLE_ALARM = 'marginalia-session-idle-check';
const SESSION_IDLE_CHECK_PERIOD_MINUTES = 5;

async function getProviderConfig(): Promise<ProviderConfig> {
  const result = await chrome.storage.local.get(['apiKey', 'model', 'baseUrl']);
  return {
    apiKey: result.apiKey || '',
    model: result.model || DEFAULT_ANTHROPIC_CONFIG.model,
    baseUrl: result.baseUrl || DEFAULT_ANTHROPIC_CONFIG.baseUrl,
  };
}

function normalizeSessionUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return url;
  }
}

function shouldFinalizeForUrlChange(currentUrl: string, nextUrl: string): boolean {
  return normalizeSessionUrl(currentUrl) !== normalizeSessionUrl(nextUrl);
}

function ensureSessionIdleAlarm() {
  chrome.alarms.create(SESSION_IDLE_ALARM, {
    periodInMinutes: SESSION_IDLE_CHECK_PERIOD_MINUTES,
  });
}

ensureSessionIdleAlarm();

chrome.runtime.onInstalled.addListener(() => {
  ensureSessionIdleAlarm();
});

// Handle one-shot messages
chrome.runtime.onMessage.addListener((
  message: RequestMessage,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response: ResponseMessage) => void
) => {
  (async () => {
    try {
      switch (message.type) {
        case 'TEST_CONNECTION': {
          const ok = await anthropicProvider.testConnection(message.payload.config);
          if (ok) {
            sendResponse({ type: 'ANNOTATIONS_READY', payload: { annotations: [], usage: { inputTokens: 0, outputTokens: 0 } } });
          } else {
            sendResponse({ type: 'ERROR', payload: { message: 'Connection failed', code: 'CONNECTION_FAILED' } });
          }
          break;
        }

        case 'SAVE_ANNOTATION': {
          // Will be handled by reading graph in Phase 7
          sendResponse({ type: 'ANNOTATIONS_READY', payload: { annotations: [], usage: { inputTokens: 0, outputTokens: 0 } } });
          break;
        }

        case 'RECORD_INTERACTION': {
          const tabId = sender.tab?.id;
          if (tabId) {
            sessionTracker.recordInteraction(tabId, message.payload.interaction);
          }
          sendResponse({ type: 'ANNOTATIONS_READY', payload: { annotations: [], usage: { inputTokens: 0, outputTokens: 0 } } });
          break;
        }

        default:
          sendResponse({ type: 'ERROR', payload: { message: 'Unknown message type', code: 'UNKNOWN' } });
      }
    } catch (err) {
      sendResponse({ type: 'ERROR', payload: { message: String(err), code: 'INTERNAL' } });
    }
  })();

  return true; // keep channel open for async
});

// Handle port-based streaming connections
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== PORT_NAME) return;

  port.onMessage.addListener(async (msg: PortMessage) => {
    if (msg.type !== 'START_ANNOTATE') return;

    const { url, title, text } = msg.payload;

    try {
      const config = await getProviderConfig();

      if (!config.apiKey) {
        port.postMessage({
          type: 'STREAM_ERROR',
          payload: { message: 'No API key configured. Set your Anthropic API key in the extension options.', code: 'NO_API_KEY' },
        });
        return;
      }

      // Track session
      const tabId = port.sender?.tab?.id;
      if (tabId) {
        const existingSession = sessionTracker.getSession(tabId);
        if (existingSession && shouldFinalizeForUrlChange(existingSession.url, url)) {
          void persistSession(sessionTracker.endSession(tabId));
        }

        sessionTracker.startSession(tabId, url, title, text);
      }

      // Get memory context
      const memoryContext = await getMemoryContext(url, title, text, tabId);

      const request: AnnotationRequest = {
        pageContent: text,
        memoryContext,
        url,
        title,
      };

      // Fire annotations and summary in parallel
      const annotationPromise = anthropicProvider.streamAnnotations(
        request,
        config,
        (annotation) => {
          if (tabId) {
            sessionTracker.addAnnotation(tabId, annotation);
          }
          port.postMessage({ type: 'ANNOTATION_CHUNK', payload: { annotation } });
        },
      );

      const summaryPromise = anthropicProvider.generatePageSummary(text, title, config)
        .then((result) => {
          if (tabId) {
            sessionTracker.setPageSummary(tabId, result);
          }
          port.postMessage({ type: 'PAGE_SUMMARY', payload: { summary: result.summary } });
        })
        .catch((err) => {
          console.error('Marginalia: Summary generation failed:', err);
        });

      const [{ usage }] = await Promise.all([annotationPromise, summaryPromise]);

      // Store usage
      await usageTracker.recordUsage(usage.inputTokens, usage.outputTokens);

      port.postMessage({ type: 'STREAM_DONE', payload: { usage } });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      port.postMessage({
        type: 'STREAM_ERROR',
        payload: { message, code: 'STREAM_FAILED' },
      });
    }
  });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== SESSION_IDLE_ALARM) return;

  void Promise.all(
    sessionTracker
      .getAllSessions()
      .filter((session) => sessionTracker.isIdle(session.tabId))
      .map((session) => endSession(session.tabId))
  );
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (!changeInfo.url) return;

  const session = sessionTracker.getSession(tabId);
  if (session && shouldFinalizeForUrlChange(session.url, changeInfo.url)) {
    void endSession(tabId);
  }
});

// Track tab closures for session endings
chrome.tabs.onRemoved.addListener(async (tabId) => {
  const session = sessionTracker.getSession(tabId);
  if (session) {
    await endSession(tabId);
  }
});

async function endSession(tabId: number) {
  const session = sessionTracker.endSession(tabId);
  await persistSession(session);
}

async function persistSession(session: SessionState | undefined) {
  if (!session || session.annotations.length === 0) return;

  try {
    const config = await getProviderConfig();
    if (!config.apiKey) return;

    // Update reader profile
    const profile = await profileManager.getProfile();
    if (profile) {
      const updated = await anthropicProvider.updateReaderProfile(profile, session, config);
      await profileManager.saveProfile(updated);
    }

    // Generate page summary and store in reading graph
    try {
      const summary = session.pageSummary ??
        await anthropicProvider.generatePageSummary(session.pageContent, session.title, config);

      await readingGraph.addEntry({
        url: session.url,
        title: session.title,
        domain: new URL(session.url).hostname,
        readAt: new Date(session.startedAt).toISOString(),
        durationSeconds: Math.round((session.lastActiveAt - session.startedAt) / 1000),
        summary: summary.summary,
        keyClaims: summary.keyClaims,
        topics: summary.topics,
        savedAnnotations: session.annotations.filter((a) =>
          session.interactions.some((i) => i.type === 'save' && i.annotationId === a.id)
        ),
      });
    } catch (summaryErr) {
      console.error('Marginalia: Error generating page summary:', summaryErr);
    }
  } catch (err) {
    console.error('Marginalia: Error ending session:', err);
  }
}
