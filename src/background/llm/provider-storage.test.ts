import { getProviderDescriptor } from './provider-registry';
import {
  createDefaultProviderConfig,
  createDefaultProvidersState,
  deriveProvidersState,
  getProvidersState,
  getStoredProviderConfig,
  hasProviderCredentials,
  normalizeProvidersState,
  resolveProviderConfig,
  saveProvidersState,
} from './provider-storage';

describe('provider storage', () => {
  beforeEach(() => {
    const storage: Record<string, unknown> = {};

    vi.stubGlobal('chrome', {
      storage: {
        local: {
          async get(keys?: string | string[]) {
            if (!keys) return { ...storage };
            if (typeof keys === 'string') {
              return { [keys]: storage[keys] };
            }

            return Object.fromEntries(keys.map((key) => [key, storage[key]]));
          },
          async set(value: Record<string, unknown>) {
            Object.assign(storage, value);
          },
          async remove(keys: string | string[]) {
            const list = Array.isArray(keys) ? keys : [keys];
            for (const key of list) {
              delete storage[key];
            }
          },
        },
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test('migrates legacy anthropic keys into the versioned provider state', () => {
    const state = deriveProvidersState({
      apiKey: 'legacy-key',
      model: 'claude-sonnet-4-5-20250929',
      baseUrl: 'https://legacy.anthropic.test/',
    });

    expect(state.activeProviderId).toBe('anthropic');
    expect(state.configsByProvider.anthropic).toEqual({
      apiKey: 'legacy-key',
      baseUrl: 'https://legacy.anthropic.test',
      modelMode: 'catalog',
      modelId: 'claude-sonnet-4-6',
      options: {},
    });
    expect(state.configsByProvider.openai).toEqual(getProviderDescriptor('openai').normalizeConfig());
  });

  test('falls back to the default provider when stored state is invalid', () => {
    const state = normalizeProvidersState({
      activeProviderId: 'invalid' as never,
      configsByProvider: {},
    });

    expect(state.activeProviderId).toBe('anthropic');
  });

  test('preserves per-provider configs when saving and reloading', async () => {
    const state = createDefaultProvidersState('openai');
    state.configsByProvider.anthropic = getProviderDescriptor('anthropic').normalizeConfig({
      apiKey: 'anthropic-key',
      modelId: 'claude-haiku-3-5-20241022',
    });
    state.configsByProvider.openai = getProviderDescriptor('openai').normalizeConfig({
      apiKey: 'openai-key',
      baseUrl: 'https://proxy.openai.test/',
      modelId: 'gpt-5.4-2026-03-05',
    });

    await saveProvidersState(state);
    const loaded = await getProvidersState();

    expect(loaded).toEqual({
      version: 1,
      activeProviderId: 'openai',
      configsByProvider: {
        anthropic: {
          apiKey: 'anthropic-key',
          baseUrl: 'https://api.anthropic.com',
          modelMode: 'catalog',
          modelId: 'claude-haiku-3-5-20241022',
          options: {},
        },
        openai: {
          apiKey: 'openai-key',
          baseUrl: 'https://proxy.openai.test',
          modelMode: 'catalog',
          modelId: 'gpt-5.4-2026-03-05',
          options: {},
        },
      },
    });
  });

  test('does not rewrite storage when the normalized state is already present', async () => {
    const storage = {
      providersState: createDefaultProvidersState(),
    };

    const setSpy = vi.fn(async () => undefined);
    vi.stubGlobal('chrome', {
      storage: {
        local: {
          async get() {
            return storage;
          },
          set: setSpy,
          async remove() {
            return undefined;
          },
        },
      },
    });

    await expect(getProvidersState()).resolves.toEqual(storage.providersState);
    expect(setSpy).not.toHaveBeenCalled();
  });

  test('round-trips custom model selections', () => {
    const state = normalizeProvidersState({
      activeProviderId: 'openai',
      configsByProvider: {
        openai: {
          apiKey: 'openai-key',
          baseUrl: 'https://api.openai.com',
          modelMode: 'custom',
          modelId: 'custom-research-model',
          options: {},
        },
      },
    });

    expect(resolveProviderConfig(state)).toMatchObject({
      providerId: 'openai',
      modelMode: 'custom',
      modelId: 'custom-research-model',
      resolvedModel: 'custom-research-model',
    });
  });

  test('returns normalized defaults and credential checks for stored configs', () => {
    const state = createDefaultProvidersState();

    expect(createDefaultProviderConfig('anthropic')).toEqual(getStoredProviderConfig(state, 'anthropic'));
    expect(hasProviderCredentials(getStoredProviderConfig(state, 'anthropic'))).toBe(false);
    expect(hasProviderCredentials({
      ...getStoredProviderConfig(state, 'anthropic'),
      apiKey: 'configured',
    })).toBe(true);
  });
});
