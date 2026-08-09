import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import type { ModelOption, ProviderConfigInput, ProviderId, ReaderProfile, StoredProvidersState } from '@/shared/types';
import { readingGraph } from '@/background/memory/reading-graph';
import { providerDescriptors, getProviderDescriptor } from '@/background/llm/provider-registry';
import {
  createDefaultProvidersState,
  getProvidersState,
  saveProvidersState,
} from '@/background/llm/provider-storage';
import { usageTracker, type UsageTotals } from '@/background/usage-tracker';
import {
  createDefaultAutoSummarizeSettings,
  getAutoSummarizeSettings,
  saveAutoSummarizeSettings,
  type AutoSummarizeSettings,
} from '@/background/settings/auto-summarize-storage';
import { normalizeSiteEntry } from '@/shared/site-match';

type TestStatus = 'idle' | 'testing' | 'success' | 'error';
type CatalogStatus = 'idle' | 'loading' | 'ready' | 'error';

const EMPTY_TOTALS: UsageTotals = {
  inputTokens: 0,
  outputTokens: 0,
  estimatedCost: 0,
};

function ensureCurrentCatalogModel(models: readonly ModelOption[], modelId: string): ModelOption[] {
  const normalizedModelId = modelId.trim();
  const nextModels = [...models];
  if (!normalizedModelId || nextModels.some((model) => model.id === normalizedModelId)) {
    return nextModels;
  }

  return [
    {
      id: normalizedModelId,
      name: `${normalizedModelId} (saved)`,
      contextWindow: null,
      costPer1kInput: null,
      costPer1kOutput: null,
    },
    ...nextModels,
  ];
}

