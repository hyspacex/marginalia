import type { PageMetadata, ProviderConfig, SessionState } from '@/shared/types';
import { PORT_NAME } from '@/shared/constants';

const config: ProviderConfig = {
  providerId: 'anthropic',
  apiKey: 'sk-ant-test',
  baseUrl: 'https://api.anthropic.com',
  modelMode: 'catalog',
  modelId: 'claude-sonnet-4-6',
  resolvedModel: 'claude-sonnet-4-6',
  options: {},
};

const session: SessionState = {
  tabId: 1,
  url: 'https://example.com/article',
  title: 'Example title',
  pageContent: 'body',
  pageSummary: null,
  annotations: [
    { id: 'a1', anchor: 'Alpha', content: 'First', timestamp: 1 },
  ],
  interactions: [],
  startedAt: 1,
  lastActiveAt: 1000,
};

let openOptionsPage: ReturnType<typeof vi.fn>;
let sendMessage: ReturnType<typeof vi.fn>;

describe('service worker persistence', () => {
  beforeEach(() => {
    vi.resetModules();
    openOptionsPage = vi.fn();
    sendMessage = vi.fn();
    vi.stubGlobal('chrome', {
      action: {
        onClicked: { addListener: vi.fn() },
      },
      runtime: {
        onInstalled: { addListener: vi.fn() },
        onMessage: { addListener: vi.fn() },
        onConnect: { addListener: vi.fn() },
        openOptionsPage,
      },
      alarms: {
        create: vi.fn(),
        onAlarm: { addListener: vi.fn() },
      },
      tabs: {
        sendMessage,
        onUpdated: { addListener: vi.fn() },
        onRemoved: { addListener: vi.fn() },
      },
      storage: {
        local: {
          get: vi.fn(),
          set: vi.fn(),
          remove: vi.fn(),
        },
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  function mockPersistenceModules(overrides: {
    saveProfile: ReturnType<typeof vi.fn>;
    addEntry: ReturnType<typeof vi.fn>;
    updateReaderProfile?: ReturnType<typeof vi.fn>;
    streamPageSummary?: ReturnType<typeof vi.fn>;
  }) {
    const updateReaderProfile = overrides.updateReaderProfile ?? vi.fn(async () => ({
      expertise: {},
      interests: [],
      annotationPreferences: { depth: 'detailed', tone: 'collegial' },
      readingGoals: [],
      updatedAt: '2026-03-08T00:00:00.000Z',
    }));
    const streamPageSummary = overrides.streamPageSummary ?? vi.fn();

    vi.doMock('./llm/flows', () => ({
      createLlmService: () => ({
        updateReaderProfile,
        streamPageSummary,
        streamAnnotations: vi.fn(),
        testConnection: vi.fn(),
      }),
    }));

    vi.doMock('./llm/provider-storage', () => ({
      getProvidersState: vi.fn(async () => ({ activeProviderId: 'anthropic', configsByProvider: {}, version: 1 })),
      resolveProviderConfig: vi.fn(() => config),
      hasProviderCredentials: vi.fn(() => true),
    }));

    vi.doMock('./llm/provider-registry', () => ({
      getProviderDescriptor: vi.fn(() => ({
        name: 'Anthropic',
        estimateCost: vi.fn(() => 0),
      })),
    }));

    vi.doMock('./memory/profile-manager', () => ({
      profileManager: {
        getProfile: vi.fn(async () => ({
          expertise: {},
          interests: [],
          annotationPreferences: { depth: 'detailed', tone: 'collegial' },
          readingGoals: [],
          updatedAt: '2026-03-01T00:00:00.000Z',
        })),
        saveProfile: overrides.saveProfile,
      },
    }));

    vi.doMock('./memory/reading-graph', () => ({
      readingGraph: {
        addEntry: overrides.addEntry,
      },
    }));

    return { updateReaderProfile, streamPageSummary };
  }

  test('persists annotation-only sessions without a second summary LLM call', async () => {
    const saveProfile = vi.fn();
    const addEntry = vi.fn();
    const { streamPageSummary } = mockPersistenceModules({ saveProfile, addEntry });

    const module = await import('./service-worker');
    await expect(module.persistSession(session)).resolves.toBeUndefined();

    expect(saveProfile).toHaveBeenCalledTimes(1);
    expect(streamPageSummary).not.toHaveBeenCalled();
    expect(addEntry).toHaveBeenCalledWith(expect.objectContaining({
      summary: '',
      keyClaims: [],
      topics: [],
    }));
  });

  test('persists summary-only sessions and skips the profile update', async () => {
    const saveProfile = vi.fn();
    const addEntry = vi.fn();
    const { updateReaderProfile } = mockPersistenceModules({ saveProfile, addEntry });

    const module = await import('./service-worker');
    const sections = [{ id: 'key-points', heading: 'Key points', markdown: '- point' }];
    await module.persistSession({
      ...session,
      annotations: [],
      pageSummary: {
        version: 2,
        contentType: 'news-report',
        sections,
        keyClaims: ['claim'],
        topics: ['topic-one'],
      },
    });

    expect(updateReaderProfile).not.toHaveBeenCalled();
    expect(saveProfile).not.toHaveBeenCalled();
    expect(addEntry).toHaveBeenCalledWith(expect.objectContaining({
      summary: '**Key points**\n- point',
      keyClaims: ['claim'],
      topics: ['topic-one'],
      contentType: 'news-report',
      sections,
    }));
  });

  test('skips sessions with no annotations and no summary', async () => {
    const saveProfile = vi.fn();
    const addEntry = vi.fn();
    mockPersistenceModules({ saveProfile, addEntry });

    const module = await import('./service-worker');
    await module.persistSession({ ...session, annotations: [] });

    expect(saveProfile).not.toHaveBeenCalled();
    expect(addEntry).not.toHaveBeenCalled();
  });

  test('opens options from the toolbar click when no API key is configured', async () => {
    vi.doMock('./llm/flows', () => ({
      createLlmService: () => ({
        updateReaderProfile: vi.fn(),
        streamPageSummary: vi.fn(),
        streamAnnotations: vi.fn(),
        testConnection: vi.fn(),
      }),
    }));

    vi.doMock('./llm/provider-storage', () => ({
      getProvidersState: vi.fn(async () => ({ activeProviderId: 'anthropic', configsByProvider: {}, version: 1 })),
      resolveProviderConfig: vi.fn(() => config),
      hasProviderCredentials: vi.fn(() => false),
    }));

    vi.doMock('./llm/provider-registry', () => ({
      getProviderDescriptor: vi.fn(() => ({
        name: 'Anthropic',
        estimateCost: vi.fn(() => 0),
      })),
    }));

    const module = await import('./service-worker');
    await module.handleActionClick({ id: 7 });

    expect(openOptionsPage).toHaveBeenCalledTimes(1);
    expect(sendMessage).not.toHaveBeenCalled();
  });

  test('forwards the toolbar click to the content script when credentials exist', async () => {
    vi.doMock('./llm/flows', () => ({
      createLlmService: () => ({
        updateReaderProfile: vi.fn(),
        streamPageSummary: vi.fn(),
        streamAnnotations: vi.fn(),
        testConnection: vi.fn(),
      }),
    }));

    vi.doMock('./llm/provider-storage', () => ({
      getProvidersState: vi.fn(async () => ({ activeProviderId: 'anthropic', configsByProvider: {}, version: 1 })),
      resolveProviderConfig: vi.fn(() => config),
      hasProviderCredentials: vi.fn(() => true),
    }));

    vi.doMock('./llm/provider-registry', () => ({
      getProviderDescriptor: vi.fn(() => ({
        name: 'Anthropic',
        estimateCost: vi.fn(() => 0),
      })),
    }));

    const module = await import('./service-worker');
    await module.handleActionClick({ id: 7 });

    expect(openOptionsPage).not.toHaveBeenCalled();
    expect(sendMessage).toHaveBeenCalledWith(7, { type: 'TOGGLE_ANNOTATIONS' }, expect.any(Function));
  });
});

describe('service worker sessions and auto-summarize', () => {
  const metadata: PageMetadata = {
    jsonLdTypes: ['NewsArticle'],
    ogType: 'article',
    host: 'www.nytimes.com',
    urlPath: '/a',
    byline: 'A. Writer',
    siteName: 'NYT',
    wordCount: 500,
  };

  let chromeStub: {
    action: { onClicked: { addListener: ReturnType<typeof vi.fn> } };
    runtime: {
      onInstalled: { addListener: ReturnType<typeof vi.fn> };
      onMessage: { addListener: ReturnType<typeof vi.fn> };
      onConnect: { addListener: ReturnType<typeof vi.fn> };
      openOptionsPage: ReturnType<typeof vi.fn>;
    };
    alarms: { create: ReturnType<typeof vi.fn>; onAlarm: { addListener: ReturnType<typeof vi.fn> } };
    tabs: {
      sendMessage: ReturnType<typeof vi.fn>;
      onUpdated: { addListener: ReturnType<typeof vi.fn> };
      onRemoved: { addListener: ReturnType<typeof vi.fn> };
    };
    storage: { local: Record<string, ReturnType<typeof vi.fn>> };
  };

  beforeEach(() => {
    vi.resetModules();
    chromeStub = {
      action: { onClicked: { addListener: vi.fn() } },
      runtime: {
        onInstalled: { addListener: vi.fn() },
        onMessage: { addListener: vi.fn() },
        onConnect: { addListener: vi.fn() },
        openOptionsPage: vi.fn(),
      },
      alarms: { create: vi.fn(), onAlarm: { addListener: vi.fn() } },
      tabs: { sendMessage: vi.fn(), onUpdated: { addListener: vi.fn() }, onRemoved: { addListener: vi.fn() } },
      storage: { local: { get: vi.fn(async () => ({})), set: vi.fn(), remove: vi.fn() } },
    };
    vi.stubGlobal('chrome', chromeStub);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  function mockModules(options: { autoModelId?: string | null; sites?: string[] } = {}) {
    const streamAnnotations = vi.fn(async () => ({ usage: { inputTokens: 10, outputTokens: 4 } }));
    const streamPageSummary = vi.fn(async (
      _request: unknown,
      _config: unknown,
      handlers?: { onMeta?: (t: string) => void; onSection?: (s: unknown) => void },
    ) => {
      handlers?.onMeta?.('news-report');
      handlers?.onSection?.({ id: 'key-points', heading: 'Key points', markdown: '- x' });
      return {
        summary: {
          version: 2,
          contentType: 'news-report',
          sections: [{ id: 'key-points', heading: 'Key points', markdown: '- x' }],
          keyClaims: ['claim'],
          topics: ['topic-one'],
        },
        usage: { inputTokens: 5, outputTokens: 2 },
      };
    });
    const recordUsage = vi.fn();
    const resolveProviderConfigForModel = vi.fn(() => ({
      ...config,
      modelMode: 'custom',
      modelId: 'cheap-model',
      resolvedModel: 'cheap-model',
    }));
    const saveAutoSummarizeSettings = vi.fn(async (settings: unknown) => settings);
    const autoSettings = {
      version: 1,
      enabled: true,
      sites: options.sites ?? ['nytimes.com'],
      autoModelId: options.autoModelId === undefined ? 'cheap-model' : options.autoModelId,
    };

    vi.doMock('./llm/flows', () => ({
      createLlmService: () => ({
        streamAnnotations,
        streamPageSummary,
        updateReaderProfile: vi.fn(),
        testConnection: vi.fn(),
        listModels: vi.fn(),
      }),
    }));
    vi.doMock('./llm/provider-storage', () => ({
      getProvidersState: vi.fn(async () => ({ activeProviderId: 'anthropic', configsByProvider: {}, version: 1 })),
      resolveProviderConfig: vi.fn(() => config),
      resolveProviderConfigForModel,
      hasProviderCredentials: vi.fn(() => true),
    }));
    vi.doMock('./llm/provider-registry', () => ({
      getProviderDescriptor: vi.fn(() => ({ name: 'Anthropic', estimateCost: vi.fn(() => 0) })),
    }));
    vi.doMock('./llm/provider-model-catalog', () => ({
      estimateProviderCost: vi.fn(async () => 0),
      saveProviderModelCatalog: vi.fn(),
    }));
    vi.doMock('./settings/auto-summarize-storage', () => ({
      getAutoSummarizeSettings: vi.fn(async () => autoSettings),
      saveAutoSummarizeSettings,
    }));
    vi.doMock('./memory/memory-retriever', () => ({
      getMemoryContext: vi.fn(async () => ({})),
    }));
    vi.doMock('./usage-tracker', () => ({ usageTracker: { recordUsage } }));
    vi.doMock('./memory/profile-manager', () => ({
      profileManager: { getProfile: vi.fn(async () => null), saveProfile: vi.fn() },
    }));
    vi.doMock('./memory/reading-graph', () => ({ readingGraph: { addEntry: vi.fn() } }));

    return { streamAnnotations, streamPageSummary, recordUsage, resolveProviderConfigForModel, saveAutoSummarizeSettings };
  }

  async function connectPort() {
    await import('./service-worker');
    const onConnect = chromeStub.runtime.onConnect.addListener.mock.calls[0][0];
    const messages: { type: string; payload?: unknown }[] = [];
    let onPortMessage: ((msg: unknown) => Promise<void>) | undefined;
    const port = {
      name: PORT_NAME,
      sender: { tab: { id: 42 } },
      onMessage: { addListener: (fn: (msg: unknown) => Promise<void>) => { onPortMessage = fn; } },
      postMessage: (msg: { type: string }) => messages.push(msg),
      disconnect: vi.fn(),
    };
    onConnect(port);
    return {
      messages,
      send: (msg: unknown) => onPortMessage!(msg),
    };
  }

  const startPayload = {
    url: 'https://www.nytimes.com/a',
    title: 'Title',
    text: 'body',
    metadata,
  };

  test('summary-only mode streams only the summary on the auto model', async () => {
    const mocks = mockModules();
    const { messages, send } = await connectPort();

    await send({ type: 'START_ANNOTATE', payload: { ...startPayload, mode: 'summary-only' } });

    expect(mocks.streamAnnotations).not.toHaveBeenCalled();
    expect(mocks.resolveProviderConfigForModel).toHaveBeenCalledWith(expect.anything(), 'cheap-model');
    expect(mocks.streamPageSummary).toHaveBeenCalledWith(
      expect.objectContaining({ url: startPayload.url, contentType: 'news-report' }),
      expect.objectContaining({ resolvedModel: 'cheap-model' }),
      expect.anything(),
    );
    expect(messages.map((m) => m.type)).toEqual(['SUMMARY_META', 'SUMMARY_SECTION', 'SUMMARY_DONE', 'STREAM_DONE']);
    expect(mocks.recordUsage).toHaveBeenCalledWith(expect.objectContaining({
      modelId: 'cheap-model',
      inputTokens: 5,
      outputTokens: 2,
    }));
  });

  test('a full run after an auto summary replays it without a second summary call', async () => {
    const mocks = mockModules();
    const { messages, send } = await connectPort();

    await send({ type: 'START_ANNOTATE', payload: { ...startPayload, mode: 'summary-only' } });
    messages.length = 0;

    await send({ type: 'START_ANNOTATE', payload: { ...startPayload, mode: 'full' } });

    expect(mocks.streamPageSummary).toHaveBeenCalledTimes(1);
    expect(mocks.streamAnnotations).toHaveBeenCalledTimes(1);
    expect(messages.map((m) => m.type)).toEqual(['SUMMARY_META', 'SUMMARY_SECTION', 'SUMMARY_DONE', 'STREAM_DONE']);
  });

  test('ADD_AUTO_SITE normalizes and appends the hostname', async () => {
    const mocks = mockModules({ sites: [], autoModelId: null });
    await import('./service-worker');
    const onMessage = chromeStub.runtime.onMessage.addListener.mock.calls[0][0];
    const sendResponse = vi.fn();

    onMessage({ type: 'ADD_AUTO_SITE', payload: { hostname: 'www.nytimes.com' } }, {}, sendResponse);

    await vi.waitFor(() => {
      expect(sendResponse).toHaveBeenCalled();
    });
    expect(mocks.saveAutoSummarizeSettings).toHaveBeenCalledWith(expect.objectContaining({
      sites: ['nytimes.com'],
    }));
  });

  test('tab URL changes are forwarded to the content script for SPA re-evaluation', async () => {
    mockModules();
    await import('./service-worker');
    const onUpdated = chromeStub.tabs.onUpdated.addListener.mock.calls[0][0];

    onUpdated(7, { url: 'https://www.nytimes.com/b' });

    expect(chromeStub.tabs.sendMessage).toHaveBeenCalledWith(
      7,
      { type: 'PAGE_NAVIGATED', payload: { url: 'https://www.nytimes.com/b' } },
      expect.any(Function),
    );
  });
});
