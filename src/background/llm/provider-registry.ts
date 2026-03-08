import type {
  ModelOption,
  ProviderConfig,
  ProviderId,
  StoredProviderConfig,
} from '@/shared/types';
import type { ProviderDescriptor } from './provider';
import { createAnthropicTransport } from './providers/anthropic';
import { createOpenAiTransport } from './providers/openai';

const DEFAULT_MODEL_MODE = 'catalog' as const;

const ANTHROPIC_MODELS: readonly ModelOption[] = [
  {
    id: 'claude-sonnet-4-6',
    name: 'Claude Sonnet 4.6',
    contextWindow: 200000,
    costPer1kInput: 0.003,
    costPer1kOutput: 0.015,
  },
  {
    id: 'claude-haiku-3-5-20241022',
    name: 'Claude Haiku 3.5',
    contextWindow: 200000,
    costPer1kInput: 0.0008,
    costPer1kOutput: 0.004,
  },
];

const OPENAI_MODELS: readonly ModelOption[] = [
  {
    id: 'gpt-5.4-2026-03-05',
    name: 'GPT-5.4 (2026-03-05)',
    contextWindow: 1050000,
    costPer1kInput: 0.0025,
    costPer1kOutput: 0.015,
  },
  {
    id: 'gpt-5.4-pro-2026-03-05',
    name: 'GPT-5.4 Pro (2026-03-05)',
    contextWindow: 1050000,
    costPer1kInput: 0.03,
    costPer1kOutput: 0.18,
  },
  {
    id: 'gpt-5-mini',
    name: 'GPT-5 mini',
    contextWindow: 400000,
    costPer1kInput: 0.00025,
    costPer1kOutput: 0.002,
  },
];

const ANTHROPIC_LEGACY_MODEL_IDS: Record<string, string> = {
  'claude-sonnet-4-5-20250929': 'claude-sonnet-4-6',
};

const PROVIDERS: Record<ProviderId, ProviderDescriptor> = {
  anthropic: createProviderDescriptor({
    id: 'anthropic',
    name: 'Anthropic',
    description: 'Claude via the Anthropic Messages API.',
    defaultBaseUrl: 'https://api.anthropic.com',
    defaultModelId: 'claude-sonnet-4-6',
    models: ANTHROPIC_MODELS,
    legacyModelIds: ANTHROPIC_LEGACY_MODEL_IDS,
    fields: [
      {
        key: 'apiKey',
        label: 'API Key',
        type: 'password',
        target: 'apiKey',
        placeholder: 'sk-ant-...',
        required: true,
      },
      {
        key: 'baseUrl',
        label: 'Base URL',
        type: 'url',
        target: 'baseUrl',
        placeholder: 'https://api.anthropic.com',
      },
    ],
    createTransport: createAnthropicTransport,
  }),
  openai: createProviderDescriptor({
    id: 'openai',
    name: 'OpenAI',
    description: 'GPT models via the OpenAI Responses API.',
    defaultBaseUrl: 'https://api.openai.com',
    defaultModelId: 'gpt-5.4-2026-03-05',
    models: OPENAI_MODELS,
    fields: [
      {
        key: 'apiKey',
        label: 'API Key',
        type: 'password',
        target: 'apiKey',
        placeholder: 'sk-...',
        required: true,
      },
      {
        key: 'baseUrl',
        label: 'Base URL',
        type: 'url',
        target: 'baseUrl',
        placeholder: 'https://api.openai.com',
        helpText: 'Use only if you need a compatible API endpoint override.',
      },
    ],
    createTransport: createOpenAiTransport,
  }),
};

function createProviderDescriptor(args: {
  id: ProviderId;
  name: string;
  description: string;
  defaultBaseUrl: string;
  defaultModelId: string;
  models: readonly ModelOption[];
  fields: ProviderDescriptor['fields'];
  legacyModelIds?: Record<string, string>;
  createTransport: ProviderDescriptor['createTransport'];
}): ProviderDescriptor {
  const modelIds = new Set(args.models.map((model) => model.id));

  function normalizeModelId(rawModelId: string): string {
    const modelId = rawModelId.trim();
    const mappedModelId = args.legacyModelIds?.[modelId] || modelId;
    return modelIds.has(mappedModelId) ? mappedModelId : args.defaultModelId;
  }

  function normalizeConfig(config: Partial<StoredProviderConfig> = {}): StoredProviderConfig {
    const modelMode = config.modelMode === 'custom' ? 'custom' : DEFAULT_MODEL_MODE;
    const rawModelId = typeof config.modelId === 'string' ? config.modelId : args.defaultModelId;
    const normalizedModelId = modelMode === 'custom'
      ? rawModelId.trim() || args.defaultModelId
      : normalizeModelId(rawModelId);

    return {
      apiKey: typeof config.apiKey === 'string' ? config.apiKey.trim() : '',
      baseUrl: normalizeBaseUrl(typeof config.baseUrl === 'string' ? config.baseUrl : args.defaultBaseUrl),
      modelMode,
      modelId: normalizedModelId,
      options: normalizeOptions(config.options),
    };
  }

  function resolveConfig(config: Partial<StoredProviderConfig> = {}): ProviderConfig {
    const normalized = normalizeConfig(config);
    const resolvedModel = normalized.modelMode === 'custom'
      ? normalized.modelId.trim() || args.defaultModelId
      : normalizeModelId(normalized.modelId);

    return {
      providerId: args.id,
      apiKey: normalized.apiKey,
      baseUrl: normalized.baseUrl,
      modelMode: normalized.modelMode,
      modelId: normalized.modelId,
      options: normalized.options,
      resolvedModel,
    };
  }

  function estimateCost(config: ProviderConfig, inputTokens: number, outputTokens: number): number | null {
    const model = args.models.find((entry) => entry.id === config.resolvedModel);
    if (!model || model.costPer1kInput == null || model.costPer1kOutput == null) {
      return null;
    }

    return (inputTokens * model.costPer1kInput + outputTokens * model.costPer1kOutput) / 1000;
  }

  return Object.freeze({
    id: args.id,
    name: args.name,
    description: args.description,
    models: args.models,
    fields: args.fields,
    normalizeConfig,
    resolveConfig,
    estimateCost,
    createTransport: args.createTransport,
  });
}

function normalizeBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim();
  return trimmed.replace(/\/+$/, '');
}

function normalizeOptions(options: StoredProviderConfig['options'] | undefined): Record<string, string> {
  if (!options || typeof options !== 'object') return {};

  return Object.fromEntries(
    Object.entries(options)
      .filter((entry): entry is [string, string] => typeof entry[0] === 'string' && typeof entry[1] === 'string')
      .map(([key, value]) => [key, value.trim()]),
  );
}

export const providerRegistry = Object.freeze(PROVIDERS);

export const providerDescriptors = Object.freeze(
  (Object.keys(PROVIDERS) as ProviderId[]).map((providerId) => PROVIDERS[providerId]),
);

export const DEFAULT_PROVIDER_ID: ProviderId = 'anthropic';

export function isProviderId(value: string): value is ProviderId {
  return value === 'anthropic' || value === 'openai';
}

export function getProviderDescriptor(providerId: ProviderId): ProviderDescriptor {
  return providerRegistry[providerId];
}

export function getProviderModel(providerId: ProviderId, modelId: string): ModelOption | undefined {
  return providerRegistry[providerId].models.find((model) => model.id === modelId);
}
