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
    return parsed.error?.message || fallback;
  } catch {
    return fallback;
  }
}

function mapError(status: number, message: string): ProviderError {
  if (status === 401) {
    return new ProviderError('openai', 'auth', 'Invalid OpenAI API key', status);
  }

  if (status === 429) {
    return new ProviderError('openai', 'rate_limit', 'OpenAI rate limit exceeded', status);
  }

  if (status === 400 && /model/i.test(message)) {
    return new ProviderError('openai', 'unsupported_model', message, status);
  }

  return new ProviderError('openai', 'unknown', message, status);
}

function normalizeModelCatalogEntry(entry: any): ModelOption | null {
  const id = typeof entry?.id === 'string' ? entry.id.trim() : '';
  if (!id || !isLikelyResponsesModel(id)) return null;

  return {
    id,
    name: id,
    contextWindow: null,
    costPer1kInput: null,
    costPer1kOutput: null,
  };
}

function isLikelyResponsesModel(modelId: string): boolean {
  const lower = modelId.toLowerCase();
  if (!lower) return false;

  const excludedPrefixes = [
    'babbage',
    'computer-use',
    'dall',
    'davinci',
    'gpt-audio',
    'gpt-image',
    'gpt-realtime',
    'omni-moderation',
    'sora',
    'text-embedding',
    'text-moderation',
    'text-search',
    'tts',
    'whisper',
  ];

  if (excludedPrefixes.some((prefix) => lower.startsWith(prefix))) {
    return false;
  }

  return lower.startsWith('gpt')
    || lower.startsWith('o')
    || lower.startsWith('chatgpt')
    || lower.startsWith('codex');
}

async function openAiFetch(
  fetchImpl: typeof fetch,
  config: ProviderConfig,
  body: Record<string, unknown>,
): Promise<Response> {
  let response: Response;

  try {
    response = await fetchImpl(`${config.baseUrl}/v1/responses`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify(body),
    });
  } catch (error) {
    throw new ProviderError('openai', 'network', String(error));
  }

  if (!response.ok) {
    const bodyText = await response.text();
    throw mapError(response.status, parseErrorMessage(bodyText, `OpenAI API error: ${response.status}`));
  }

  return response;
}

async function openAiGet(fetchImpl: typeof fetch, config: ProviderConfig, path: string): Promise<Response> {
  let response: Response;

  try {
    response = await fetchImpl(`${config.baseUrl}${path}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
    });
  } catch (error) {
    throw new ProviderError('openai', 'network', String(error));
  }

  if (!response.ok) {
    const bodyText = await response.text();
    throw mapError(response.status, parseErrorMessage(bodyText, `OpenAI API error: ${response.status}`));
  }

  return response;
}

export function createOpenAiTransport(
  deps: Partial<ProviderTransportDeps> = {},
): ProviderTransport {
  const fetchImpl = deps.fetch || fetch;

  return {
    async generateText(request: TextRequest) {
      const response = await openAiFetch(fetchImpl, request.config, {
        model: request.config.resolvedModel,
        instructions: request.systemPrompt,
        input: request.userPrompt,
        max_output_tokens: request.maxOutputTokens,
        store: false,
      });

      const data = await response.json();
      return {
        text: extractText(data),
        usage: extractUsage(data),
      };
    },

    async streamText(request: TextRequest, onTextDelta) {
      const response = await openAiFetch(fetchImpl, request.config, {
        model: request.config.resolvedModel,
        instructions: request.systemPrompt,
        input: request.userPrompt,
        max_output_tokens: request.maxOutputTokens,
        store: false,
        stream: true,
      });

      if (!response.body) {
        throw new ProviderError('openai', 'protocol', 'OpenAI stream missing response body');
      }

      const usage: TokenUsage = { inputTokens: 0, outputTokens: 0 };

      await consumeSseStream('openai', response.body, (payload) => {
        if (payload === '[DONE]') return;

        let event: any;

        try {
          event = JSON.parse(payload);
        } catch {
          throw new ProviderError('openai', 'protocol', 'Failed to parse OpenAI SSE event');
        }

        if (event.type === 'response.output_text.delta' && typeof event.delta === 'string') {
          onTextDelta(event.delta);
        }

        if (event.type === 'response.completed') {
          usage.inputTokens = event.response?.usage?.input_tokens || usage.inputTokens;
          usage.outputTokens = event.response?.usage?.output_tokens || usage.outputTokens;
        }

        if (event.type === 'response.failed') {
          const message = event.response?.error?.message || 'OpenAI stream failed';
          throw new ProviderError('openai', 'unknown', message);
        }
      });

      return { usage };
    },

    async listModels(config: ProviderConfig) {
      const response = await openAiGet(fetchImpl, config, '/v1/models');
      const data = await response.json();

      if (!Array.isArray(data?.data)) {
        throw new ProviderError('openai', 'protocol', 'OpenAI model list did not match the expected shape');
      }

      return data.data
        .map(normalizeModelCatalogEntry)
        .filter((model: ModelOption | null): model is ModelOption => model != null)
        .sort((left: ModelOption, right: ModelOption) => left.name.localeCompare(right.name));
    },

    async testConnection(config: ProviderConfig) {
      const response = await openAiFetch(fetchImpl, config, {
        model: config.resolvedModel,
        instructions: 'Respond with "ok".',
        input: 'Test',
        max_output_tokens: 16,
        store: false,
      });

      await response.json();
    },
  };
}
