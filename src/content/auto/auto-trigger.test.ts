import { initAutoTrigger } from './auto-trigger';
import { AUTO_SUMMARIZE_SETTINGS_KEY, type AutoSummarizeSettings } from '@/background/settings/auto-summarize-storage';

type StorageChangeListener = (
  changes: Record<string, { newValue?: unknown }>,
  area: string,
) => void;

function stubChrome(stored: Partial<AutoSummarizeSettings>) {
  const listeners: StorageChangeListener[] = [];

  vi.stubGlobal('chrome', {
    storage: {
      local: {
        get: vi.fn(async () => ({ [AUTO_SUMMARIZE_SETTINGS_KEY]: stored })),
      },
      onChanged: {
        addListener: vi.fn((listener: StorageChangeListener) => listeners.push(listener)),
      },
    },
  });

  return {
    fireSettingsChange(newValue: Partial<AutoSummarizeSettings>) {
      for (const listener of listeners) {
        listener({ [AUTO_SUMMARIZE_SETTINGS_KEY]: { newValue } }, 'local');
      }
    },
  };
}

const listedSettings: AutoSummarizeSettings = {
  version: 1,
  enabled: true,
  sites: ['nytimes.com'],
  autoModelId: null,
};

describe('initAutoTrigger', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  test('triggers once per URL on listed, readerable pages', async () => {
    stubChrome(listedSettings);
    const onTrigger = vi.fn();
    let href = 'https://www.nytimes.com/2026/08/01/a.html';

    const controller = initAutoTrigger({
      onTrigger,
      isReaderable: () => true,
      getLocation: () => ({ hostname: 'www.nytimes.com', href }),
    });

    await vi.advanceTimersByTimeAsync(1600);
    expect(onTrigger).toHaveBeenCalledTimes(1);

    controller.evaluate('nav');
    await vi.advanceTimersByTimeAsync(1600);
    expect(onTrigger).toHaveBeenCalledTimes(1);

    href = 'https://www.nytimes.com/2026/08/01/b.html';
    controller.evaluate('nav');
    await vi.advanceTimersByTimeAsync(1600);
    expect(onTrigger).toHaveBeenCalledTimes(2);
  });

  test('ignores hash-only URL changes via normalization', async () => {
    stubChrome(listedSettings);
    const onTrigger = vi.fn();
    let href = 'https://www.nytimes.com/2026/08/01/a.html';

    const controller = initAutoTrigger({
      onTrigger,
      isReaderable: () => true,
      getLocation: () => ({ hostname: 'www.nytimes.com', href }),
    });

    await vi.advanceTimersByTimeAsync(1600);
    href = 'https://www.nytimes.com/2026/08/01/a.html#comments';
    controller.evaluate('nav');
    await vi.advanceTimersByTimeAsync(1600);

    expect(onTrigger).toHaveBeenCalledTimes(1);
  });

  test('does not trigger when disabled or on unlisted sites', async () => {
    stubChrome({ ...listedSettings, enabled: false });
    const onTrigger = vi.fn();
    initAutoTrigger({
      onTrigger,
      isReaderable: () => true,
      getLocation: () => ({ hostname: 'www.nytimes.com', href: 'https://www.nytimes.com/a' }),
    });
    await vi.advanceTimersByTimeAsync(1600);
    expect(onTrigger).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
    stubChrome(listedSettings);
    const onTrigger2 = vi.fn();
    initAutoTrigger({
      onTrigger: onTrigger2,
      isReaderable: () => true,
      getLocation: () => ({ hostname: 'example.com', href: 'https://example.com/a' }),
    });
    await vi.advanceTimersByTimeAsync(1600);
    expect(onTrigger2).not.toHaveBeenCalled();
  });

  test('retries readerability once for slow-hydrating pages', async () => {
    stubChrome(listedSettings);
    const onTrigger = vi.fn();
    let readerable = false;

    initAutoTrigger({
      onTrigger,
      isReaderable: () => readerable,
      getLocation: () => ({ hostname: 'www.nytimes.com', href: 'https://www.nytimes.com/a' }),
    });

    await vi.advanceTimersByTimeAsync(1600);
    expect(onTrigger).not.toHaveBeenCalled();

    readerable = true;
    await vi.advanceTimersByTimeAsync(2100);
    expect(onTrigger).toHaveBeenCalledTimes(1);

    // The retry is one-shot; a still-unreaderable page gives up until re-evaluated.
  });

  test('gives up after the single readerability retry', async () => {
    stubChrome(listedSettings);
    const onTrigger = vi.fn();

    initAutoTrigger({
      onTrigger,
      isReaderable: () => false,
      getLocation: () => ({ hostname: 'www.nytimes.com', href: 'https://www.nytimes.com/a' }),
    });

    await vi.advanceTimersByTimeAsync(10000);
    expect(onTrigger).not.toHaveBeenCalled();
  });

  test('picks up live settings changes and reports listing state', async () => {
    const { fireSettingsChange } = stubChrome({ ...listedSettings, sites: [] });
    const onTrigger = vi.fn();
    const onSettingsChange = vi.fn();

    const controller = initAutoTrigger({
      onTrigger,
      onSettingsChange,
      isReaderable: () => true,
      getLocation: () => ({ hostname: 'www.nytimes.com', href: 'https://www.nytimes.com/a' }),
    });

    await vi.advanceTimersByTimeAsync(1600);
    expect(onTrigger).not.toHaveBeenCalled();
    expect(controller.isSiteListed()).toBe(false);

    fireSettingsChange(listedSettings);
    expect(controller.isSiteListed()).toBe(true);
    expect(onSettingsChange).toHaveBeenCalled();

    controller.evaluate('nav');
    await vi.advanceTimersByTimeAsync(1600);
    expect(onTrigger).toHaveBeenCalledTimes(1);
  });
});
