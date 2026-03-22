import type { ModelOption, ProviderConfig, ProviderId } from '@/shared/types';
import { getProviderDescriptor, providerDescriptors } from './provider-registry';

const PROVIDER_MODEL_CATALOG_STORAGE_KEY = 'providerModelCatalogs';
const PROVIDER_MODEL_CATALOG_VERSION = 1;

interface StoredProviderModelCatalog {
  fetchedAt: string;
  models: ModelOption[];
}

interface StoredProviderModelCatalogState {
  version: number;
  catalogsByProvider: Partial<Record<ProviderId, StoredProviderModelCatalog>>;
}

function normalizeNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function normalizeModelOption(model: Partial<ModelOption> | null | undefined): ModelOption | null {
  const id = typeof model?.id === 'string' ? model.id.trim() : '';
  if (!id) return null;

  const name = typeof model?.name === 'string' && model.name.trim()
    ? model.name.trim()
    : id;

  return {
    id,
    name,
    contextWindow: normalizeNumber(model?.contextWindow),
    costPer1kInput: normalizeNumber(model?.costPer1kInput),
    costPer1kOutput: normalizeNumber(model?.costPer1kOutput),
  };
}

function mergeWithFallbackModel(providerId: ProviderId, model: ModelOption): ModelOption {
  const fallback = getProviderDescriptor(providerId).models.find((entry) => entry.id === model.id);
  if (!fallback) return model;

  return {
    id: model.id,
    name: model.name || fallback.name,
    contextWindow: model.contextWindow ?? fallback.contextWindow,
    costPer1kInput: model.costPer1kInput ?? fallback.costPer1kInput,
    costPer1kOutput: model.costPer1kOutput ?? fallback.costPer1kOutput,
  };
}

function normalizeStoredCatalog(
  providerId: ProviderId,
  catalog: Partial<StoredProviderModelCatalog> | undefined,
): StoredProviderModelCatalog | undefined {
  if (!catalog || typeof catalog !== 'object') return undefined;

  const deduped = new Map<string, ModelOption>();
  const rawModels = Array.isArray(catalog.models) ? catalog.models : [];

  for (const rawModel of rawModels) {
    const normalized = normalizeModelOption(rawModel);
    if (!normalized) continue;
    deduped.set(normalized.id, mergeWithFallbackModel(providerId, normalized));
  }

  if (deduped.size === 0) return undefined;

  return {
    fetchedAt: typeof catalog.fetchedAt === 'string' && catalog.fetchedAt.trim()
      ? catalog.fetchedAt
      : new Date(0).toISOString(),
    models: Array.from(deduped.values()),
  };
}

function normalizeState(rawState?: Partial<StoredProviderModelCatalogState> | null): StoredProviderModelCatalogState {
  const catalogsByProvider: StoredProviderModelCatalogState['catalogsByProvider'] = {};

  for (const descriptor of providerDescriptors) {
    const normalized = normalizeStoredCatalog(descriptor.id, rawState?.catalogsByProvider?.[descriptor.id]);
    if (normalized) {
      catalogsByProvider[descriptor.id] = normalized;
    }
  }

  return {
    version: PROVIDER_MODEL_CATALOG_VERSION,
    catalogsByProvider,
  };
}

async function getCatalogState(): Promise<StoredProviderModelCatalogState> {
  const storage = await chrome.storage.local.get(PROVIDER_MODEL_CATALOG_STORAGE_KEY);
  const normalized = normalizeState(storage[PROVIDER_MODEL_CATALOG_STORAGE_KEY] as Partial<StoredProviderModelCatalogState> | undefined);

  const storedState = storage[PROVIDER_MODEL_CATALOG_STORAGE_KEY]
    ? normalizeState(storage[PROVIDER_MODEL_CATALOG_STORAGE_KEY] as Partial<StoredProviderModelCatalogState>)
    : null;

  if (!storedState || JSON.stringify(storedState) !== JSON.stringify(normalized)) {
    await chrome.storage.local.set({ [PROVIDER_MODEL_CATALOG_STORAGE_KEY]: normalized });
  }

  return normalized;
}

export async function saveProviderModelCatalog(providerId: ProviderId, models: ModelOption[]): Promise<ModelOption[]> {
  const state = await getCatalogState();
  const normalizedModels = models
    .map((model) => normalizeModelOption(model))
    .filter((model): model is ModelOption => model != null)
    .map((model) => mergeWithFallbackModel(providerId, model));

  state.catalogsByProvider[providerId] = {
    fetchedAt: new Date().toISOString(),
    models: normalizedModels,
  };

  await chrome.storage.local.set({ [PROVIDER_MODEL_CATALOG_STORAGE_KEY]: normalizeState(state) });
  return normalizedModels;
}

export async function getProviderModelCatalog(providerId: ProviderId): Promise<ModelOption[]> {
  const state = await getCatalogState();
  return state.catalogsByProvider[providerId]?.models || [...getProviderDescriptor(providerId).models];
}

export async function getProviderModel(providerId: ProviderId, modelId: string): Promise<ModelOption | undefined> {
  const catalog = await getProviderModelCatalog(providerId);
  const normalizedModelId = modelId.trim();
  if (!normalizedModelId) return undefined;

  return catalog.find((model) => model.id === normalizedModelId)
    || getProviderDescriptor(providerId).models.find((model) => model.id === normalizedModelId);
}

export async function estimateProviderCost(
  config: ProviderConfig,
  inputTokens: number,
  outputTokens: number,
): Promise<number | null> {
  const model = await getProviderModel(config.providerId, config.resolvedModel);
  if (!model || model.costPer1kInput == null || model.costPer1kOutput == null) {
    return null;
  }

  return (inputTokens * model.costPer1kInput + outputTokens * model.costPer1kOutput) / 1000;
}
