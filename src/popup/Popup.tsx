import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { getProviderDescriptor } from '@/background/llm/provider-registry';
import { getProvidersState, hasProviderCredentials, resolveProviderConfig } from '@/background/llm/provider-storage';
import { usageTracker } from '@/background/usage-tracker';

export function Popup() {
  const [totalTokens, setTotalTokens] = useState(0);
  const [hasApiKey, setHasApiKey] = useState(false);
  const [providerName, setProviderName] = useState('provider');

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const [providersState, usageTotals] = await Promise.all([
        getProvidersState(),
        usageTracker.getTotals(),
      ]);

      if (cancelled) return;

      const activeConfig = resolveProviderConfig(providersState);
      setHasApiKey(hasProviderCredentials(activeConfig));
      setProviderName(getProviderDescriptor(activeConfig.providerId).name);
      setTotalTokens(usageTotals.inputTokens + usageTotals.outputTokens);
    })();

    return () => {
      cancelled = true;
    };
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
          No {providerName} API key set.{' '}
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

const popupRoot = document.getElementById('popup-root');
if (popupRoot) {
  render(<Popup />, popupRoot);
}
