import type { ModelOption, ProviderConfig, TokenUsage } from '@/shared/types';
import { consumeSseStream } from '../sse';
import {
  ProviderError,
  type ProviderTransport,
  type ProviderTransportDeps,
  type TextRequest,
} from '../provider';

interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface AnthropicRequest {
  model: string;
  max_tokens: number;
  system: string;
  messages: AnthropicMessage[];
  stream?: boolean;
  fallbacks?: 'default';
}

const API_VERSION = '2023-06-01';
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';
const DEFAULT_BASE_URL = 'https://api.anthropic.com';

// Models whose safety classifiers can decline a request and that accept
// server-side fallback: a declined request is re-run on the model Anthropic
// recommends for that refusal category, inside the same call (and on the same
// stream). Haiku 5.5 has no fallback, so it is not listed.
const FALLBACK_MODELS = new Set([
  'claude-opus-5-5',
  'claude-opus-5',
  'claude-sonnet-5-5',
  'claude-fable-5-1',
  'claude-fable-5',
]);

function usesFallback(config: ProviderConfig): boolean {
  // Server-side fallback exists on the Claude API itself, not on proxies.
  return config.baseUrl === DEFAULT_BASE_URL && FALLBACK_MODELS.has(config.resolvedModel);
}

function messageBody(config: ProviderConfig, body: AnthropicRequest): AnthropicRequest {
  return usesFallback(config) ? { ...body, fallbacks: 'default' } : body;
}

function buildHeaders(config: ProviderConfig): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-api-key': config.apiKey,
    'anthropic-version': API_VERSION,
    'anthropic-dangerous-direct-browser-access': 'true',
  };
  if (usesFallback(config)) {
    headers['anthropic-beta'] = FALLBACK_BETA;
  }
  return headers;
}

// A decline (classifier or model) is an HTTP 200 with stop_reason "refusal".
// With fallbacks it means every model in the chain declined.
function refusalError(stopDetails: any): ProviderError {
  const category = typeof stopDetails?.category === 'string' ? ` (${stopDetails.category})` : '';
  return new ProviderError('anthropic', 'unknown', `Claude declined this request${category}`);
}

function extractText(data: any): string {
  if (!Array.isArray(data?.content)) return '';

  return data.content
    .filter((part: any) => part?.type === 'text' && typeof part.text === 'string')
    .map((part: any) => part.text)
    .join('');
}

function extractUsage(data: any): TokenUsage {
  return {
    inputTokens: data?.usage?.input_tokens || 0,
    outputTokens: data?.usage?.output_tokens || 0,
  };
}

function parseErrorMessage(bodyText: string, fallback: string): string {
  try {
    const parsed = JSON.parse(bodyText);
    return parsed.error?.message || fallback;
  } catch {
    return fallback;
  }
}

function mapError(status: number, message: string): ProviderError {
  if (status === 401) {
    return new ProviderError('anthropic', 'auth', 'Invalid Anthropic API key', status);
  }

  if (status === 429) {
    return new ProviderError('anthropic', 'rate_limit', 'Anthropic rate limit exceeded', status);
  }

  if (status === 400 && /model/i.test(message)) {
    return new ProviderError('anthropic', 'unsupported_model', message, status);
  }

  return new ProviderError('anthropic', 'unknown', message, status);
}

function normalizeModelCatalogEntry(entry: any): ModelOption | null {
  const id = typeof entry?.id === 'string' ? entry.id.trim() : '';
  if (!id) return null;

  const name = typeof entry?.display_name === 'string' && entry.display_name.trim()
    ? entry.display_name.trim()
    : id;

  return {
    id,
    name,
    contextWindow: typeof entry?.max_input_tokens === 'number' ? entry.max_input_tokens : null,
    costPer1kInput: null,
    costPer1kOutput: null,
  };
}

