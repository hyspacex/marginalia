import { normalizeSiteEntry } from '@/shared/site-match';

export const AUTO_SUMMARIZE_SETTINGS_KEY = 'autoSummarizeSettings';
const AUTO_SUMMARIZE_SETTINGS_VERSION = 1;

export interface AutoSummarizeSettings {
  version: number;
  enabled: boolean;
  sites: string[];
  // Model override on the ACTIVE provider for auto-runs; null = same model as
  // manual runs. Scoped to the active provider so its stored key/baseUrl apply.
  autoModelId: string | null;
}

export function createDefaultAutoSummarizeSettings(): AutoSummarizeSettings {
  return {
    version: AUTO_SUMMARIZE_SETTINGS_VERSION,
    enabled: true,
    sites: [],
    autoModelId: null,
  };
}

export function normalizeAutoSummarizeSettings(raw: unknown): AutoSummarizeSettings {
  const defaults = createDefaultAutoSummarizeSettings();
  if (!raw || typeof raw !== 'object') return defaults;

  const record = raw as Record<string, unknown>;
  const sites = Array.isArray(record.sites)
    ? Array.from(new Set(
        record.sites
          .filter((site): site is string => typeof site === 'string')
          .map((site) => normalizeSiteEntry(site))
          .filter((site): site is string => site !== null),
      ))
    : defaults.sites;

  return {
    version: AUTO_SUMMARIZE_SETTINGS_VERSION,
    enabled: typeof record.enabled === 'boolean' ? record.enabled : defaults.enabled,
    sites,
    autoModelId: typeof record.autoModelId === 'string' && record.autoModelId.trim() !== ''
      ? record.autoModelId
      : null,
  };
}

export async function getAutoSummarizeSettings(): Promise<AutoSummarizeSettings> {
  const storage = await chrome.storage.local.get(AUTO_SUMMARIZE_SETTINGS_KEY);
  return normalizeAutoSummarizeSettings(storage[AUTO_SUMMARIZE_SETTINGS_KEY]);
}

export async function saveAutoSummarizeSettings(
  settings: AutoSummarizeSettings,
): Promise<AutoSummarizeSettings> {
  const normalized = normalizeAutoSummarizeSettings(settings);
  await chrome.storage.local.set({ [AUTO_SUMMARIZE_SETTINGS_KEY]: normalized });
  return normalized;
}
