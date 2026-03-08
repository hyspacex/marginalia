import type {
  ModelOption,
  ProviderConfig,
  ProviderId,
  StoredProviderConfig,
  TokenUsage,
} from '@/shared/types';

export type ProviderErrorCode =
  | 'auth'
  | 'rate_limit'
  | 'network'
  | 'protocol'
  | 'unsupported_model'
  | 'unknown';

export class ProviderError extends Error {
  code: ProviderErrorCode;
  providerId: ProviderId;
  status?: number;

  constructor(providerId: ProviderId, code: ProviderErrorCode, message: string, status?: number) {
    super(message);
    this.name = 'ProviderError';
    this.code = code;
    this.providerId = providerId;
    this.status = status;
  }
}

export interface ProviderField {
  key: string;
  label: string;
  type: 'password' | 'text' | 'url';
  target: 'apiKey' | 'baseUrl' | 'option';
  placeholder?: string;
  helpText?: string;
  required?: boolean;
}

export interface ProviderTransportDeps {
  fetch: typeof fetch;
}

export interface TextRequest {
  config: ProviderConfig;
  systemPrompt: string;
  userPrompt: string;
  maxOutputTokens: number;
}

export interface TextResult {
  text: string;
  usage: TokenUsage;
}

export interface StreamTextResult {
  usage: TokenUsage;
}

export interface ProviderTransport {
  generateText(request: TextRequest): Promise<TextResult>;
  streamText(
    request: TextRequest,
    onTextDelta: (delta: string) => void,
  ): Promise<StreamTextResult>;
  testConnection(config: ProviderConfig): Promise<void>;
}

export interface ProviderDescriptor {
  id: ProviderId;
  name: string;
  description: string;
  models: readonly ModelOption[];
  fields: readonly ProviderField[];
  normalizeConfig(config?: Partial<StoredProviderConfig>): StoredProviderConfig;
  resolveConfig(config?: Partial<StoredProviderConfig>): ProviderConfig;
  estimateCost(config: ProviderConfig, inputTokens: number, outputTokens: number): number | null;
  createTransport(deps?: Partial<ProviderTransportDeps>): ProviderTransport;
}