async function anthropicFetch(
  fetchImpl: typeof fetch,
  config: ProviderConfig,
  body: AnthropicRequest,
): Promise<Response> {
  let response: Response;

  try {
    response = await fetchImpl(`${config.baseUrl}/v1/messages`, {
      method: 'POST',
      headers: buildHeaders(config),
      body: JSON.stringify(messageBody(config, body)),
    });
  } catch (error) {
    throw new ProviderError('anthropic', 'network', String(error));
  }

  if (!response.ok) {
    const bodyText = await response.text();
    throw mapError(response.status, parseErrorMessage(bodyText, `Anthropic API error: ${response.status}`));
  }

  return response;
}

async function anthropicGet(fetchImpl: typeof fetch, config: ProviderConfig, path: string): Promise<Response> {
  let response: Response;

  try {
    response = await fetchImpl(`${config.baseUrl}${path}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': config.apiKey,
        'anthropic-version': API_VERSION,
        'anthropic-dangerous-direct-browser-access': 'true',
      },
    });
  } catch (error) {
    throw new ProviderError('anthropic', 'network', String(error));
  }

  if (!response.ok) {
    const bodyText = await response.text();
    throw mapError(response.status, parseErrorMessage(bodyText, `Anthropic API error: ${response.status}`));
  }

  return response;
}

export function createAnthropicTransport(
  deps: Partial<ProviderTransportDeps> = {},
): ProviderTransport {
  const fetchImpl = deps.fetch || fetch;

  return {
    async generateText(request: TextRequest) {
      const response = await anthropicFetch(fetchImpl, request.config, {
        model: request.config.resolvedModel,
        max_tokens: request.maxOutputTokens,
        system: request.systemPrompt,
        messages: [{ role: 'user', content: request.userPrompt }],
      });

      const data = await response.json();
      if (data?.stop_reason === 'refusal') {
        throw refusalError(data.stop_details);
      }

      return {
        text: extractText(data),
        usage: extractUsage(data),
      };
    },

    async streamText(request: TextRequest, onTextDelta) {
      const response = await anthropicFetch(fetchImpl, request.config, {
        model: request.config.resolvedModel,
        max_tokens: request.maxOutputTokens,
        system: request.systemPrompt,
        messages: [{ role: 'user', content: request.userPrompt }],
        stream: true,
      });

      if (!response.body) {
        throw new ProviderError('anthropic', 'protocol', 'Anthropic stream missing response body');
      }

      const usage: TokenUsage = { inputTokens: 0, outputTokens: 0 };

      await consumeSseStream('anthropic', response.body, (payload) => {
        if (payload === '[DONE]') return;

        let event: any;

        try {
          event = JSON.parse(payload);
        } catch {
          throw new ProviderError('anthropic', 'protocol', 'Failed to parse Anthropic SSE event');
        }

        // Thinking deltas (on by default for current models) carry `thinking`,
        // not `text`, so only answer text reaches the parser.
        if (event.type === 'content_block_delta' && event.delta?.text) {
          onTextDelta(event.delta.text);
        }

        if (event.type === 'message_start' && event.message?.usage) {
          usage.inputTokens = event.message.usage.input_tokens || 0;
        }

        if (event.type === 'message_delta' && event.usage) {
          usage.outputTokens = event.usage.output_tokens || 0;
        }

        if (event.type === 'message_delta' && event.delta?.stop_reason === 'refusal') {
          throw refusalError(event.delta.stop_details);
        }

        if (event.type === 'error') {
          throw new ProviderError('anthropic', 'unknown', event.error?.message || 'Anthropic stream failed');
        }
      });

      return { usage };
    },

    async listModels(config: ProviderConfig) {
      const response = await anthropicGet(fetchImpl, config, '/v1/models');
      const data = await response.json();

      if (!Array.isArray(data?.data)) {
        throw new ProviderError('anthropic', 'protocol', 'Anthropic model list did not match the expected shape');
      }

      return data.data
        .map(normalizeModelCatalogEntry)
        .filter((model: ModelOption | null): model is ModelOption => model != null)
        .sort((left: ModelOption, right: ModelOption) => left.name.localeCompare(right.name));
    },

    async testConnection(config: ProviderConfig) {
      const response = await anthropicFetch(fetchImpl, config, {
        model: config.resolvedModel,
        max_tokens: 10,
        system: 'Respond with "ok".',
        messages: [{ role: 'user', content: 'Test' }],
      });

      await response.json();
    },
  };
}
