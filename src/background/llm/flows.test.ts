import type { AnnotationRequest, ProviderConfig, ReaderProfile, SessionState, SummaryRequest, SummarySection } from '@/shared/types';
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

  function sseTextDelta(text: string): string {
    return `data: ${JSON.stringify({ type: 'content_block_delta', delta: { text } })}\n\n`;
  }

  const summaryRequest: SummaryRequest = {
    text: 'body',
    title: 'title',
    url: 'https://example.com/article',
    metadata: {
      jsonLdTypes: ['NewsArticle'],
      ogType: 'article',
      host: 'example.com',
      urlPath: '/article',
      byline: 'A. Writer',
      siteName: 'Example',
      wordCount: 100,
    },
    contentType: 'news-report',
    memoryContext: {},
  };

  test('streams structured summary sections and assembles the result', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => createSseResponse([
      'data: {"type":"message_start","message":{"usage":{"input_tokens":8}}}\n\n',
      sseTextDelta('{"kind":"meta","contentType":"news-report"}\n{"kind":"section","id":"what-'),
      sseTextDelta('happened","heading":"What happened","markdown":"- x"}\n'),
      sseTextDelta('{"kind":"graph","keyClaims":["claim"],"topics":["topic-one"]}'),
      'data: {"type":"message_delta","usage":{"output_tokens":3}}\n\n',
    ]));

    const service = createLlmService({ fetch: fetchMock });
    const streamedSections: SummarySection[] = [];

    const result = await service.streamPageSummary(summaryRequest, anthropicConfig, {
      onSection: (section) => streamedSections.push(section),
    });

    expect(result).toEqual({
      summary: {
        version: 2,
        contentType: 'news-report',
        sections: [{ id: 'what-happened', heading: 'What happened', markdown: '- x' }],
        keyClaims: ['claim'],
        topics: ['topic-one'],
      },
      usage: { inputTokens: 8, outputTokens: 3 },
    });
    expect(streamedSections).toHaveLength(1);
  });

  test('throws a protocol error when the summary stream contains no sections', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => createSseResponse([
      'data: {"type":"message_start","message":{"usage":{"input_tokens":8}}}\n\n',
      sseTextDelta('not json at all\n'),
      'data: {"type":"message_delta","usage":{"output_tokens":3}}\n\n',
    ]));

    const service = createLlmService({ fetch: fetchMock });

    await expect(service.streamPageSummary(summaryRequest, anthropicConfig)).rejects.toMatchObject<Partial<ProviderError>>({
      providerId: 'anthropic',
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

  test('lists provider models through the transport', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => createJsonResponse({
      data: [
        { id: 'gpt-5.4-2026-03-05' },
        { id: 'gpt-image-1' },
      ],
    }));
    const service = createLlmService({ fetch: fetchMock });

    await expect(service.listModels(openAiConfig)).resolves.toEqual([
      {
        id: 'gpt-5.4-2026-03-05',
        name: 'gpt-5.4-2026-03-05',
        contextWindow: null,
        costPer1kInput: null,
        costPer1kOutput: null,
      },
    ]);
  });
});
