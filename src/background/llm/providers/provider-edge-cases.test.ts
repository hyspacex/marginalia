import type { ProviderConfig } from '@/shared/types';
import { createAnthropicTransport } from './anthropic';
import { createOpenAiTransport } from './openai';
import { createOpenRouterTransport } from './openrouter';

function createSseResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();

  return new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  }), {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

const anthropicConfig: ProviderConfig = {
  providerId: 'anthropic',
  apiKey: 'sk-ant-test',
  baseUrl: 'https://api.anthropic.com',
  modelMode: 'catalog',
  modelId: 'claude-sonnet-4-6',
  resolvedModel: 'claude-sonnet-4-6',
  options: {},
};

const openAiConfig: ProviderConfig = {
  providerId: 'openai',
  apiKey: 'sk-openai-test',
  baseUrl: 'https://api.openai.com',
  modelMode: 'catalog',
  modelId: 'gpt-5.4-2026-03-05',
  resolvedModel: 'gpt-5.4-2026-03-05',
  options: {},
};

const openRouterConfig: ProviderConfig = {
  providerId: 'openrouter',
  apiKey: 'sk-or-test',
  baseUrl: 'https://openrouter.ai/api',
  modelMode: 'catalog',
  modelId: 'openai/gpt-4.1-mini',
  resolvedModel: 'openai/gpt-4.1-mini',
  options: {},
};

describe('provider transport edge cases', () => {
  test('Anthropic transport handles missing text payloads and network failures', async () => {
    const transport = createAnthropicTransport({
      fetch: vi.fn<typeof fetch>(async () => new Response('{}', { status: 200 })),
    });

    await expect(transport.generateText({
      config: anthropicConfig,
      systemPrompt: 'sys',
      userPrompt: 'user',
      maxOutputTokens: 10,
    })).resolves.toEqual({
      text: '',
      usage: { inputTokens: 0, outputTokens: 0 },
    });

    const failingTransport = createAnthropicTransport({
      fetch: vi.fn<typeof fetch>(async () => {
        throw new Error('offline');
      }),
    });

    await expect(failingTransport.generateText({
      config: anthropicConfig,
      systemPrompt: 'sys',
      userPrompt: 'user',
      maxOutputTokens: 10,
    })).rejects.toMatchObject({
      code: 'network',
      providerId: 'anthropic',
    });
  });

  test('Anthropic stream errors surface protocol and provider failures', async () => {
    const malformedTransport = createAnthropicTransport({
      fetch: vi.fn<typeof fetch>(async () => createSseResponse([
        'data: {"type":"content_block_delta","delta":{"text":"ok"}}\n\n',
        'data: {"type":"content_block_delta"\n\n',
      ])),
    });

    await expect(malformedTransport.streamText({
      config: anthropicConfig,
      systemPrompt: 'sys',
      userPrompt: 'user',
      maxOutputTokens: 10,
    }, vi.fn())).rejects.toMatchObject({
      code: 'protocol',
      providerId: 'anthropic',
    });

    const errorTransport = createAnthropicTransport({
      fetch: vi.fn<typeof fetch>(async () => createSseResponse([
        'data: {"type":"error","error":{"message":"boom"}}\n\n',
      ])),
    });

    await expect(errorTransport.streamText({
      config: anthropicConfig,
      systemPrompt: 'sys',
      userPrompt: 'user',
      maxOutputTokens: 10,
    }, vi.fn())).rejects.toMatchObject({
      code: 'unknown',
      providerId: 'anthropic',
      message: 'boom',
    });
  });

  test('OpenAI transport falls back to output arrays and handles network failures', async () => {
    const transport = createOpenAiTransport({
      fetch: vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
        output: [{ content: [{ text: 'from output array' }] }],
        usage: { input_tokens: 1, output_tokens: 2 },
      }), { status: 200 })),
    });

    await expect(transport.generateText({
      config: openAiConfig,
      systemPrompt: 'sys',
      userPrompt: 'user',
      maxOutputTokens: 10,
    })).resolves.toEqual({
      text: 'from output array',
      usage: { inputTokens: 1, outputTokens: 2 },
    });

    const failingTransport = createOpenAiTransport({
      fetch: vi.fn<typeof fetch>(async () => {
        throw new Error('offline');
      }),
    });

    await expect(failingTransport.generateText({
      config: openAiConfig,
      systemPrompt: 'sys',
      userPrompt: 'user',
      maxOutputTokens: 10,
    })).rejects.toMatchObject({
      code: 'network',
      providerId: 'openai',
    });
  });

  test('OpenAI stream errors surface protocol and provider failures', async () => {
    const malformedTransport = createOpenAiTransport({
      fetch: vi.fn<typeof fetch>(async () => createSseResponse([
        'data: {"type":"response.output_text.delta","delta":"ok"}\n\n',
        'data: {"type":"response.output_text.delta"\n\n',
      ])),
    });

    await expect(malformedTransport.streamText({
      config: openAiConfig,
      systemPrompt: 'sys',
      userPrompt: 'user',
      maxOutputTokens: 10,
    }, vi.fn())).rejects.toMatchObject({
      code: 'protocol',
      providerId: 'openai',
    });

    const failedTransport = createOpenAiTransport({
      fetch: vi.fn<typeof fetch>(async () => createSseResponse([
        'data: {"type":"response.failed","response":{"error":{"message":"bad stream"}}}\n\n',
      ])),
    });

    await expect(failedTransport.streamText({
      config: openAiConfig,
      systemPrompt: 'sys',
      userPrompt: 'user',
      maxOutputTokens: 10,
    }, vi.fn())).rejects.toMatchObject({
      code: 'unknown',
      providerId: 'openai',
      message: 'bad stream',
    });
  });

  test('OpenRouter transport normalizes text and model catalog failures', async () => {
    const transport = createOpenRouterTransport({
      fetch: vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
        output: [{ content: [{ text: 'from openrouter output array' }] }],
        usage: { input_tokens: 1, output_tokens: 2 },
      }), { status: 200 })),
    });

    await expect(transport.generateText({
      config: openRouterConfig,
      systemPrompt: 'sys',
      userPrompt: 'user',
      maxOutputTokens: 10,
    })).resolves.toEqual({
      text: 'from openrouter output array',
      usage: { inputTokens: 1, outputTokens: 2 },
    });

    const malformedCatalogTransport = createOpenRouterTransport({
      fetch: vi.fn<typeof fetch>(async () => new Response('{}', { status: 200 })),
    });

    await expect(malformedCatalogTransport.listModels(openRouterConfig)).rejects.toMatchObject({
      code: 'protocol',
      providerId: 'openrouter',
    });
  });

  test('OpenRouter stream errors surface protocol and provider failures', async () => {
    const malformedTransport = createOpenRouterTransport({
      fetch: vi.fn<typeof fetch>(async () => createSseResponse([
        'data: {"type":"response.output_text.delta","delta":"ok"}\n\n',
        'data: {"type":"response.output_text.delta"\n\n',
      ])),
    });

    await expect(malformedTransport.streamText({
      config: openRouterConfig,
      systemPrompt: 'sys',
      userPrompt: 'user',
      maxOutputTokens: 10,
    }, vi.fn())).rejects.toMatchObject({
      code: 'protocol',
      providerId: 'openrouter',
    });

    const failedTransport = createOpenRouterTransport({
      fetch: vi.fn<typeof fetch>(async () => createSseResponse([
        'data: {"type":"response.failed","response":{"error":{"message":"bad stream"}}}\n\n',
      ])),
    });

    await expect(failedTransport.streamText({
      config: openRouterConfig,
      systemPrompt: 'sys',
      userPrompt: 'user',
      maxOutputTokens: 10,
    }, vi.fn())).rejects.toMatchObject({
      code: 'unknown',
      providerId: 'openrouter',
      message: 'bad stream',
    });
  });
});
