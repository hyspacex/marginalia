import { render, h } from 'preact';
import { PORT_NAME, HIGHLIGHT_COLORS, CARD_CONFIG } from '@/shared/constants';
import type { Annotation, ContentType, PortMessage, ContentMessage, SessionMode, SummarySection } from '@/shared/types';
import { initAutoTrigger, type AutoTriggerController } from './auto/auto-trigger';
import { highlightManager } from './highlighter/highlight-manager';
import { HoverCard } from './card/HoverCard';
import { FloatingPill } from './pill/FloatingPill';
import { SummaryCard } from './summary/SummaryCard';
import { extractPageContent } from './extraction/readability';
import { collectPageMetadata } from './extraction/page-metadata';
import inlineCSS from './styles/inline.css?raw';

const HOST_ID = 'marginalia-host';
const HIGHLIGHT_STYLE_ID = 'marginalia-highlight-styles';

let annotating = false;

// --- State for Preact UI ---
interface UIState {
  annotations: Annotation[];
  loading: boolean;
  highlightsVisible: boolean;
  hoverAnnotation: Annotation | null;
  hoverRect: DOMRect | null;
  summarySections: SummarySection[];
  summaryContentType: ContentType | null;
  summaryError: string | null;
  summaryLoading: boolean;
  summaryPinned: boolean;
  summaryHoverActive: boolean;
}

let state: UIState = {
  annotations: [],
  loading: false,
  highlightsVisible: true,
  hoverAnnotation: null,
  hoverRect: null,
  summarySections: [],
  summaryContentType: null,
  summaryError: null,
  summaryLoading: false,
  summaryPinned: false,
  summaryHoverActive: false,
};

let renderUI: (() => void) | null = null;
let closeTimer: ReturnType<typeof setTimeout> | null = null;
let summaryCloseTimer: ReturnType<typeof setTimeout> | null = null;
let autoTrigger: AutoTriggerController | null = null;

function setState(partial: Partial<UIState>) {
  Object.assign(state, partial);
  renderUI?.();
}

function cancelSummaryClose() {
  if (summaryCloseTimer) {
    clearTimeout(summaryCloseTimer);
    summaryCloseTimer = null;
  }
}

function hasSummaryContent() {
  return state.summaryLoading || state.summarySections.length > 0 || state.summaryError !== null;
}

function showSummary() {
  if (!hasSummaryContent()) return;
  cancelSummaryClose();
  setState({ summaryHoverActive: true });
}

function scheduleSummaryClose() {
  cancelSummaryClose();
  if (state.summaryPinned) return;

  summaryCloseTimer = setTimeout(() => {
    setState({ summaryHoverActive: false });
    summaryCloseTimer = null;
  }, CARD_CONFIG.closeDelay);
}

function hideSummary() {
  cancelSummaryClose();
  setState({ summaryPinned: false, summaryHoverActive: false });
}

