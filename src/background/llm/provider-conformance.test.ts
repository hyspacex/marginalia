import type { ProviderConfig } from '@/shared/types';
import { anthropicFixtures, openAiFixtures } from './__fixtures__/provider-fixtures';
import { ProviderError, type ProviderTransport } from './provider';
import { createAnthropicTransport } from './providers/anthropic';
import { createOpenAiTransport } from './providers/openai';

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
  streamChunks: string[];
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
  streamChunks: anthropicFixtures.streamChunks,
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
  streamChunks: openAiFixtures.streamChunks,
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
