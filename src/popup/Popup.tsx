import { render } from 'preact';
import { useState, useEffect } from 'preact/hooks';

function Popup() {
  const [totalTokens, setTotalTokens] = useState(0);
  const [hasApiKey, setHasApiKey] = useState(false);

  useEffect(() => {
    chrome.storage.local.get(['apiKey', 'totalInputTokens', 'totalOutputTokens'], (result) => {
      setHasApiKey(!!result.apiKey);
      setTotalTokens((result.totalInputTokens || 0) + (result.totalOutputTokens || 0));
    });
  }, []);

  const handleAnnotate = () => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]?.id) {
        chrome.tabs.sendMessage(tabs[0].id, { type: 'TOGGLE_ANNOTATIONS' });
        window.close();
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

      <button class="popup-toggle" onClick={handleAnnotate} disabled={!hasApiKey}>
        Annotate Page
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
