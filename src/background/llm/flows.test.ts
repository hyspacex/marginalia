import type { AnnotationRequest, ProviderConfig, ReaderProfile, SessionState } from '@/shared/types';
import { createLlmService } from './flows';
import { ProviderError } from './provider';

function createJsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

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

const annotationRequest: AnnotationRequest = {
  pageContent: 'Example article body',
  memoryContext: {},
  title: 'Example title',
  url: 'https://example.com/article',
};

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

const currentProfile: ReaderProfile = {
  expertise: { ai: 'advanced' },
  interests: ['systems'],
  annotationPreferences: { depth: 'detailed', tone: 'collegial' },
  readingGoals: ['understand tradeoffs'],
  updatedAt: '2026-03-01T00:00:00.000Z',
};

const session: SessionState = {
  tabId: 1,
  url: 'https://example.com/article',
  title: 'Example title',
  pageContent: 'Article content',
  pageSummary: null,
  annotations: [],
  interactions: [],
  startedAt: 1,
  lastActiveAt: 1000,
};

describe('createLlmService', () => {
  test('reassembles streamed JSONL annotations and skips malformed lines', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => createSseResponse([
      'data: {"type":"message_start","message":{"usage":{"input_tokens":5}}}\n\n',
      'data: {"type":"content_block_delta","delta":{"text":"{\\"anchor\\":\\"Alpha\\",\\"content\\":\\"First\\"}\\n{\\"anchor\\":\\"B"}}\n\n',
      'data: {"type":"content_block_delta","delta":{"text":"eta\\",\\"content\\":\\"Second\\"}\\nnot json\\n"}}\n\n',
      'data: {"type":"message_delta","usage":{"output_tokens":7}}\n\n',
      'data: [DONE]\n\n',
    ]));

    const idSequence = ['a1', 'a2'];
    const service = createLlmService({
      fetch: fetchMock,
      now: () => 123,
      generateId: () => idSequence.shift() || 'overflow',
    });

    const annotations: { id: string; anchor: string; content: string; timestamp: number }[] = [];
    const result = await service.streamAnnotations(annotationRequest, anthropicConfig, (annotation) => {
      annotations.push(annotation);
    });

    expect(result).toEqual({ usage: { inputTokens: 5, outputTokens: 7 } });
    expect(annotations).toEqual([
      { id: 'a1', anchor: 'Alpha', content: 'First', timestamp: 123 },
      { id: 'a2', anchor: 'Beta', content: 'Second', timestamp: 123 },
    ]);
  });

  test('flushes a trailing annotation after the stream completes', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => createSseResponse([
      'data: {"type":"message_start","message":{"usage":{"input_tokens":2}}}\n\n',
      'data: {"type":"content_block_delta","delta":{"text":"{\\"anchor\\":\\"Tail\\",\\"content\\":\\"Only\\"}"}}\n\n',
      'data: {"type":"message_delta","usage":{"output_tokens":1}}\n\n',
    ]));

    const service = createLlmService({
      fetch: fetchMock,
      now: () => 999,
      generateId: () => 'tail-id',
    });

    const annotations: { id: string; anchor: string; content: string; timestamp: number }[] = [];
    await service.streamAnnotations(annotationRequest, anthropicConfig, (annotation) => {
      annotations.push(annotation);
    });

    expect(annotations).toEqual([
      { id: 'tail-id', anchor: 'Tail', content: 'Only', timestamp: 999 },
    ]);
  });

  test('validates parsed summary JSON', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => createJsonResponse({
      output_text: 'prefix {"summary":"- one","keyClaims":["claim"],"topics":["topic-one"]} suffix',
      usage: { input_tokens: 8, output_tokens: 3 },
    }));

    const service = createLlmService({ fetch: fetchMock });
    await expect(service.generatePageSummary('body', 'title', openAiConfig)).resolves.toEqual({
      summary: '- one',
      keyClaims: ['claim'],
      topics: ['topic-one'],
    });
  });

  test('throws protocol errors for invalid summary JSON', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => createJsonResponse({
      output_text: 'not json',
      usage: { input_tokens: 8, output_tokens: 3 },
    }));

    const service = createLlmService({ fetch: fetchMock });

    await expect(service.generatePageSummary('body', 'title', openAiConfig)).rejects.toMatchObject<Partial<ProviderError>>({
      providerId: 'openai',
      code: 'protocol',
    });
  });

  test('returns the current profile when profile JSON is invalid', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => createJsonResponse({
      content: [{ type: 'text', text: '{"nope":true}' }],
      usage: { input_tokens: 5, output_tokens: 2 },
    }));

    const service = createLlmService({
      fetch: fetchMock,
      now: () => Date.parse('2026-03-08T00:00:00.000Z'),
    });

    await expect(service.updateReaderProfile(currentProfile, session, anthropicConfig)).resolves.toEqual(currentProfile);
  });

  test('rethrows non-protocol profile errors', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response('{"error":{"message":"bad key"}}', { status: 401 }));
    const service = createLlmService({ fetch: fetchMock });

    await expect(service.updateReaderProfile(currentProfile, session, anthropicConfig)).rejects.toMatchObject<Partial<ProviderError>>({
      providerId: 'anthropic',
      code: 'auth',
    });
  });

  test('rejects missing API keys before making requests', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => createJsonResponse({}));
    const service = createLlmService({ fetch: fetchMock });

    await expect(service.testConnection({
      providerId: 'openai',
      apiKey: '   ',
      baseUrl: 'https://api.openai.com',
      modelMode: 'catalog',
      modelId: 'gpt-5.4-2026-03-05',
      options: {},
    })).rejects.toMatchObject<Partial<ProviderError>>({
      providerId: 'openai',
      code: 'auth',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('wraps unknown transport errors during connection tests', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => {
      throw 'boom';
    });
    const service = createLlmService({ fetch: fetchMock });

    await expect(service.testConnection(openAiConfig)).rejects.toMatchObject<Partial<ProviderError>>({
      providerId: 'openai',
      code: 'network',
    });
  });
});
