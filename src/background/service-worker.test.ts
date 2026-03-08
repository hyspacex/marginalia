import type { ProviderConfig, SessionState } from '@/shared/types';
import { ProviderError } from './llm/provider';

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

describe('service worker persistence', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal('chrome', {
      runtime: {
        onInstalled: { addListener: vi.fn() },
        onMessage: { addListener: vi.fn() },
        onConnect: { addListener: vi.fn() },
      },
      alarms: {
        create: vi.fn(),
        onAlarm: { addListener: vi.fn() },
      },
      tabs: {
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

  test('swallows summary protocol failures during session persistence', async () => {
    const saveProfile = vi.fn();
    const addEntry = vi.fn();

    vi.doMock('./llm/flows', () => ({
      createLlmService: () => ({
        updateReaderProfile: vi.fn(async () => ({
          expertise: {},
          interests: [],
          annotationPreferences: { depth: 'detailed', tone: 'collegial' },
          readingGoals: [],
          updatedAt: '2026-03-08T00:00:00.000Z',
        })),
        generatePageSummary: vi.fn(async () => {
          throw new ProviderError('anthropic', 'protocol', 'Invalid JSON');
        }),
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
        saveProfile,
      },
    }));

    vi.doMock('./memory/reading-graph', () => ({
      readingGraph: {
        addEntry,
      },
    }));

    const module = await import('./service-worker');
    await expect(module.persistSession(session)).resolves.toBeUndefined();

    expect(saveProfile).toHaveBeenCalledTimes(1);
    expect(addEntry).not.toHaveBeenCalled();
  });
});