// --- Inject highlight styles into page <head> ---
function injectHighlightStyles() {
  if (document.getElementById(HIGHLIGHT_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = HIGHLIGHT_STYLE_ID;
  style.textContent = `
    ::highlight(marginalia) {
      background-color: ${HIGHLIGHT_COLORS.background};
      text-decoration: underline dotted;
      text-decoration-color: ${HIGHLIGHT_COLORS.underline};
    }
  `;
  document.head.appendChild(style);
}

// --- Shadow DOM host for card + pill ---
function injectHost() {
  if (document.getElementById(HOST_ID)) return;

  const host = document.createElement('div');
  host.id = HOST_ID;
  const shadow = host.attachShadow({ mode: 'open' });

  const style = document.createElement('style');
  style.textContent = inlineCSS;
  shadow.appendChild(style);

  const container = document.createElement('div');
  container.id = 'marginalia-root';
  shadow.appendChild(container);

  document.body.appendChild(host);

  renderUI = () => {
    render(
      h('div', null,
        h(HoverCard, {
          annotation: state.hoverAnnotation,
          triggerRect: state.hoverRect,
          onMouseEnter: () => {
            if (closeTimer) {
              clearTimeout(closeTimer);
              closeTimer = null;
            }
          },
          onMouseLeave: () => {
            setState({ hoverAnnotation: null, hoverRect: null });
          },
        }),
        h(FloatingPill, {
          count: state.annotations.length,
          loading: state.loading,
          visible: state.highlightsVisible,
          hasSummary: state.summarySections.length > 0 || state.summaryError !== null,
          summaryLoading: state.summaryLoading,
          onMouseEnter: showSummary,
          onMouseLeave: scheduleSummaryClose,
          onToggle: () => {
            const next = !state.highlightsVisible;
            highlightManager.setVisible(next);
            setState({ highlightsVisible: next });
            if (!next) {
              setState({ hoverAnnotation: null, hoverRect: null });
            }
          },
          onShowSummary: () => {
            if (hasSummaryContent()) {
              cancelSummaryClose();
              setState({ summaryPinned: true, summaryHoverActive: true });
            }
          },
        }),
        h(SummaryCard, {
          sections: state.summarySections,
          contentType: state.summaryContentType,
          error: state.summaryError,
          loading: state.summaryLoading,
          visible: hasSummaryContent() && (state.summaryPinned || state.summaryHoverActive),
          quickAddHost: autoTrigger ? window.location.hostname : null,
          quickAddAdded: autoTrigger?.isSiteListed() ?? false,
          onQuickAdd: () => {
            void chrome.runtime.sendMessage({
              type: 'ADD_AUTO_SITE',
              payload: { hostname: window.location.hostname },
            });
          },
          onMouseEnter: showSummary,
          onMouseLeave: scheduleSummaryClose,
          onClose: () => {
            hideSummary();
          },
        }),
      ),
      container,
    );
  };

  document.addEventListener('click', (e) => {
    if (!hasSummaryContent() || (!state.summaryPinned && !state.summaryHoverActive)) return;
    const host = document.getElementById(HOST_ID);
    if (host && !host.contains(e.target as Node)) {
      hideSummary();
    }
  });
}

// --- Session flow ---
function startSession(mode: SessionMode) {
  if (annotating) return;

  const content = extractPageContent();
  if (!content) return;

  annotating = true;
  cancelSummaryClose();

  if (mode === 'full') {
    highlightManager.clear();
    setState({
      annotations: [],
      loading: true,
      highlightsVisible: true,
      hoverAnnotation: null,
      hoverRect: null,
      summarySections: [],
      summaryContentType: null,
      summaryError: null,
      summaryLoading: true,
      summaryPinned: true,
      summaryHoverActive: false,
    });
  } else {
    // Auto-run: ambient summary, no annotation UI churn, not pinned.
    setState({
      summarySections: [],
      summaryContentType: null,
      summaryError: null,
      summaryLoading: true,
      summaryPinned: false,
      summaryHoverActive: false,
    });
  }

  const port = chrome.runtime.connect({ name: PORT_NAME });

  port.postMessage({
    type: 'START_ANNOTATE',
    payload: {
      url: content.url,
      title: content.title,
      text: content.content,
      metadata: collectPageMetadata(content),
      mode,
    },
  } satisfies PortMessage);

  port.onMessage.addListener((msg: PortMessage) => {
    switch (msg.type) {
      case 'ANNOTATION_CHUNK': {
        const annotation = msg.payload.annotation;
        const added = highlightManager.addAnnotation(annotation);
        if (added) {
          setState({
            annotations: [...state.annotations, annotation],
          });
        }
        break;
      }
      case 'SUMMARY_META':
        setState({ summaryContentType: msg.payload.contentType });
        break;
      case 'SUMMARY_SECTION':
        setState({
          summarySections: [...state.summarySections, msg.payload.section],
        });
        break;
      case 'SUMMARY_DONE':
        setState({
          summaryLoading: false,
          summaryPinned: true,
          summaryHoverActive: false,
        });
        break;
      case 'SUMMARY_ERROR':
        setState({
          summaryError: msg.payload.message,
          summaryLoading: false,
        });
        break;
      case 'STREAM_DONE':
        setState({ loading: false });
        annotating = false;
        port.disconnect();
        break;
      case 'STREAM_ERROR':
        hideSummary();
        setState({ loading: false, summaryLoading: false });
        annotating = false;
        port.disconnect();
        break;
    }
  });

  port.onDisconnect.addListener(() => {
    cancelSummaryClose();
    setState({ loading: false, summaryLoading: false });
    annotating = false;
  });
}

// --- Message listener (toolbar/popup + service worker) ---
chrome.runtime.onMessage.addListener((message: ContentMessage, _sender, sendResponse) => {
  if (message.type === 'TOGGLE_ANNOTATIONS') {
    if (state.annotations.length === 0 && !annotating) {
      startSession('full');
      sendResponse({ annotating: true });
    } else {
      const next = !state.highlightsVisible;
      highlightManager.setVisible(next);
      setState({ highlightsVisible: next });
      sendResponse({ visible: next });
    }
  } else if (message.type === 'PAGE_NAVIGATED') {
    autoTrigger?.evaluate('nav');
    sendResponse({ ok: true });
  }
  return true;
});

// --- Initialize ---
function init() {
  injectHighlightStyles();
  injectHost();

  highlightManager.init(
    // onHover
    (annotation, rect) => {
      console.log('[Marginalia] onHover callback', { id: annotation.id, rect: rect.toJSON() });
      if (closeTimer) {
        clearTimeout(closeTimer);
        closeTimer = null;
      }
      setState({ hoverAnnotation: annotation, hoverRect: rect });
    },
    // onLeave
    () => {
      closeTimer = setTimeout(() => {
        setState({ hoverAnnotation: null, hoverRect: null });
        closeTimer = null;
      }, CARD_CONFIG.closeDelay);
    },
  );

  autoTrigger = initAutoTrigger({
    onTrigger: () => startSession('summary-only'),
    onSettingsChange: () => renderUI?.(),
  });

  // Extra SPA-navigation signals beyond the service worker's tabs.onUpdated
  // forward; the per-URL dedup inside the trigger makes over-firing harmless.
  window.addEventListener('popstate', () => autoTrigger?.evaluate('nav'));
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) autoTrigger?.evaluate('nav');
  });
}

init();
