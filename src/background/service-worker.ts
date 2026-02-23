import { PORT_NAME, DEFAULT_ANTHROPIC_CONFIG } from '@/shared/constants';
import type { RequestMessage, ResponseMessage, PortMessage, ProviderConfig, AnnotationRequest, MemoryPromptFragment } from '@/shared/types';
import { anthropicProvider } from './llm/anthropic';
import { sessionTracker } from './memory/session-tracker';
import { getMemoryContext } from './memory/memory-retriever';
import { profileManager } from './memory/profile-manager';
import { readingGraph } from './memory/reading-graph';
import { usageTracker } from './usage-tracker';

console.log('Marginalia service worker started');

async function getProviderConfig(): Promise<ProviderConfig> {
  const result = await chrome.storage.local.get(['apiKey', 'model', 'baseUrl']);
  return {
    apiKey: result.apiKey || '',
    model: result.model || DEFAULT_ANTHROPIC_CONFIG.model,
    baseUrl: result.baseUrl || DEFAULT_ANTHROPIC_CONFIG.baseUrl,
  };
}

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

    const { url, title, text, selectedText, modes } = msg.payload;

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
        sessionTracker.startSession(tabId, url, title, modes);
      }

      // Get memory context
      const memoryContext = await getMemoryContext(url, title, text, tabId);

      const request: AnnotationRequest = {
        pageContent: text,
        selectedText,
        modes,
        memoryContext,
        url,
        title,
      };

      const { usage } = await anthropicProvider.streamAnnotations(
        request,
        config,
        (annotation) => {
          // Track annotation in session
          if (tabId) {
            sessionTracker.addAnnotation(tabId, annotation);
          }
          port.postMessage({ type: 'ANNOTATION_CHUNK', payload: { annotation } });
        },
      );

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

// Track tab closures for session endings
chrome.tabs.onRemoved.addListener(async (tabId) => {
  const session = sessionTracker.getSession(tabId);
  if (session) {
    await endSession(tabId);
  }
});

async function endSession(tabId: number) {
  const session = sessionTracker.endSession(tabId);
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
      const pageText = session.annotations.map((a) => a.content).join(' ');
      const summary = await anthropicProvider.generatePageSummary(pageText, session.title, config);

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

