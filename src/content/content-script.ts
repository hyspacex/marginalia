import { render, h } from 'preact';
import { PORT_NAME, HIGHLIGHT_COLORS, CARD_CONFIG } from '@/shared/constants';
import type { Annotation, PortMessage, ContentMessage } from '@/shared/types';
import { highlightManager } from './highlighter/highlight-manager';
import { HoverCard } from './card/HoverCard';
import { FloatingPill } from './pill/FloatingPill';
import { extractPageContent } from './extraction/readability';
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
}

let state: UIState = {
  annotations: [],
  loading: false,
  highlightsVisible: true,
  hoverAnnotation: null,
  hoverRect: null,
};

let renderUI: (() => void) | null = null;
let closeTimer: ReturnType<typeof setTimeout> | null = null;

function setState(partial: Partial<UIState>) {
  Object.assign(state, partial);
  renderUI?.();
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
          onToggle: () => {
            const next = !state.highlightsVisible;
            highlightManager.setVisible(next);
            setState({ highlightsVisible: next });
            if (!next) {
              setState({ hoverAnnotation: null, hoverRect: null });
            }
          },
        }),
      ),
      container,
    );
  };
}

// --- Annotation flow ---
function startAnnotating() {
  if (annotating) return;

  const content = extractPageContent();
  if (!content) return;

  annotating = true;
  highlightManager.clear();
  setState({
    annotations: [],
    loading: true,
    highlightsVisible: true,
    hoverAnnotation: null,
    hoverRect: null,
  });

  const port = chrome.runtime.connect({ name: PORT_NAME });

  port.postMessage({
    type: 'START_ANNOTATE',
    payload: {
      url: content.url,
      title: content.title,
      text: content.content,
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
      case 'STREAM_DONE':
        setState({ loading: false });
        annotating = false;
        port.disconnect();
        break;
      case 'STREAM_ERROR':
        setState({ loading: false });
        annotating = false;
        port.disconnect();
        break;
    }
  });

  port.onDisconnect.addListener(() => {
    setState({ loading: false });
    annotating = false;
  });
}

// --- Message listener (from popup) ---
chrome.runtime.onMessage.addListener((message: ContentMessage, _sender, sendResponse) => {
  if (message.type === 'TOGGLE_ANNOTATIONS') {
    if (state.annotations.length === 0 && !annotating) {
      startAnnotating();
      sendResponse({ annotating: true });
    } else {
      const next = !state.highlightsVisible;
      highlightManager.setVisible(next);
      setState({ highlightsVisible: next });
      sendResponse({ visible: next });
    }
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
}

init();
