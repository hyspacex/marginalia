import type { ProviderConfig } from '@/shared/types';
import { anthropicFixtures, localFixtures, openAiFixtures, openRouterFixtures } from './__fixtures__/provider-fixtures';
import { createLocalTransport } from './providers/local';
import { ProviderError, type ProviderTransport } from './provider';
import { createAnthropicTransport } from './providers/anthropic';
import { createOpenAiTransport } from './providers/openai';
import { createOpenRouterTransport } from './providers/openrouter';

interface ProviderConformanceCase {
  name: string;
  config: ProviderConfig;
  successText: string;
  generateUsage: { inputTokens: number; outputTokens: number };
  streamUsage: { inputTokens: number; outputTokens: number };
  expectedPath: string;
  expectedHeaders: Record<string, string>;
  createTransport: (fetchImpl: typeof fetch) => ProviderTransport;
  generateResponseBody: string;
  testConnectionBody: string;
  listModelsBody: string;
  streamChunks: string[];
  expectedListPath: string;
  expectedListedModels: Array<{
    id: string;
    name: string;
    contextWindow: number | null;
    costPer1kInput: number | null;
    costPer1kOutput: number | null;
  }>;
  assertGenerateBody: (body: any) => void;
  assertStreamBody: (body: any) => void;
  assertTestBody: (body: any) => void;
  errorBodies: {
    auth: string;
    rateLimit: string;
    server: string;
  };
}

function createJsonResponse(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function createSseResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

function parseBody(init: RequestInit | undefined) {
  return JSON.parse(String(init?.body || '{}'));
}

function expectHeaders(init: RequestInit | undefined, expected: Record<string, string>) {
  const headers = new Headers(init?.headers);

  for (const [key, value] of Object.entries(expected)) {
    expect(headers.get(key)).toBe(value);
  }
}

function describeProviderTransportConformance(testCase: ProviderConformanceCase) {
  describe(`${testCase.name} transport`, () => {
    const request = {
      config: testCase.config,
      systemPrompt: 'system prompt',
      userPrompt: 'user prompt',
      maxOutputTokens: 256,
    };

    test('generateText sends the expected request and normalizes usage', async () => {
      const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
        expect(String(input)).toBe(`${testCase.config.baseUrl}${testCase.expectedPath}`);
        expectHeaders(init, testCase.expectedHeaders);
        testCase.assertGenerateBody(parseBody(init));
        return createJsonResponse(testCase.generateResponseBody);
      });

      const transport = testCase.createTransport(fetchMock);
      const result = await transport.generateText(request);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(result).toEqual({
        text: testCase.successText,
        usage: testCase.generateUsage,
      });
    });

    test('streamText handles split SSE chunks and normalizes usage', async () => {
      const fetchMock = vi.fn<typeof fetch>(async (_input, init) => {
        expectHeaders(init, testCase.expectedHeaders);
        testCase.assertStreamBody(parseBody(init));
        return createSseResponse(testCase.streamChunks);
      });

      const transport = testCase.createTransport(fetchMock);
      let text = '';
      const result = await transport.streamText(request, (delta) => {
        text += delta;
      });

      expect(text).toBe('hello');
      expect(result).toEqual({ usage: testCase.streamUsage });
    });

    test('testConnection uses the expected auth and endpoint', async () => {
      const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
        expect(String(input)).toBe(`${testCase.config.baseUrl}${testCase.expectedPath}`);
        expectHeaders(init, testCase.expectedHeaders);
        testCase.assertTestBody(parseBody(init));
        return createJsonResponse(testCase.testConnectionBody);
      });

      const transport = testCase.createTransport(fetchMock);

      await expect(transport.testConnection(testCase.config)).resolves.toBeUndefined();
    });

    test('listModels uses the expected auth and normalizes the catalog', async () => {
      const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
        expect(String(input)).toBe(`${testCase.config.baseUrl}${testCase.expectedListPath}`);
        expectHeaders(init, testCase.expectedHeaders);
        return createJsonResponse(testCase.listModelsBody);
      });

      const transport = testCase.createTransport(fetchMock);

      await expect(transport.listModels(testCase.config)).resolves.toEqual(testCase.expectedListedModels);
    });

    test.each([
      ['auth', 401, testCase.errorBodies.auth, 'auth'],
      ['rate limit', 429, testCase.errorBodies.rateLimit, 'rate_limit'],
      ['server', 500, testCase.errorBodies.server, 'unknown'],
      ['unsupported model', 400, JSON.stringify({ error: { message: 'model not found' } }), 'unsupported_model'],
    ] as const)('maps %s errors', async (_label, status, body, expectedCode) => {
      const fetchMock = vi.fn<typeof fetch>(async () => createJsonResponse(body, status));
      const transport = testCase.createTransport(fetchMock);

      await expect(transport.generateText(request)).rejects.toMatchObject<Partial<ProviderError>>({
        code: expectedCode,
        providerId: testCase.config.providerId,
      });
    });
  });
}

