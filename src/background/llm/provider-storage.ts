import type {
  ProviderConfig,
  ProviderId,
  StoredProviderConfig,
  StoredProvidersState,
} from '@/shared/types';
import { DEFAULT_PROVIDER_ID, getProviderDescriptor, isProviderId, providerDescriptors } from './provider-registry';

const PROVIDERS_STATE_STORAGE_KEY = 'providersState';
const PROVIDERS_STATE_VERSION = 1;

interface LegacyProviderStorageShape {
  apiKey?: unknown;
  model?: unknown;
  baseUrl?: unknown;
}

export function createDefaultProviderConfig(providerId: ProviderId): StoredProviderConfig {
  return getProviderDescriptor(providerId).normalizeConfig();
}

export function createDefaultProvidersState(activeProviderId: ProviderId = DEFAULT_PROVIDER_ID): StoredProvidersState {
  return {
    version: PROVIDERS_STATE_VERSION,
    activeProviderId,
    configsByProvider: Object.fromEntries(
      providerDescriptors.map((descriptor) => [descriptor.id, descriptor.normalizeConfig()]),
    ) as StoredProvidersState['configsByProvider'],
  };
}

export function normalizeProvidersState(rawState?: Partial<StoredProvidersState> | null): StoredProvidersState {
  const defaultState = createDefaultProvidersState();
  const activeProviderId = rawState?.activeProviderId && isProviderId(rawState.activeProviderId)
    ? rawState.activeProviderId
    : defaultState.activeProviderId;

  return {
    version: PROVIDERS_STATE_VERSION,
    activeProviderId,
    configsByProvider: Object.fromEntries(
      providerDescriptors.map((descriptor) => {
        const config = rawState?.configsByProvider?.[descriptor.id];
        return [descriptor.id, descriptor.normalizeConfig(config)];
      }),
    ) as StoredProvidersState['configsByProvider'],
  };
}

export function migrateLegacyProvidersState(rawStorage: LegacyProviderStorageShape): StoredProvidersState {
  const nextState = createDefaultProvidersState();
  nextState.configsByProvider.anthropic = getProviderDescriptor('anthropic').normalizeConfig({
    apiKey: typeof rawStorage.apiKey === 'string' ? rawStorage.apiKey : '',
    modelId: typeof rawStorage.model === 'string' ? rawStorage.model : undefined,
    baseUrl: typeof rawStorage.baseUrl === 'string' ? rawStorage.baseUrl : undefined,
  });
  return nextState;
}

export function deriveProvidersState(storage: {
  providersState?: unknown;
  apiKey?: unknown;
  model?: unknown;
  baseUrl?: unknown;
}): StoredProvidersState {
  if (storage.providersState && typeof storage.providersState === 'object') {
    return normalizeProvidersState(storage.providersState as Partial<StoredProvidersState>);
  }

  return migrateLegacyProvidersState(storage);
}

export async function getProvidersState(): Promise<StoredProvidersState> {
  const storage = await chrome.storage.local.get([
    PROVIDERS_STATE_STORAGE_KEY,
    'apiKey',
    'model',
    'baseUrl',
  ]);
  const nextState = deriveProvidersState(storage);

  const storedState = storage.providersState
    ? normalizeProvidersState(storage.providersState as Partial<StoredProvidersState>)
    : null;

  if (!storedState || JSON.stringify(storedState) !== JSON.stringify(nextState)) {
    await chrome.storage.local.set({ [PROVIDERS_STATE_STORAGE_KEY]: nextState });
  }

  return nextState;
}

export async function saveProvidersState(state: StoredProvidersState): Promise<StoredProvidersState> {
  const normalized = normalizeProvidersState(state);
  await chrome.storage.local.set({ [PROVIDERS_STATE_STORAGE_KEY]: normalized });
  return normalized;
}

export function getStoredProviderConfig(
  state: StoredProvidersState,
  providerId: ProviderId = state.activeProviderId,
): StoredProviderConfig {
  return getProviderDescriptor(providerId).normalizeConfig(state.configsByProvider[providerId]);
}

export function resolveProviderConfig(
  state: StoredProvidersState,
  providerId: ProviderId = state.activeProviderId,
): ProviderConfig {
  return getProviderDescriptor(providerId).resolveConfig(state.configsByProvider[providerId]);
}

export function hasProviderCredentials(config: StoredProviderConfig | ProviderConfig): boolean {
  return config.apiKey.trim().length > 0;
}
