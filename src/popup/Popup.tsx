import { render } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import type { AnnotationMode } from '@/shared/types';
import { MODE_LABELS, MODE_COLORS, DEFAULT_MODES } from '@/shared/constants';

const ALL_MODES: AnnotationMode[] = ['close-reading', 'context', 'devil-advocate'];

function Popup() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [totalTokens, setTotalTokens] = useState(0);
  const [hasApiKey, setHasApiKey] = useState(false);

  useEffect(() => {
    chrome.storage.local.get(['apiKey', 'totalInputTokens', 'totalOutputTokens'], (result) => {
      setHasApiKey(!!result.apiKey);
      setTotalTokens((result.totalInputTokens || 0) + (result.totalOutputTokens || 0));
    });
  }, []);

  const handleToggle = () => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]?.id) {
        chrome.tabs.sendMessage(tabs[0].id, { type: 'TOGGLE_SIDEBAR' }, (response) => {
          if (response) setSidebarOpen(response.sidebarOpen);
        });
      }
    });
  };

  const openOptions = () => {
    chrome.runtime.openOptionsPage();
  };

  return (
    <div class="popup">
      <h1>Marginalia</h1>

      {!hasApiKey && (
        <div class="popup-warning">
          No API key set.{' '}
          <a href="#" onClick={openOptions}>Configure in settings</a>
        </div>
      )}

      <button class="popup-toggle" onClick={handleToggle}>
        {sidebarOpen ? 'Close Sidebar' : 'Open Sidebar'}
      </button>

      <div class="popup-stats">
        <span>Total tokens used: {totalTokens.toLocaleString()}</span>
      </div>

      <button class="popup-link" onClick={openOptions}>
        Settings
      </button>
    </div>
  );
}

render(<Popup />, document.getElementById('popup-root')!);