describeProviderTransportConformance({
  name: 'Anthropic',
  config: {
    providerId: 'anthropic',
    apiKey: 'sk-ant-test',
    baseUrl: 'https://api.anthropic.com',
    modelMode: 'catalog',
    modelId: 'claude-sonnet-4-6',
    resolvedModel: 'claude-sonnet-4-6',
    options: {},
  },
  successText: 'hello from anthropic',
  generateUsage: { inputTokens: 12, outputTokens: 5 },
  streamUsage: { inputTokens: 11, outputTokens: 7 },
  expectedPath: '/v1/messages',
  expectedHeaders: {
    'content-type': 'application/json',
    'x-api-key': 'sk-ant-test',
    'anthropic-version': '2023-06-01',
    'anthropic-dangerous-direct-browser-access': 'true',
  },
  createTransport: (fetchImpl) => createAnthropicTransport({ fetch: fetchImpl }),
  generateResponseBody: anthropicFixtures.generate.body,
  testConnectionBody: anthropicFixtures.testConnection.body,
  listModelsBody: anthropicFixtures.listModels.body,
  streamChunks: anthropicFixtures.streamChunks,
  expectedListPath: '/v1/models',
  expectedListedModels: [
    {
      id: 'claude-haiku-3-5-20241022',
      name: 'Claude Haiku 3.5',
      contextWindow: null,
      costPer1kInput: null,
      costPer1kOutput: null,
    },
    {
      id: 'claude-sonnet-4-6',
      name: 'Claude Sonnet 4.6',
      contextWindow: null,
      costPer1kInput: null,
      costPer1kOutput: null,
    },
  ],
  assertGenerateBody(body) {
    expect(body).toMatchObject({
      model: 'claude-sonnet-4-6',
      max_tokens: 256,
      system: 'system prompt',
      messages: [{ role: 'user', content: 'user prompt' }],
    });
  },
  assertStreamBody(body) {
    expect(body).toMatchObject({
      model: 'claude-sonnet-4-6',
      max_tokens: 256,
      stream: true,
    });
  },
  assertTestBody(body) {
    expect(body).toMatchObject({
      model: 'claude-sonnet-4-6',
      max_tokens: 10,
      system: 'Respond with "ok".',
      messages: [{ role: 'user', content: 'Test' }],
    });
  },
  errorBodies: anthropicFixtures.errors,
});

describeProviderTransportConformance({
  name: 'OpenAI',
  config: {
    providerId: 'openai',
    apiKey: 'sk-openai-test',
    baseUrl: 'https://api.openai.com',
    modelMode: 'catalog',
    modelId: 'gpt-5.4-2026-03-05',
    resolvedModel: 'gpt-5.4-2026-03-05',
    options: {},
  },
  successText: 'hello from openai',
  generateUsage: { inputTokens: 9, outputTokens: 4 },
  streamUsage: { inputTokens: 10, outputTokens: 6 },
  expectedPath: '/v1/responses',
  expectedHeaders: {
    'content-type': 'application/json',
    authorization: 'Bearer sk-openai-test',
  },
  createTransport: (fetchImpl) => createOpenAiTransport({ fetch: fetchImpl }),
  generateResponseBody: openAiFixtures.generate.body,
  testConnectionBody: openAiFixtures.testConnection.body,
  listModelsBody: openAiFixtures.listModels.body,
  streamChunks: openAiFixtures.streamChunks,
  expectedListPath: '/v1/models',
  expectedListedModels: [
    {
      id: 'gpt-5.4-2026-03-05',
      name: 'gpt-5.4-2026-03-05',
      contextWindow: null,
      costPer1kInput: null,
      costPer1kOutput: null,
    },
    {
      id: 'o4-mini',
      name: 'o4-mini',
      contextWindow: null,
      costPer1kInput: null,
      costPer1kOutput: null,
    },
  ],
  assertGenerateBody(body) {
    expect(body).toMatchObject({
      model: 'gpt-5.4-2026-03-05',
      instructions: 'system prompt',
      input: 'user prompt',
      max_output_tokens: 256,
      store: false,
    });
  },
  assertStreamBody(body) {
    expect(body).toMatchObject({
      model: 'gpt-5.4-2026-03-05',
      stream: true,
      store: false,
    });
  },
  assertTestBody(body) {
    expect(body).toMatchObject({
      model: 'gpt-5.4-2026-03-05',
      instructions: 'Respond with "ok".',
      input: 'Test',
      max_output_tokens: 16,
      store: false,
    });
  },
  errorBodies: openAiFixtures.errors,
});

