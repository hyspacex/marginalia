import { render, h } from 'preact';
import { SIDEBAR_WIDTH, DEFAULT_MODES } from '@/shared/constants';
import { Sidebar } from './sidebar/Sidebar';
import sidebarCSS from './styles/sidebar.css?raw';

const HOST_ID = 'marginalia-host';
const FLOAT_BTN_ID = 'marginalia-float-btn';

let sidebarOpen = false;

function injectSidebar() {
  if (document.getElementById(HOST_ID)) return;

  const host = document.createElement('div');
  host.id = HOST_ID;
  const shadow = host.attachShadow({ mode: 'open' });

  const style = document.createElement('style');
  style.textContent = sidebarCSS;
  shadow.appendChild(style);

  const container = document.createElement('div');
  container.id = 'marginalia-root';
  shadow.appendChild(container);

  document.body.appendChild(host);

  renderSidebar(container);
}

function renderSidebar(container: HTMLElement) {
  render(
    h(Sidebar, {
      onClose: () => toggleSidebar(false),
    }),
    container,
  );
}

function toggleSidebar(open?: boolean) {
  sidebarOpen = open ?? !sidebarOpen;
  const host = document.getElementById(HOST_ID);
  if (!host) return;

  if (sidebarOpen) {
    host.style.display = 'block';
    document.body.style.marginRight = `${SIDEBAR_WIDTH}px`;
    document.body.style.transition = 'margin-right 0.2s ease';
  } else {
    host.style.display = 'none';
    document.body.style.marginRight = '';
  }
}

// --- Text Selection Float Button ---

function createFloatButton(): HTMLButtonElement {
  let btn = document.getElementById(FLOAT_BTN_ID) as HTMLButtonElement | null;
  if (btn) return btn;

  btn = document.createElement('button');
  btn.id = FLOAT_BTN_ID;
  btn.textContent = 'Annotate with Marginalia';
  Object.assign(btn.style, {
    position: 'absolute',
    zIndex: '2147483646',
    padding: '6px 12px',
    border: 'none',
    borderRadius: '6px',
    background: '#4f46e5',
    color: '#fff',
    fontSize: '12px',
    fontWeight: '600',
    fontFamily: 'system-ui, sans-serif',
    cursor: 'pointer',
    boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
    display: 'none',
  });
  document.body.appendChild(btn);
  return btn;
}

function setupSelectionHandler() {
  const btn = createFloatButton();

  document.addEventListener('mouseup', () => {
    const selection = window.getSelection();
    const text = selection?.toString().trim();

    if (!text || text.length < 10) {
      btn.style.display = 'none';
      return;
    }

    const range = selection!.getRangeAt(0);
    const rect = range.getBoundingClientRect();

    btn.style.display = 'block';
    btn.style.top = `${window.scrollY + rect.bottom + 8}px`;
    btn.style.left = `${window.scrollX + rect.left + (rect.width / 2) - 80}px`;

    btn.onclick = () => {
      btn.style.display = 'none';

      // Open sidebar if not open
      if (!sidebarOpen) toggleSidebar(true);

      // Dispatch event that Sidebar listens for
      window.dispatchEvent(
        new CustomEvent('marginalia:annotate-selection', {
          detail: { selectedText: text, modes: [...DEFAULT_MODES] },
        }),
      );
    };
  });

  document.addEventListener('mousedown', (e) => {
    if (e.target !== btn) {
      btn.style.display = 'none';
    }
  });
}

// Listen for messages from popup
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'TOGGLE_SIDEBAR') {
    toggleSidebar();
    sendResponse({ sidebarOpen });
  }
  return true;
});

// Initialize
injectSidebar();
toggleSidebar(false);
setupSelectionHandler();
