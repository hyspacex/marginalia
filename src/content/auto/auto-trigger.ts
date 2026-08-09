import { isProbablyReaderable } from '@mozilla/readability';
import { matchesAnySite } from '@/shared/site-match';
import {
  AUTO_SUMMARIZE_SETTINGS_KEY,
  createDefaultAutoSummarizeSettings,
  getAutoSummarizeSettings,
  normalizeAutoSummarizeSettings,
  type AutoSummarizeSettings,
} from '@/background/settings/auto-summarize-storage';

// Debounce lets SPA content settle before extraction; the single retry covers
// slow-hydrating article bodies (e.g. NYT) that fail the readerability check
// on the first pass.
const TRIGGER_DEBOUNCE_MS = 1500;
const READERABLE_RETRY_MS = 2000;

export interface AutoTriggerController {
  evaluate(reason: 'load' | 'nav'): void;
  isSiteListed(): boolean;
}

interface AutoTriggerDeps {
  onTrigger: () => void;
  onSettingsChange?: () => void;
  isReaderable?: () => boolean;
  getLocation?: () => { hostname: string; href: string };
}

export function initAutoTrigger(deps: AutoTriggerDeps): AutoTriggerController {
  const getLocation = deps.getLocation ?? (() => window.location);
  const isReaderable = deps.isReaderable ?? (() => isProbablyReaderable(document));

  let settings: AutoSummarizeSettings = createDefaultAutoSummarizeSettings();
  const triggeredUrls = new Set<string>();
  let pendingTimer: ReturnType<typeof setTimeout> | null = null;
  let retried = false;

  function normalizedUrl(): string {
    try {
      const parsed = new URL(getLocation().href);
      parsed.hash = '';
      return parsed.toString();
    } catch {
      return getLocation().href;
    }
  }

  function shouldTrigger(): boolean {
    return settings.enabled
      && matchesAnySite(getLocation().hostname, settings.sites)
      && !triggeredUrls.has(normalizedUrl());
  }

  function check() {
    pendingTimer = null;
    if (!shouldTrigger()) return;

    if (!isReaderable()) {
      if (!retried) {
        retried = true;
        pendingTimer = setTimeout(check, READERABLE_RETRY_MS);
      }
      return;
    }

    triggeredUrls.add(normalizedUrl());
    deps.onTrigger();
  }

  function evaluate(_reason: 'load' | 'nav') {
    if (pendingTimer) clearTimeout(pendingTimer);
    retried = false;
    pendingTimer = setTimeout(check, TRIGGER_DEBOUNCE_MS);
  }

  void getAutoSummarizeSettings().then((loaded) => {
    settings = loaded;
    deps.onSettingsChange?.();
    evaluate('load');
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes[AUTO_SUMMARIZE_SETTINGS_KEY]) return;
    settings = normalizeAutoSummarizeSettings(changes[AUTO_SUMMARIZE_SETTINGS_KEY].newValue);
    deps.onSettingsChange?.();
  });

  return {
    evaluate,
    isSiteListed: () => matchesAnySite(getLocation().hostname, settings.sites),
  };
}