export function Options() {
  const [providersState, setProvidersState] = useState<StoredProvidersState>(createDefaultProvidersState());
  const [testStatus, setTestStatus] = useState<TestStatus>('idle');
  const [testMessage, setTestMessage] = useState<string | null>(null);
  const [profile, setProfile] = useState<ReaderProfile | null>(null);
  const [usageTotals, setUsageTotals] = useState<UsageTotals>(EMPTY_TOTALS);
  const [graphCount, setGraphCount] = useState(0);
  const [saved, setSaved] = useState(false);
  const [modelCatalogs, setModelCatalogs] = useState<Partial<Record<ProviderId, ModelOption[]>>>({});
  const [modelCatalogStatus, setModelCatalogStatus] = useState<Partial<Record<ProviderId, CatalogStatus>>>({});
  const [modelCatalogMessage, setModelCatalogMessage] = useState<Partial<Record<ProviderId, string | null>>>({});
  const [autoSettings, setAutoSettings] = useState<AutoSummarizeSettings>(createDefaultAutoSummarizeSettings());
  const [siteInput, setSiteInput] = useState('');
  const [siteError, setSiteError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const [nextProvidersState, usage, result, nextGraphCount, nextAutoSettings] = await Promise.all([
        getProvidersState(),
        usageTracker.getTotals(),
        chrome.storage.local.get('readerProfile'),
        readingGraph.getCount(),
        getAutoSummarizeSettings(),
      ]);

      if (cancelled) return;

      setProvidersState(nextProvidersState);
      setUsageTotals(usage);
      setProfile((result.readerProfile as ReaderProfile | undefined) || null);
      setGraphCount(nextGraphCount);
      setAutoSettings(nextAutoSettings);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const activeProviderId = providersState.activeProviderId;
  const activeDescriptor = getProviderDescriptor(activeProviderId);
  const activeConfig = activeDescriptor.normalizeConfig(providersState.configsByProvider[activeProviderId]);
  const catalogModels = ensureCurrentCatalogModel(
    modelCatalogs[activeProviderId]?.length ? modelCatalogs[activeProviderId] as ModelOption[] : activeDescriptor.models,
    activeConfig.modelId,
  );
  const selectedModel = catalogModels.find((model) => model.id === activeConfig.modelId);
  const activeCatalogStatus = modelCatalogStatus[activeProviderId] || 'idle';
  const activeCatalogMessage = modelCatalogMessage[activeProviderId] || null;

  const updateProviderState = (
    providerId: ProviderId,
    updater: (config: StoredProvidersState['configsByProvider'][ProviderId]) => StoredProvidersState['configsByProvider'][ProviderId],
  ) => {
    setProvidersState((current) => ({
      ...current,
      configsByProvider: {
        ...current.configsByProvider,
        [providerId]: updater(current.configsByProvider[providerId]),
      },
    }));
    setSaved(false);
    setTestStatus('idle');
    setTestMessage(null);
  };

  const updateActiveConfig = (patch: Partial<ProviderConfigInput>) => {
    updateProviderState(activeProviderId, (currentConfig) => activeDescriptor.normalizeConfig({
      ...activeDescriptor.normalizeConfig(currentConfig),
      ...patch,
    }));
  };

  const refreshModelCatalog = async (
    providerId: ProviderId = activeProviderId,
    configInput = getProviderDescriptor(providerId).normalizeConfig(providersState.configsByProvider[providerId]),
  ) => {
    const descriptor = getProviderDescriptor(providerId);

    if (!configInput.apiKey.trim()) {
      setModelCatalogStatus((current) => ({ ...current, [providerId]: 'idle' }));
      setModelCatalogMessage((current) => ({
        ...current,
        [providerId]: `Enter a ${descriptor.name} API key to load the latest model list.`,
      }));
      return;
    }

    setModelCatalogStatus((current) => ({ ...current, [providerId]: 'loading' }));
    setModelCatalogMessage((current) => ({ ...current, [providerId]: null }));

    try {
      const response = await chrome.runtime.sendMessage({
        type: 'LIST_MODELS',
        payload: {
          config: {
            providerId,
            ...configInput,
          },
        },
      });

      if (response.type === 'ERROR') {
        throw new Error(response.payload.message);
      }

      if (response.type !== 'MODEL_CATALOG') {
        throw new Error('Unexpected response while loading models');
      }

      setModelCatalogs((current) => ({
        ...current,
        [providerId]: response.payload.models,
      }));
      setModelCatalogStatus((current) => ({ ...current, [providerId]: 'ready' }));
      setModelCatalogMessage((current) => ({ ...current, [providerId]: null }));
    } catch (error) {
      setModelCatalogStatus((current) => ({ ...current, [providerId]: 'error' }));
      setModelCatalogMessage((current) => ({
        ...current,
        [providerId]: error instanceof Error
          ? error.message
          : `Failed to load the latest model list from ${descriptor.name}`,
      }));
    }
  };

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void refreshModelCatalog(activeProviderId, activeConfig);
    }, 350);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [
    activeProviderId,
    activeConfig.apiKey,
    activeConfig.baseUrl,
    activeConfig.options.appTitle,
    activeConfig.options.httpReferer,
  ]);

  const handleSave = async () => {
    const normalizedState = await saveProvidersState(providersState);
    setProvidersState(normalizedState);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleTest = async () => {
    setTestStatus('testing');
    setTestMessage(null);

    try {
      const response = await chrome.runtime.sendMessage({
        type: 'TEST_CONNECTION',
        payload: {
          config: {
            providerId: activeProviderId,
            ...activeConfig,
          },
        },
      });

      if (response.type === 'ERROR') {
        setTestStatus('error');
        setTestMessage(response.payload.message);
      } else {
        setTestStatus('success');
        setTestMessage(`Connected to ${activeDescriptor.name}.`);
      }
    } catch (error) {
      setTestStatus('error');
      setTestMessage(error instanceof Error ? error.message : 'Connection test failed');
    }

    setTimeout(() => {
      setTestStatus('idle');
    }, 3000);
  };

  const persistAutoSettings = async (next: AutoSummarizeSettings) => {
    const normalized = await saveAutoSummarizeSettings(next);
    setAutoSettings(normalized);
  };

  const handleAddSite = async () => {
    const normalized = normalizeSiteEntry(siteInput);
    if (!normalized) {
      setSiteError('Enter a valid domain, e.g. nytimes.com');
      return;
    }
    setSiteError(null);
    setSiteInput('');
    if (autoSettings.sites.includes(normalized)) return;
    await persistAutoSettings({ ...autoSettings, sites: [...autoSettings.sites, normalized] });
  };

  const handleRemoveSite = async (site: string) => {
    await persistAutoSettings({
      ...autoSettings,
      sites: autoSettings.sites.filter((entry) => entry !== site),
    });
  };

  const handleClearData = async () => {
    if (!confirm('Clear all reading history and profile data? This cannot be undone.')) {
      return;
    }

    await chrome.storage.local.remove('readerProfile');
    await usageTracker.reset();
    await readingGraph.clear();

    setProfile(null);
    setUsageTotals(EMPTY_TOTALS);
    setGraphCount(0);
  };

  const estimatedCostText = usageTotals.estimatedCost == null
    ? 'N/A'
    : `$${usageTotals.estimatedCost.toFixed(4)}`;

  return (
    <div class="options">
      <h1>Marginalia</h1>
      <p class="options-subtitle">Your AI reading companion — annotations, structured summaries, and memory.</p>

      <section class="options-section">
        <div class="section-header">
          <div>
            <h2>Provider</h2>
            <p class="section-copy">Select and configure the model provider used for annotations and summaries.</p>
          </div>
        </div>

        <label class="options-label">
          Active Provider
          <select
            class="options-input"
            value={activeProviderId}
            onChange={(event) => {
              const nextProviderId = (event.target as HTMLSelectElement).value as ProviderId;
              setProvidersState((current) => ({ ...current, activeProviderId: nextProviderId }));
              setSaved(false);
              setTestStatus('idle');
              setTestMessage(null);
            }}
          >
            {providerDescriptors.map((provider) => (
              <option key={provider.id} value={provider.id}>{provider.name}</option>
            ))}
          </select>
        </label>

        <p class="provider-description">{activeDescriptor.description}</p>

        {activeDescriptor.fields.map((field) => {
          const value = field.target === 'apiKey'
            ? activeConfig.apiKey
            : field.target === 'baseUrl'
              ? activeConfig.baseUrl
              : activeConfig.options[field.key] || '';

          return (
            <label key={field.key} class="options-label">
              {field.label}
              <input
                type={field.type}
                class="options-input"
                value={value}
                placeholder={field.placeholder}
                onInput={(event) => {
                  const nextValue = (event.target as HTMLInputElement).value;
                  if (field.target === 'apiKey') {
                    updateActiveConfig({ apiKey: nextValue });
                    return;
                  }
                  if (field.target === 'baseUrl') {
                    updateActiveConfig({ baseUrl: nextValue });
                    return;
                  }

                  updateActiveConfig({
                    options: {
                      ...activeConfig.options,
                      [field.key]: nextValue,
                    },
                  });
                }}
              />
              {field.helpText && (
                <span class="field-help">{field.helpText}</span>
              )}
            </label>
          );
        })}

        <div class="model-grid">
          <label class="options-label">
            Model Source
            <select
              class="options-input"
              value={activeConfig.modelMode}
              onChange={(event) => {
                const nextMode = (event.target as HTMLSelectElement).value as ProviderConfigInput['modelMode'];
                updateActiveConfig({ modelMode: nextMode });
              }}
            >
              <option value="catalog">Provider catalog</option>
              <option value="custom">Custom model id</option>
            </select>
          </label>

          {activeConfig.modelMode === 'catalog' ? (
            <label class="options-label">
              Model
              <select
                class="options-input"
                value={activeConfig.modelId}
                onChange={(event) => updateActiveConfig({ modelId: (event.target as HTMLSelectElement).value })}
              >
                {catalogModels.map((model) => (
                  <option key={model.id} value={model.id}>{model.name}</option>
                ))}
              </select>
            </label>
          ) : (
            <label class="options-label">
              Custom Model ID
              <input
                type="text"
                class="options-input"
                value={activeConfig.modelId}
                placeholder="model-name"
                onInput={(event) => updateActiveConfig({ modelId: (event.target as HTMLInputElement).value })}
              />
            </label>
          )}
        </div>

        {activeConfig.modelMode === 'catalog' && (
          <div class="model-catalog-actions">
            <button
              class="btn-secondary"
              onClick={() => void refreshModelCatalog()}
              disabled={activeCatalogStatus === 'loading' || !activeConfig.apiKey.trim()}
            >
              {activeCatalogStatus === 'loading' ? 'Loading models...' : 'Refresh models'}
            </button>
            {activeCatalogMessage && (
              <p class={`catalog-message ${activeCatalogStatus === 'error' ? 'catalog-message-error' : ''}`}>
                {activeCatalogMessage}
              </p>
            )}
          </div>
        )}

        <div class="model-meta">
          <span>
            Context window:{' '}
            {selectedModel?.contextWindow != null ? selectedModel.contextWindow.toLocaleString() : 'Unknown'}
          </span>
          <span>
            Pricing:{' '}
            {selectedModel && selectedModel.costPer1kInput != null && selectedModel.costPer1kOutput != null
              ? `$${selectedModel.costPer1kInput.toFixed(4)} in / $${selectedModel.costPer1kOutput.toFixed(4)} out per 1K`
              : 'Unavailable for this model'}
          </span>
        </div>

        <div class="options-actions">
          <button class="btn-primary" onClick={handleSave}>
            {saved ? 'Saved!' : 'Save'}
          </button>
          <button class="btn-secondary" onClick={handleTest} disabled={testStatus === 'testing'}>
            {testStatus === 'testing'
              ? 'Testing...'
              : testStatus === 'success'
                ? 'Connected!'
                : testStatus === 'error'
                  ? 'Failed'
                  : 'Test Connection'}
          </button>
        </div>

        {testMessage && (
          <p class={`status-message status-${testStatus === 'error' ? 'error' : 'success'}`}>
            {testMessage}
          </p>
        )}
      </section>

      <section class="options-section">
        <div class="section-header">
          <div>
            <h2>Auto-Summarize</h2>
            <p class="section-copy">
              Automatically generate a structured summary (no inline annotations) when you open an
              article on these sites. Spend shows up under Usage.
            </p>
          </div>
        </div>

        <label class="options-label checkbox-label">
          <input
            type="checkbox"
            checked={autoSettings.enabled}
            onChange={(event) => {
              void persistAutoSettings({
                ...autoSettings,
                enabled: (event.target as HTMLInputElement).checked,
              });
            }}
          />
          Enable auto-summarize on listed sites
        </label>

        <label class="options-label">
          Add a site
          <div class="site-add-row">
            <input
              type="text"
              class="options-input"
              value={siteInput}
              placeholder="nytimes.com"
              onInput={(event) => {
                setSiteInput((event.target as HTMLInputElement).value);
                setSiteError(null);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void handleAddSite();
              }}
            />
            <button class="btn-secondary" onClick={() => void handleAddSite()}>Add</button>
          </div>
          {siteError && <span class="field-help field-error">{siteError}</span>}
        </label>

        {autoSettings.sites.length > 0 ? (
          <ul class="site-list">
            {autoSettings.sites.map((site) => (
              <li key={site} class="site-list-item">
                <span>{site}</span>
                <button class="btn-secondary" onClick={() => void handleRemoveSite(site)}>Remove</button>
              </li>
            ))}
          </ul>
        ) : (
          <p class="section-copy">No sites yet. Subdomains are included automatically (nytimes.com covers cooking.nytimes.com).</p>
        )}

        <label class="options-label">
          Model for auto-runs
          <select
            class="options-input"
            value={autoSettings.autoModelId ?? ''}
            onChange={(event) => {
              const value = (event.target as HTMLSelectElement).value;
              void persistAutoSettings({
                ...autoSettings,
                autoModelId: value === '' ? null : value,
              });
            }}
          >
            <option value="">Same as manual runs</option>
            {catalogModels.map((model) => (
              <option key={model.id} value={model.id}>
                {model.costPer1kInput != null && model.costPer1kOutput != null
                  ? `${model.name} ($${model.costPer1kInput.toFixed(4)}/$${model.costPer1kOutput.toFixed(4)} per 1K)`
                  : model.name}
              </option>
            ))}
          </select>
          <span class="field-help">
            Pick a cheaper {activeDescriptor.name} model to keep automatic summaries inexpensive.
          </span>
        </label>
      </section>

      <section class="options-section">
        <h2>Usage</h2>
        <div class="stats-grid">
          <div class="stat">
            <div class="stat-value">{usageTotals.inputTokens.toLocaleString()}</div>
            <div class="stat-label">Input tokens</div>
          </div>
          <div class="stat">
            <div class="stat-value">{usageTotals.outputTokens.toLocaleString()}</div>
            <div class="stat-label">Output tokens</div>
          </div>
          <div class="stat">
            <div class="stat-value">{estimatedCostText}</div>
            <div class="stat-label">Estimated cost</div>
          </div>
        </div>
        {usageTotals.estimatedCost == null && (
          <p class="section-copy">Some requests used custom or unpriced models, so total cost cannot be estimated exactly.</p>
        )}
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
                {profile.interests.map((interest) => (
                  <span key={interest} class="tag">{interest}</span>
                ))}
              </div>
            </div>
          )}

          <p class="profile-updated">Last updated: {new Date(profile.updatedAt).toLocaleString()}</p>
        </section>
      )}

      <section class="options-section">
        <h2>Data</h2>
        <p class="section-copy">Reading graph entries stored locally: {graphCount.toLocaleString()}</p>
        <button class="btn-danger" onClick={handleClearData}>
          Clear All Data
        </button>
      </section>
    </div>
  );
}

const optionsRoot = document.getElementById('options-root');
if (optionsRoot) {
  render(<Options />, optionsRoot);
}
