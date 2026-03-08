import { PORT_NAME } from '@/shared/constants';
import type { AnnotationRequest, PortMessage, RequestMessage, ResponseMessage, SessionState } from '@/shared/types';
import { createLlmService } from './llm/flows';
import { getProviderDescriptor } from './llm/provider-registry';
import { getProvidersState, hasProviderCredentials, resolveProviderConfig } from './llm/provider-storage';
import { sessionTracker } from './memory/session-tracker';
import { getMemoryContext } from './memory/memory-retriever';
import { profileManager } from './memory/profile-manager';
import { readingGraph } from './memory/reading-graph';
import { usageTracker } from './usage-tracker';

console.log('Marginalia service worker started');

const SESSION_IDLE_ALARM = 'marginalia-session-idle-check';
const SESSION_IDLE_CHECK_PERIOD_MINUTES = 5;

const llmService = createLlmService();

async function getActiveProviderContext() {
  const providersState = await getProvidersState();
  const config = resolveProviderConfig(providersState);
  const descriptor = getProviderDescriptor(config.providerId);

  return { providersState, config, descriptor };
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

function registerListeners() {
  ensureSessionIdleAlarm();

  chrome.runtime.onInstalled.addListener(() => {
    ensureSessionIdleAlarm();
  });

  chrome.runtime.onMessage.addListener((
    message: RequestMessage,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response: ResponseMessage) => void,
  ) => {
    (async () => {
      try {
        switch (message.type) {
          case 'TEST_CONNECTION': {
            await llmService.testConnection(message.payload.config);
            sendResponse({
              type: 'ANNOTATIONS_READY',
              payload: { annotations: [], usage: { inputTokens: 0, outputTokens: 0 } },
            });
            break;
          }

          case 'SAVE_ANNOTATION': {
            sendResponse({
              type: 'ANNOTATIONS_READY',
              payload: { annotations: [], usage: { inputTokens: 0, outputTokens: 0 } },
            });
            break;
          }

          case 'RECORD_INTERACTION': {
            const tabId = sender.tab?.id;
            if (tabId) {
              sessionTracker.recordInteraction(tabId, message.payload.interaction);
            }

            sendResponse({
              type: 'ANNOTATIONS_READY',
              payload: { annotations: [], usage: { inputTokens: 0, outputTokens: 0 } },
            });
            break;
          }

          default:
            sendResponse({ type: 'ERROR', payload: { message: 'Unknown message type', code: 'UNKNOWN' } });
        }
      } catch (error) {
        sendResponse({
          type: 'ERROR',
          payload: {
            message: error instanceof Error ? error.message : String(error),
            code: 'INTERNAL',
          },
        });
      }
    })();

    return true;
  });

  chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== PORT_NAME) return;

    port.onMessage.addListener(async (message: PortMessage) => {
      if (message.type !== 'START_ANNOTATE') return;

      const { url, title, text } = message.payload;

      try {
        const { config, descriptor } = await getActiveProviderContext();

        if (!hasProviderCredentials(config)) {
          port.postMessage({
            type: 'STREAM_ERROR',
            payload: {
              message: `No API key configured. Set your ${descriptor.name} API key in the extension options.`,
              code: 'NO_API_KEY',
            },
          });
          return;
        }

        const tabId = port.sender?.tab?.id;
        if (tabId) {
          const existingSession = sessionTracker.getSession(tabId);
          if (existingSession && shouldFinalizeForUrlChange(existingSession.url, url)) {
            void persistSession(sessionTracker.endSession(tabId));
          }

          sessionTracker.startSession(tabId, url, title, text);
        }

        const memoryContext = await getMemoryContext(url, title, text, tabId);
        const request: AnnotationRequest = {
          pageContent: text,
          memoryContext,
          url,
          title,
        };

        const annotationPromise = llmService.streamAnnotations(request, config, (annotation) => {
          if (tabId) {
            sessionTracker.addAnnotation(tabId, annotation);
          }
          port.postMessage({ type: 'ANNOTATION_CHUNK', payload: { annotation } });
        });

        const summaryPromise = llmService.generatePageSummary(text, title, config)
          .then((summary) => {
            if (tabId) {
              sessionTracker.setPageSummary(tabId, summary);
            }
            port.postMessage({ type: 'PAGE_SUMMARY', payload: { summary: summary.summary } });
          })
          .catch((error) => {
            console.error('Marginalia: Summary generation failed:', error);
          });

        const [{ usage }] = await Promise.all([annotationPromise, summaryPromise]);
        await usageTracker.recordUsage({
          providerId: config.providerId,
          modelId: config.resolvedModel,
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          estimatedCost: descriptor.estimateCost(config, usage.inputTokens, usage.outputTokens),
        });

        port.postMessage({ type: 'STREAM_DONE', payload: { usage } });
      } catch (error) {
        port.postMessage({
          type: 'STREAM_ERROR',
          payload: {
            message: error instanceof Error ? error.message : String(error),
            code: 'STREAM_FAILED',
          },
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
        .map((session) => endSession(session.tabId)),
    );
  });

  chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (!changeInfo.url) return;

    const session = sessionTracker.getSession(tabId);
    if (session && shouldFinalizeForUrlChange(session.url, changeInfo.url)) {
      void endSession(tabId);
    }
  });

  chrome.tabs.onRemoved.addListener(async (tabId) => {
    const session = sessionTracker.getSession(tabId);
    if (session) {
      await endSession(tabId);
    }
  });
}

async function endSession(tabId: number) {
  const session = sessionTracker.endSession(tabId);
  await persistSession(session);
}

export async function persistSession(session: SessionState | undefined) {
  if (!session || session.annotations.length === 0) return;

  try {
    const { config } = await getActiveProviderContext();
    if (!hasProviderCredentials(config)) return;

    const profile = await profileManager.getProfile();
    if (profile) {
      const updatedProfile = await llmService.updateReaderProfile(profile, session, config);
      await profileManager.saveProfile(updatedProfile);
    }

    try {
      const summary = session.pageSummary ??
        await llmService.generatePageSummary(session.pageContent, session.title, config);

      await readingGraph.addEntry({
        url: session.url,
        title: session.title,
        domain: new URL(session.url).hostname,
        readAt: new Date(session.startedAt).toISOString(),
        durationSeconds: Math.round((session.lastActiveAt - session.startedAt) / 1000),
        summary: summary.summary,
        keyClaims: summary.keyClaims,
        topics: summary.topics,
        savedAnnotations: session.annotations.filter((annotation) =>
          session.interactions.some((interaction) =>
            interaction.type === 'save' && interaction.annotationId === annotation.id,
          ),
        ),
      });
    } catch (error) {
      console.error('Marginalia: Error generating page summary:', error);
    }
  } catch (error) {
    console.error('Marginalia: Error ending session:', error);
  }
}

if (typeof chrome !== 'undefined' && chrome.runtime?.onInstalled) {
  registerListeners();
}
