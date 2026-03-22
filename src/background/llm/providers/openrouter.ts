import type { ModelOption, ProviderConfig, TokenUsage } from '@/shared/types';
import { consumeSseStream } from '../sse';
import {
  ProviderError,
  type ProviderTransport,
  type ProviderTransportDeps,
  type TextRequest,
} from '../provider';

function extractText(data: any): string {
  if (typeof data?.output_text === 'string') {
    return data.output_text;
  }

  if (!Array.isArray(data?.output)) return '';

  return data.output
    .flatMap((item: any) => Array.isArray(item?.content) ? item.content : [])
    .filter((part: any) => typeof part?.text === 'string')
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
    return parsed.error?.message || parsed.message || fallback;
  } catch {
    return fallback;
  }
}

function mapError(status: number, message: string): ProviderError {
  if (status === 401) {
    return new ProviderError('openrouter', 'auth', 'Invalid OpenRouter API key', status);
  }

  if (status === 429) {
    return new ProviderError('openrouter', 'rate_limit', 'OpenRouter rate limit exceeded', status);
  }

  if ((status === 400 || status === 404) && /(model|endpoint)/i.test(message)) {
    return new ProviderError('openrouter', 'unsupported_model', message, status);
  }

  return new ProviderError('openrouter', 'unknown', message, status);
}

function buildHeaders(config: ProviderConfig, includeContentType = true): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${config.apiKey}`,
    'X-Title': config.options.appTitle?.trim() || 'Marginalia',
  };

  const httpReferer = config.options.httpReferer?.trim();
  if (httpReferer) {
    headers['HTTP-Referer'] = httpReferer;
  }

  if (includeContentType) {
    headers['Content-Type'] = 'application/json';
  }

  return headers;
}

function supportsTextOutput(entry: any): boolean {
  const outputModalities = entry?.architecture?.output_modalities;
  if (Array.isArray(outputModalities) && outputModalities.length > 0) {
    return outputModalities.includes('text');
  }

  return true;
}

function parsePerTokenPrice(value: unknown): number | null {
  const parsed = typeof value === 'string'
    ? Number.parseFloat(value)
    : typeof value === 'number'
      ? value
      : Number.NaN;

  if (!Number.isFinite(parsed)) return null;
  return Number((parsed * 1000).toFixed(6));
}

function normalizeModelCatalogEntry(entry: any): ModelOption | null {
  const id = typeof entry?.id === 'string' ? entry.id.trim() : '';
  if (!id || !supportsTextOutput(entry)) return null;

  const name = typeof entry?.name === 'string' && entry.name.trim()
    ? entry.name.trim()
    : id;

  return {
    id,
    name,
    contextWindow: typeof entry?.context_length === 'number' && Number.isFinite(entry.context_length)
      ? entry.context_length
      : null,
    costPer1kInput: parsePerTokenPrice(entry?.pricing?.prompt),
    costPer1kOutput: parsePerTokenPrice(entry?.pricing?.completion),
  };
}

async function openRouterFetch(
  fetchImpl: typeof fetch,
  config: ProviderConfig,
  path: string,
  init: RequestInit,
): Promise<Response> {
  let response: Response;

  try {
    response = await fetchImpl(`${config.baseUrl}${path}`, init);
  } catch (error) {
    throw new ProviderError('openrouter', 'network', String(error));
  }

  if (!response.ok) {
    const bodyText = await response.text();
    throw mapError(response.status, parseErrorMessage(bodyText, `OpenRouter API error: ${response.status}`));
  }

  return response;
}

export function createOpenRouterTransport(
  deps: Partial<ProviderTransportDeps> = {},
): ProviderTransport {
  const fetchImpl = deps.fetch || fetch;

  return {
    async generateText(request: TextRequest) {
      const response = await openRouterFetch(fetchImpl, request.config, '/v1/responses', {
        method: 'POST',
        headers: buildHeaders(request.config),
        body: JSON.stringify({
          model: request.config.resolvedModel,
          instructions: request.systemPrompt,
          input: request.userPrompt,
          max_output_tokens: request.maxOutputTokens,
          store: false,
        }),
      });

      const data = await response.json();
      return {
        text: extractText(data),
        usage: extractUsage(data),
      };
    },

    async streamText(request: TextRequest, onTextDelta) {
      const response = await openRouterFetch(fetchImpl, request.config, '/v1/responses', {
        method: 'POST',
        headers: buildHeaders(request.config),
        body: JSON.stringify({
          model: request.config.resolvedModel,
          instructions: request.systemPrompt,
          input: request.userPrompt,
          max_output_tokens: request.maxOutputTokens,
          store: false,
          stream: true,
        }),
      });

      if (!response.body) {
        throw new ProviderError('openrouter', 'protocol', 'OpenRouter stream missing response body');
      }

      const usage: TokenUsage = { inputTokens: 0, outputTokens: 0 };

      await consumeSseStream('openrouter', response.body, (payload) => {
        if (payload === '[DONE]') return;

        let event: any;

        try {
          event = JSON.parse(payload);
        } catch {
          throw new ProviderError('openrouter', 'protocol', 'Failed to parse OpenRouter SSE event');
        }

        if (event.type === 'response.output_text.delta' && typeof event.delta === 'string') {
          onTextDelta(event.delta);
        }

        if (event.type === 'response.completed') {
          usage.inputTokens = event.response?.usage?.input_tokens || usage.inputTokens;
          usage.outputTokens = event.response?.usage?.output_tokens || usage.outputTokens;
        }

        if (event.type === 'response.failed') {
          const message = event.response?.error?.message || 'OpenRouter stream failed';
          throw new ProviderError('openrouter', 'unknown', message);
        }
      });

      return { usage };
    },

    async listModels(config: ProviderConfig) {
      const response = await openRouterFetch(fetchImpl, config, '/v1/models/user', {
        method: 'GET',
        headers: buildHeaders(config),
      });
      const data = await response.json();

      if (!Array.isArray(data?.data)) {
        throw new ProviderError('openrouter', 'protocol', 'OpenRouter model list did not match the expected shape');
      }

      return data.data
        .map(normalizeModelCatalogEntry)
        .filter((model: ModelOption | null): model is ModelOption => model != null)
        .sort((left: ModelOption, right: ModelOption) => left.name.localeCompare(right.name));
    },

    async testConnection(config: ProviderConfig) {
      const response = await openRouterFetch(fetchImpl, config, '/v1/responses', {
        method: 'POST',
        headers: buildHeaders(config),
        body: JSON.stringify({
          model: config.resolvedModel,
          instructions: 'Respond with "ok".',
          input: 'Test',
          max_output_tokens: 16,
          store: false,
        }),
      });

      await response.json();
    },
  };
}
