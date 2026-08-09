import type { ModelOption, ProviderConfig, TokenUsage } from '@/shared/types';
import { consumeSseStream } from '../sse';
import {
  ProviderError,
  type ProviderTransport,
  type ProviderTransportDeps,
  type TextRequest,
} from '../provider';

// OpenAI-compatible chat-completions transport for self-hosted servers
// (llama.cpp, vLLM, LM Studio, Ollama, ...). The base URL points at the API
// root including /v1; a pasted full completions URL is tolerated.

function apiRoot(config: ProviderConfig): string {
  return config.baseUrl.replace(/\/+$/, '').replace(/\/chat\/completions$/, '');
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
  if (status === 401 || status === 403) {
    return new ProviderError('local', 'auth', 'Local endpoint rejected the API key', status);
  }

  if (status === 429) {
    return new ProviderError('local', 'rate_limit', 'Local endpoint rate limit exceeded', status);
  }

  if ((status === 400 || status === 404) && /model/i.test(message)) {
    return new ProviderError('local', 'unsupported_model', message, status);
  }

  return new ProviderError('local', 'unknown', message, status);
}

function buildHeaders(config: ProviderConfig, includeContentType = true): Record<string, string> {
  const headers: Record<string, string> = {};

  if (config.apiKey.trim()) {
    headers.Authorization = `Bearer ${config.apiKey}`;
  }

  if (includeContentType) {
    headers['Content-Type'] = 'application/json';
  }

  return headers;
}

function extractUsage(data: any): TokenUsage {
  return {
    inputTokens: data?.usage?.prompt_tokens || 0,
    outputTokens: data?.usage?.completion_tokens || 0,
  };
}

function chatBody(request: TextRequest, stream: boolean): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: request.config.resolvedModel,
    messages: [
      { role: 'system', content: request.systemPrompt },
      { role: 'user', content: request.userPrompt },
    ],
    max_tokens: request.maxOutputTokens,
    stream,
  };

  if (stream) {
    body.stream_options = { include_usage: true };
  }

  return body;
}

async function localFetch(
  fetchImpl: typeof fetch,
  config: ProviderConfig,
  path: string,
  init: RequestInit,
): Promise<Response> {
  let response: Response;

  try {
    response = await fetchImpl(`${apiRoot(config)}${path}`, init);
  } catch (error) {
    throw new ProviderError('local', 'network', String(error));
  }

  if (!response.ok) {
    const bodyText = await response.text();
    throw mapError(response.status, parseErrorMessage(bodyText, `Local endpoint error: ${response.status}`));
  }

  return response;
}

export function createLocalTransport(
  deps: Partial<ProviderTransportDeps> = {},
): ProviderTransport {
  const fetchImpl = deps.fetch || fetch;

  return {
    async generateText(request: TextRequest) {
      const response = await localFetch(fetchImpl, request.config, '/chat/completions', {
        method: 'POST',
        headers: buildHeaders(request.config),
        body: JSON.stringify(chatBody(request, false)),
      });

      const data = await response.json();
      const text = data?.choices?.[0]?.message?.content;

      return {
        text: typeof text === 'string' ? text : '',
        usage: extractUsage(data),
      };
    },

    async streamText(request: TextRequest, onTextDelta) {
      const response = await localFetch(fetchImpl, request.config, '/chat/completions', {
        method: 'POST',
        headers: buildHeaders(request.config),
        body: JSON.stringify(chatBody(request, true)),
      });

      if (!response.body) {
        throw new ProviderError('local', 'protocol', 'Local endpoint stream missing response body');
      }

      const usage: TokenUsage = { inputTokens: 0, outputTokens: 0 };

      await consumeSseStream('local', response.body, (payload) => {
        if (payload === '[DONE]') return;

        let event: any;

        try {
          event = JSON.parse(payload);
        } catch {
          throw new ProviderError('local', 'protocol', 'Failed to parse local endpoint SSE event');
        }

        const delta = event?.choices?.[0]?.delta?.content;
        if (typeof delta === 'string' && delta.length > 0) {
          onTextDelta(delta);
        }

        if (event?.usage) {
          usage.inputTokens = event.usage.prompt_tokens || usage.inputTokens;
          usage.outputTokens = event.usage.completion_tokens || usage.outputTokens;
        }
      });

      return { usage };
    },

    async listModels(config: ProviderConfig) {
      const response = await localFetch(fetchImpl, config, '/models', {
        method: 'GET',
        headers: buildHeaders(config),
      });
      const data = await response.json();
      const entries = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : null;

      if (!entries) {
        throw new ProviderError('local', 'protocol', 'Local endpoint model list did not match the expected shape');
      }

      return entries
        .map((entry: any): ModelOption | null => {
          const id = typeof entry?.id === 'string' ? entry.id.trim() : '';
          if (!id) return null;

          return {
            id,
            name: id,
            contextWindow: typeof entry?.context_length === 'number' && Number.isFinite(entry.context_length)
              ? entry.context_length
              : null,
            costPer1kInput: null,
            costPer1kOutput: null,
          };
        })
        .filter((model: ModelOption | null): model is ModelOption => model != null)
        .sort((left: ModelOption, right: ModelOption) => left.name.localeCompare(right.name));
    },

    async testConnection(config: ProviderConfig) {
      const response = await localFetch(fetchImpl, config, '/chat/completions', {
        method: 'POST',
        headers: buildHeaders(config),
        body: JSON.stringify({
          model: config.resolvedModel,
          messages: [
            { role: 'system', content: 'Respond with "ok".' },
            { role: 'user', content: 'Test' },
          ],
          max_tokens: 16,
          stream: false,
        }),
      });

      await response.json();
    },
  };
}