describeProviderTransportConformance({
  name: 'OpenRouter',
  config: {
    providerId: 'openrouter',
    apiKey: 'sk-or-test',
    baseUrl: 'https://openrouter.ai/api',
    modelMode: 'catalog',
    modelId: 'openai/gpt-4.1-mini',
    resolvedModel: 'openai/gpt-4.1-mini',
    options: {},
  },
  successText: 'hello from openrouter',
  generateUsage: { inputTokens: 14, outputTokens: 8 },
  streamUsage: { inputTokens: 12, outputTokens: 7 },
  expectedPath: '/v1/responses',
  expectedHeaders: {
    'content-type': 'application/json',
    authorization: 'Bearer sk-or-test',
    'x-title': 'Marginalia',
  },
  createTransport: (fetchImpl) => createOpenRouterTransport({ fetch: fetchImpl }),
  generateResponseBody: openRouterFixtures.generate.body,
  testConnectionBody: openRouterFixtures.testConnection.body,
  listModelsBody: openRouterFixtures.listModels.body,
  streamChunks: openRouterFixtures.streamChunks,
  expectedListPath: '/v1/models/user',
  expectedListedModels: [
    {
      id: 'openai/gpt-4.1-mini',
      name: 'OpenAI GPT-4.1 mini',
      contextWindow: 1047576,
      costPer1kInput: 0.0004,
      costPer1kOutput: 0.0016,
    },
  ],
  assertGenerateBody(body) {
    expect(body).toMatchObject({
      model: 'openai/gpt-4.1-mini',
      instructions: 'system prompt',
      input: 'user prompt',
      max_output_tokens: 256,
      store: false,
    });
  },
  assertStreamBody(body) {
    expect(body).toMatchObject({
      model: 'openai/gpt-4.1-mini',
      stream: true,
      store: false,
    });
  },
  assertTestBody(body) {
    expect(body).toMatchObject({
      model: 'openai/gpt-4.1-mini',
      instructions: 'Respond with "ok".',
      input: 'Test',
      max_output_tokens: 16,
      store: false,
    });
  },
  errorBodies: openRouterFixtures.errors,
});

describeProviderTransportConformance({
  name: 'Local (OpenAI-compatible)',
  config: {
    providerId: 'local',
    apiKey: 'sk-local-test',
    baseUrl: 'http://100.82.7.89:8317/v1',
    modelMode: 'custom',
    modelId: 'qwen3-32b',
    resolvedModel: 'qwen3-32b',
    options: {},
  },
  successText: 'hello from local',
  generateUsage: { inputTokens: 7, outputTokens: 3 },
  streamUsage: { inputTokens: 8, outputTokens: 6 },
  expectedPath: '/chat/completions',
  expectedHeaders: {
    'content-type': 'application/json',
    authorization: 'Bearer sk-local-test',
  },
  createTransport: (fetchImpl) => createLocalTransport({ fetch: fetchImpl }),
  generateResponseBody: localFixtures.generate.body,
  testConnectionBody: localFixtures.testConnection.body,
  listModelsBody: localFixtures.listModels.body,
  streamChunks: localFixtures.streamChunks,
  expectedListPath: '/models',
  expectedListedModels: [
    {
      id: 'llama-3.3-70b',
      name: 'llama-3.3-70b',
      contextWindow: 131072,
      costPer1kInput: null,
      costPer1kOutput: null,
    },
    {
      id: 'qwen3-32b',
      name: 'qwen3-32b',
      contextWindow: null,
      costPer1kInput: null,
      costPer1kOutput: null,
    },
  ],
  assertGenerateBody(body) {
    expect(body).toMatchObject({
      model: 'qwen3-32b',
      messages: [
        { role: 'system', content: 'system prompt' },
        { role: 'user', content: 'user prompt' },
      ],
      max_tokens: 256,
      stream: false,
    });
  },
  assertStreamBody(body) {
    expect(body).toMatchObject({
      model: 'qwen3-32b',
      stream: true,
      stream_options: { include_usage: true },
    });
  },
  assertTestBody(body) {
    expect(body).toMatchObject({
      model: 'qwen3-32b',
      messages: [
        { role: 'system', content: 'Respond with "ok".' },
        { role: 'user', content: 'Test' },
      ],
      max_tokens: 16,
      stream: false,
    });
  },
  errorBodies: localFixtures.errors,
});
