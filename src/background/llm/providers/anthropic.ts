import type { ProviderConfig, TokenUsage } from '@/shared/types';
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

async function anthropicFetch(
  fetchImpl: typeof fetch,
  config: ProviderConfig,
  body: AnthropicRequest,
): Promise<Response> {
  let response: Response;

  try {
    response = await fetchImpl(`${config.baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': config.apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify(body),
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

        if (event.type === 'content_block_delta' && event.delta?.text) {
          onTextDelta(event.delta.text);
        }

        if (event.type === 'message_start' && event.message?.usage) {
          usage.inputTokens = event.message.usage.input_tokens || 0;
        }

        if (event.type === 'message_delta' && event.usage) {
          usage.outputTokens = event.usage.output_tokens || 0;
        }

        if (event.type === 'error') {
          throw new ProviderError('anthropic', 'unknown', event.error?.message || 'Anthropic stream failed');
        }
      });

      return { usage };
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
