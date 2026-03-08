import { usageTracker } from './usage-tracker';

describe('usageTracker', () => {
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

  test('aggregates provider-aware totals using request-time costs', async () => {
    await usageTracker.recordUsage({
      providerId: 'anthropic',
      modelId: 'claude-sonnet-4-6',
      inputTokens: 1000,
      outputTokens: 500,
      estimatedCost: 1.25,
    });
    await usageTracker.recordUsage({
      providerId: 'openai',
      modelId: 'gpt-5.4-2026-03-05',
      inputTokens: 600,
      outputTokens: 200,
      estimatedCost: 0.4,
    });

    await expect(usageTracker.getTotals()).resolves.toEqual({
      inputTokens: 1600,
      outputTokens: 700,
      estimatedCost: 1.65,
    });
  });

  test('returns a null total cost when any request is unpriced', async () => {
    await usageTracker.recordUsage({
      providerId: 'openai',
      modelId: 'custom-model',
      inputTokens: 100,
      outputTokens: 50,
      estimatedCost: null,
    });

    await expect(usageTracker.getTotals()).resolves.toEqual({
      inputTokens: 100,
      outputTokens: 50,
      estimatedCost: null,
    });
  });
});
