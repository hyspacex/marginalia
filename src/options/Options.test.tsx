import { fireEvent, render, screen, waitFor } from '@testing-library/preact';
import type { StoredProvidersState } from '@/shared/types';
import { Options } from './Options';

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

const mocked = vi.hoisted(() => {
  const baseProvidersState: StoredProvidersState = {
    version: 1,
    activeProviderId: 'anthropic',
    configsByProvider: {
      anthropic: {
        apiKey: 'anthropic-key',
        baseUrl: 'https://api.anthropic.com',
        modelMode: 'catalog',
        modelId: 'claude-sonnet-4-6',
        options: {},
      },
      openai: {
        apiKey: 'openai-key',
        baseUrl: 'https://api.openai.com',
        modelMode: 'catalog',
        modelId: 'gpt-5.4-2026-03-05',
        options: {},
      },
    },
  };

  return {
    baseProvidersState,
    getProvidersStateMock: vi.fn(async () => clone(baseProvidersState)),
    saveProvidersStateMock: vi.fn(async (state: StoredProvidersState) => clone(state)),
    getTotalsMock: vi.fn(async () => ({
      inputTokens: 100,
      outputTokens: 50,
      estimatedCost: 1.25,
    })),
    resetUsageMock: vi.fn(async () => undefined),
    getCountMock: vi.fn(async () => 3),
    clearGraphMock: vi.fn(async () => undefined),
  };
});

vi.mock('@/background/llm/provider-storage', () => ({
  createDefaultProvidersState: () => clone(mocked.baseProvidersState),
  getProvidersState: mocked.getProvidersStateMock,
  saveProvidersState: mocked.saveProvidersStateMock,
}));

vi.mock('@/background/usage-tracker', () => ({
  usageTracker: {
    getTotals: mocked.getTotalsMock,
    reset: mocked.resetUsageMock,
  },
}));

vi.mock('@/background/memory/reading-graph', () => ({
  readingGraph: {
    getCount: mocked.getCountMock,
    clear: mocked.clearGraphMock,
  },
}));

describe('Options', () => {
  beforeEach(() => {
    mocked.getProvidersStateMock.mockClear();
    mocked.saveProvidersStateMock.mockClear();
    mocked.getTotalsMock.mockClear();
    mocked.resetUsageMock.mockClear();
    mocked.getCountMock.mockClear();
    mocked.clearGraphMock.mockClear();

    vi.stubGlobal('chrome', {
      storage: {
        local: {
          get: vi.fn(async () => ({ readerProfile: null })),
          remove: vi.fn(async () => undefined),
        },
      },
      runtime: {
        sendMessage: vi.fn(async () => ({
          type: 'ANNOTATIONS_READY',
          payload: { annotations: [], usage: { inputTokens: 0, outputTokens: 0 } },
        })),
      },
    });
    vi.stubGlobal('confirm', vi.fn(() => true));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test('preserves inactive provider config when switching providers', async () => {
    render(<Options />);

    await screen.findByDisplayValue('anthropic-key');

    fireEvent.change(screen.getByLabelText('Active Provider'), {
      target: { value: 'openai' },
    });

    const openAiKeyField = await screen.findByDisplayValue('openai-key');
    fireEvent.input(openAiKeyField, {
      target: { value: 'edited-openai-key' },
    });

    fireEvent.change(screen.getByLabelText('Active Provider'), {
      target: { value: 'anthropic' },
    });
    await screen.findByDisplayValue('anthropic-key');

    fireEvent.change(screen.getByLabelText('Active Provider'), {
      target: { value: 'openai' },
    });

    await screen.findByDisplayValue('edited-openai-key');
  });

  test('supports curated and custom model inputs', async () => {
    render(<Options />);

    await screen.findByLabelText('Model Source');
    fireEvent.change(screen.getByLabelText('Active Provider'), {
      target: { value: 'openai' },
    });

    fireEvent.change(await screen.findByLabelText('Model Source'), {
      target: { value: 'custom' },
    });

    const customModelField = await screen.findByLabelText('Custom Model ID');
    fireEvent.input(customModelField, {
      target: { value: 'research-preview' },
    });

    expect(await screen.findByDisplayValue('research-preview')).toBeTruthy();
  });

  test('shows connection errors and saves the full providers state', async () => {
    const sendMessage = vi.fn(async () => ({
      type: 'ERROR',
      payload: { message: 'Connection failed', code: 'INTERNAL' },
    }));

    vi.stubGlobal('chrome', {
      storage: {
        local: {
          get: vi.fn(async () => ({ readerProfile: null })),
          remove: vi.fn(async () => undefined),
        },
      },
      runtime: {
        sendMessage,
      },
    });

    render(<Options />);

    await screen.findByDisplayValue('anthropic-key');
    fireEvent.click(screen.getByText('Test Connection'));

    await screen.findByText('Connection failed');

    fireEvent.change(screen.getByLabelText('Active Provider'), {
      target: { value: 'openai' },
    });
    fireEvent.input(await screen.findByDisplayValue('openai-key'), {
      target: { value: 'saved-openai-key' },
    });

    fireEvent.click(screen.getByText('Save'));

    await waitFor(() => {
      expect(mocked.saveProvidersStateMock).toHaveBeenCalledTimes(1);
    });

    expect(mocked.saveProvidersStateMock).toHaveBeenCalledWith(expect.objectContaining({
      activeProviderId: 'openai',
      configsByProvider: expect.objectContaining({
        anthropic: expect.objectContaining({ apiKey: 'anthropic-key' }),
        openai: expect.objectContaining({ apiKey: 'saved-openai-key' }),
      }),
    }));
    expect(sendMessage).toHaveBeenCalledTimes(1);
  });
});
