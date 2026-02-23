import { render } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import type { ReaderProfile } from '@/shared/types';
import { ANTHROPIC_MODELS, DEFAULT_ANTHROPIC_CONFIG } from '@/shared/constants';

function Options() {
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState(DEFAULT_ANTHROPIC_CONFIG.model);
  const [baseUrl, setBaseUrl] = useState(DEFAULT_ANTHROPIC_CONFIG.baseUrl);
  const [testStatus, setTestStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
  const [profile, setProfile] = useState<ReaderProfile | null>(null);
  const [totalInput, setTotalInput] = useState(0);
  const [totalOutput, setTotalOutput] = useState(0);
  const [graphCount, setGraphCount] = useState(0);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    chrome.storage.local.get(
      ['apiKey', 'model', 'baseUrl', 'readerProfile', 'totalInputTokens', 'totalOutputTokens'],
      (result) => {
        if (result.apiKey) setApiKey(result.apiKey);
        if (result.model) setModel(result.model);
        if (result.baseUrl) setBaseUrl(result.baseUrl);
        if (result.readerProfile) setProfile(result.readerProfile);
        setTotalInput(result.totalInputTokens || 0);
        setTotalOutput(result.totalOutputTokens || 0);
      },
    );
  }, []);

  const handleSave = () => {
    chrome.storage.local.set({ apiKey, model, baseUrl }, () => {
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    });
  };

  const handleTest = async () => {
    setTestStatus('testing');
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'TEST_CONNECTION',
        payload: { config: { apiKey, model, baseUrl } },
      });
      setTestStatus(response.type === 'ERROR' ? 'error' : 'success');
    } catch {
      setTestStatus('error');
    }
    setTimeout(() => setTestStatus('idle'), 3000);
  };

  const handleClearData = () => {
    if (confirm('Clear all reading history and profile data? This cannot be undone.')) {
      chrome.storage.local.remove(['readerProfile', 'totalInputTokens', 'totalOutputTokens'], () => {
        setProfile(null);
        setTotalInput(0);
        setTotalOutput(0);
      });
      // Clear IndexedDB
      indexedDB.deleteDatabase('marginalia-reading-graph');
      setGraphCount(0);
    }
  };

  const estimatedCost = ((totalInput * 0.003 + totalOutput * 0.015) / 1000).toFixed(4);

  return (
    <div class="options">
      <h1>Marginalia Settings</h1>

      <section class="options-section">
        <h2>API Configuration</h2>

        <label class="options-label">
          API Key
          <input
            type="password"
            class="options-input"
            value={apiKey}
            onInput={(e) => setApiKey((e.target as HTMLInputElement).value)}
            placeholder="sk-ant-..."
          />
        </label>

        <label class="options-label">
          Model
          <select
            class="options-input"
            value={model}
            onChange={(e) => setModel((e.target as HTMLSelectElement).value)}
          >
            {ANTHROPIC_MODELS.map((m) => (
              <option key={m.id} value={m.id}>{m.name}</option>
            ))}
          </select>
        </label>

        <label class="options-label">
          Base URL
          <input
            type="url"
            class="options-input"
            value={baseUrl}
            onInput={(e) => setBaseUrl((e.target as HTMLInputElement).value)}
          />
        </label>

        <div class="options-actions">
          <button class="btn-primary" onClick={handleSave}>
            {saved ? 'Saved!' : 'Save'}
          </button>
          <button class="btn-secondary" onClick={handleTest} disabled={testStatus === 'testing'}>
            {testStatus === 'testing' ? 'Testing...' :
             testStatus === 'success' ? 'Connected!' :
             testStatus === 'error' ? 'Failed' :
             'Test Connection'}
          </button>
        </div>
      </section>

      <section class="options-section">
        <h2>Usage</h2>
        <div class="stats-grid">
          <div class="stat">
            <div class="stat-value">{totalInput.toLocaleString()}</div>
            <div class="stat-label">Input tokens</div>
          </div>
          <div class="stat">
            <div class="stat-value">{totalOutput.toLocaleString()}</div>
            <div class="stat-label">Output tokens</div>
          </div>
          <div class="stat">
            <div class="stat-value">${estimatedCost}</div>
            <div class="stat-label">Estimated cost</div>
          </div>
        </div>
      </section>

      {profile && (
        <section class="options-section">
          <h2>Reader Profile</h2>

          {Object.keys(profile.expertise).length > 0 && (
            <div class="profile-field">
              <h3>Expertise</h3>
              <div class="tag-list">
                {Object.entries(profile.expertise).map(([area, level]) => (
                  <span key={area} class="tag">{area}: {level}</span>
                ))}
              </div>
            </div>
          )}

          {profile.interests.length > 0 && (
            <div class="profile-field">
              <h3>Interests</h3>
              <div class="tag-list">
                {profile.interests.map((i) => (
                  <span key={i} class="tag">{i}</span>
                ))}
              </div>
            </div>
          )}

          <p class="profile-updated">
            Last updated: {new Date(profile.updatedAt).toLocaleString()}
          </p>
        </section>
      )}

      <section class="options-section">
        <h2>Data</h2>
        <button class="btn-danger" onClick={handleClearData}>
          Clear All Data
        </button>
      </section>
    </div>
  );
}

render(<Options />, document.getElementById('options-root')!);
