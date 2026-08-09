import { PORT_NAME } from '@/shared/constants';
import type { AnnotationRequest, ContentMessage, PageSummaryV2, PortMessage, RequestMessage, ResponseMessage, SessionState } from '@/shared/types';
import { classifyContent } from '@/shared/classify-content';
import { createLlmService } from './llm/flows';
import { estimateProviderCost, saveProviderModelCatalog } from './llm/provider-model-catalog';
import { getProviderDescriptor } from './llm/provider-registry';
import { getProvidersState, hasProviderCredentials, resolveProviderConfig, resolveProviderConfigForModel } from './llm/provider-storage';
import { getAutoSummarizeSettings, saveAutoSummarizeSettings } from './settings/auto-summarize-storage';
import { normalizeSiteEntry } from '@/shared/site-match';
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

// Older graph entries store a plain markdown summary; flattening the sectioned
// summary keeps the retriever's prompt formatting working across both.
function flattenSummary(summary: PageSummaryV2): string {
  return summary.sections
    .map((section) => `**${section.heading}**\n${section.markdown}`)
    .join('\n\n');
}

function ensureSessionIdleAlarm() {
  chrome.alarms.create(SESSION_IDLE_ALARM, {
    periodInMinutes: SESSION_IDLE_CHECK_PERIOD_MINUTES,
  });
}

export async function handleActionClick(tab: chrome.tabs.Tab) {
  if (!tab.id) return;

  try {
    const { config } = await getActiveProviderContext();
    if (!hasProviderCredentials(config)) {
      chrome.runtime.openOptionsPage();
      return;
    }

    chrome.tabs.sendMessage(tab.id, { type: 'TOGGLE_ANNOTATIONS' } satisfies ContentMessage, () => {
      if (chrome.runtime.lastError) {
        console.warn('Marginalia: Unable to annotate this tab:', chrome.runtime.lastError.message);
      }
    });
  } catch (error) {
    console.error('Marginalia: Toolbar click failed:', error);
  }
}

