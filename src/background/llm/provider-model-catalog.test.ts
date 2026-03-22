import { estimateProviderCost, getProviderModelCatalog, saveProviderModelCatalog } from './provider-model-catalog';

describe('provider model catalog', () => {
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

  test('falls back to registry models when no remote catalog is cached', async () => {
    await expect(getProviderModelCatalog('openai')).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'gpt-5.4-2026-03-05' }),
    ]));
  });

  test('stores remote models and uses them for request cost estimation', async () => {
    await saveProviderModelCatalog('openrouter', [
      {
        id: 'openai/gpt-4.1-mini',
        name: 'OpenAI GPT-4.1 mini',
        contextWindow: 1047576,
        costPer1kInput: 0.0004,
        costPer1kOutput: 0.0016,
      },
    ]);

    await expect(estimateProviderCost({
      providerId: 'openrouter',
      apiKey: 'sk-or-test',
      baseUrl: 'https://openrouter.ai/api',
      modelMode: 'catalog',
      modelId: 'openai/gpt-4.1-mini',
      resolvedModel: 'openai/gpt-4.1-mini',
      options: {},
    }, 1000, 500)).resolves.toBeCloseTo(0.0012);
  });
});
