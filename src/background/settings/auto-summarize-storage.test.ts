import {
  createDefaultAutoSummarizeSettings,
  getAutoSummarizeSettings,
  normalizeAutoSummarizeSettings,
  saveAutoSummarizeSettings,
  AUTO_SUMMARIZE_SETTINGS_KEY,
} from './auto-summarize-storage';

describe('normalizeAutoSummarizeSettings', () => {
  test('returns defaults for garbage input', () => {
    expect(normalizeAutoSummarizeSettings(undefined)).toEqual(createDefaultAutoSummarizeSettings());
    expect(normalizeAutoSummarizeSettings(null)).toEqual(createDefaultAutoSummarizeSettings());
    expect(normalizeAutoSummarizeSettings('nope')).toEqual(createDefaultAutoSummarizeSettings());
  });

  test('normalizes, dedupes, and drops invalid site entries', () => {
    const normalized = normalizeAutoSummarizeSettings({
      enabled: false,
      sites: ['https://www.nytimes.com/x', 'nytimes.com', 'invalid', 42, 'bbc.co.uk'],
      autoModelId: 'claude-haiku-4-5-20251001',
    });

    expect(normalized).toEqual({
      version: 1,
      enabled: false,
      sites: ['nytimes.com', 'bbc.co.uk'],
      autoModelId: 'claude-haiku-4-5-20251001',
    });
  });

  test('coerces blank or non-string model overrides to null', () => {
    expect(normalizeAutoSummarizeSettings({ autoModelId: '  ' }).autoModelId).toBeNull();
    expect(normalizeAutoSummarizeSettings({ autoModelId: 7 }).autoModelId).toBeNull();
  });
});

describe('storage round-trip', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test('reads defaults when nothing is stored and saves normalized state', async () => {
    const store: Record<string, unknown> = {};
    vi.stubGlobal('chrome', {
      storage: {
        local: {
          get: vi.fn(async (key: string) => ({ [key]: store[key] })),
          set: vi.fn(async (items: Record<string, unknown>) => {
            Object.assign(store, items);
          }),
        },
      },
    });

    expect(await getAutoSummarizeSettings()).toEqual(createDefaultAutoSummarizeSettings());

    await saveAutoSummarizeSettings({
      version: 1,
      enabled: true,
      sites: ['WWW.NYTIMES.COM'],
      autoModelId: null,
    });

    expect(store[AUTO_SUMMARIZE_SETTINGS_KEY]).toEqual(expect.objectContaining({
      sites: ['nytimes.com'],
    }));
    expect(await getAutoSummarizeSettings()).toEqual(expect.objectContaining({
      sites: ['nytimes.com'],
    }));
  });
});