function registerListeners() {
  ensureSessionIdleAlarm();

  chrome.runtime.onInstalled.addListener(() => {
    ensureSessionIdleAlarm();
  });

  chrome.action.onClicked.addListener((tab) => {
    void handleActionClick(tab);
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

          case 'LIST_MODELS': {
            const models = await llmService.listModels(message.payload.config);
            const normalizedModels = await saveProviderModelCatalog(message.payload.config.providerId, models);
            sendResponse({
              type: 'MODEL_CATALOG',
              payload: { models: normalizedModels },
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

          case 'ADD_AUTO_SITE': {
            const normalized = normalizeSiteEntry(message.payload.hostname);
            if (normalized) {
              const settings = await getAutoSummarizeSettings();
              if (!settings.sites.includes(normalized)) {
                await saveAutoSummarizeSettings({
                  ...settings,
                  sites: [...settings.sites, normalized],
                });
              }
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

      const { url, title, text, metadata, mode } = message.payload;

      try {
        const { providersState, config: activeConfig, descriptor } = await getActiveProviderContext();

        let config = activeConfig;
        if (mode === 'summary-only') {
          const autoSettings = await getAutoSummarizeSettings();
          if (autoSettings.autoModelId) {
            config = resolveProviderConfigForModel(providersState, autoSettings.autoModelId);
          }
        }

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

        const annotationPromise = mode === 'full'
          ? llmService.streamAnnotations({
              pageContent: text,
              memoryContext,
              url,
              title,
            } satisfies AnnotationRequest, config, (annotation) => {
              if (tabId) {
                sessionTracker.addAnnotation(tabId, annotation);
              }
              port.postMessage({ type: 'ANNOTATION_CHUNK', payload: { annotation } });
            })
          : Promise.resolve(null);

        // A same-URL session may already carry a summary (auto-run before a
        // toolbar click) — replay it instead of paying for a second one.
        const existingSummary = tabId ? sessionTracker.getSession(tabId)?.pageSummary ?? null : null;

        let summaryPromise: Promise<{ inputTokens: number; outputTokens: number } | null>;
        if (existingSummary) {
          port.postMessage({ type: 'SUMMARY_META', payload: { contentType: existingSummary.contentType } });
          for (const section of existingSummary.sections) {
            port.postMessage({ type: 'SUMMARY_SECTION', payload: { section } });
          }
          port.postMessage({
            type: 'SUMMARY_DONE',
            payload: { keyClaims: existingSummary.keyClaims, topics: existingSummary.topics },
          });
          summaryPromise = Promise.resolve(null);
        } else {
          const summaryRequest = {
            text,
            title,
            url,
            metadata,
            contentType: classifyContent(metadata),
            memoryContext,
          };

          summaryPromise = llmService.streamPageSummary(summaryRequest, config, {
            onMeta: (contentType) => {
              port.postMessage({ type: 'SUMMARY_META', payload: { contentType } });
            },
            onSection: (section) => {
              port.postMessage({ type: 'SUMMARY_SECTION', payload: { section } });
            },
          })
            .then(({ summary, usage }) => {
              if (tabId) {
                sessionTracker.setPageSummary(tabId, summary);
              }
              port.postMessage({
                type: 'SUMMARY_DONE',
                payload: { keyClaims: summary.keyClaims, topics: summary.topics },
              });
              return usage;
            })
            .catch((error) => {
              console.error('Marginalia: Summary generation failed:', error);
              port.postMessage({
                type: 'SUMMARY_ERROR',
                payload: { message: error instanceof Error ? error.message : String(error) },
              });
              return null;
            });
        }

        const [annotationResult, summaryUsage] = await Promise.all([annotationPromise, summaryPromise]);
        const usage = {
          inputTokens: (annotationResult?.usage.inputTokens ?? 0) + (summaryUsage?.inputTokens ?? 0),
          outputTokens: (annotationResult?.usage.outputTokens ?? 0) + (summaryUsage?.outputTokens ?? 0),
        };
        if (annotationResult || summaryUsage) {
          await usageTracker.recordUsage({
            providerId: config.providerId,
            modelId: config.resolvedModel,
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
            estimatedCost: await estimateProviderCost(config, usage.inputTokens, usage.outputTokens),
          });
        }

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

    // Let the tab's content script re-evaluate auto-summarize for SPA
    // navigations that don't reload the page.
    chrome.tabs.sendMessage(
      tabId,
      { type: 'PAGE_NAVIGATED', payload: { url: changeInfo.url } } satisfies ContentMessage,
      () => {
        // Ignore tabs without the content script (chrome:// pages etc.).
        void chrome.runtime.lastError;
      },
    );
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
  if (!session) return;
  if (session.annotations.length === 0 && session.pageSummary === null) return;

  try {
    const { config } = await getActiveProviderContext();
    if (!hasProviderCredentials(config)) return;

    // Profile updates need interaction signal; summary-only visits shouldn't
    // spend a profile call or overwrite the profile from low-signal data.
    if (session.annotations.length > 0 || session.interactions.length > 0) {
      const profile = await profileManager.getProfile();
      if (profile) {
        const updatedProfile = await llmService.updateReaderProfile(profile, session, config);
        await profileManager.saveProfile(updatedProfile);
      }
    }

    try {
      const summary = session.pageSummary;

      await readingGraph.addEntry({
        url: session.url,
        title: session.title,
        domain: new URL(session.url).hostname,
        readAt: new Date(session.startedAt).toISOString(),
        durationSeconds: Math.round((session.lastActiveAt - session.startedAt) / 1000),
        summary: summary ? flattenSummary(summary) : '',
        keyClaims: summary?.keyClaims ?? [],
        topics: summary?.topics ?? [],
        contentType: summary?.contentType,
        sections: summary?.sections,
        savedAnnotations: session.annotations.filter((annotation) =>
          session.interactions.some((interaction) =>
            interaction.type === 'save' && interaction.annotationId === annotation.id,
          ),
        ),
      });
    } catch (error) {
      console.error('Marginalia: Error persisting reading graph entry:', error);
    }
  } catch (error) {
    console.error('Marginalia: Error ending session:', error);
  }
}

if (typeof chrome !== 'undefined' && chrome.runtime?.onInstalled) {
  registerListeners();
}
