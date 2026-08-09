import 'fake-indexeddb/auto';
import { selectRelevantStoredTopics, getMemoryContext } from './memory-retriever';
import { readingGraph } from './reading-graph';

vi.mock('./profile-manager', () => ({
  profileManager: {
    getProfile: vi.fn(async () => null),
  },
}));

vi.mock('./session-tracker', () => ({
  sessionTracker: {
    getAllSessions: vi.fn(() => []),
  },
}));

function makeEntry(overrides: Partial<Parameters<typeof readingGraph.addEntry>[0]> = {}) {
  return {
    url: 'https://example.com/one',
    title: 'Entry one',
    domain: 'example.com',
    readAt: '2026-07-01T00:00:00.000Z',
    durationSeconds: 60,
    summary: '- summary',
    keyClaims: ['claim one'],
    topics: ['monetary-policy'],
    savedAnnotations: [],
    ...overrides,
  };
}

describe('selectRelevantStoredTopics', () => {
  test('matches hyphenated tags whose words all appear in the text', () => {
    const text = 'The Fed announced new monetary policy measures affecting interest rates.';
    const vocabulary = ['monetary-policy', 'interest-rates', 'crypto-regulation'];

    expect(selectRelevantStoredTopics(text, vocabulary)).toEqual([
      'monetary-policy',
      'interest-rates',
    ]);
  });

  test('requires every meaningful word of the tag to be present', () => {
    expect(selectRelevantStoredTopics('policy discussion only', ['monetary-policy'])).toEqual([]);
  });

  test('ignores tags with no words longer than three characters', () => {
    expect(selectRelevantStoredTopics('ai is everywhere', ['ai', 'ml-ops'])).toEqual([]);
  });

  test('caps results at fifteen tags', () => {
    const vocabulary = Array.from({ length: 20 }, (_, i) => `word${i}-tag${i}`);
    const text = vocabulary.map((t) => t.replace('-', ' ')).join(' ');

    expect(selectRelevantStoredTopics(text, vocabulary)).toHaveLength(15);
  });

  test('returns empty for empty vocabulary', () => {
    expect(selectRelevantStoredTopics('any text at all', [])).toEqual([]);
  });
});

describe('getMemoryContext', () => {
  beforeEach(async () => {
    await readingGraph.clear();
  });

  test('retrieves reading history via stored-vocabulary topic matching', async () => {
    await readingGraph.addEntry(makeEntry());
    await readingGraph.addEntry(makeEntry({
      url: 'https://other.com/two',
      title: 'Unrelated entry',
      domain: 'other.com',
      topics: ['quantum-computing'],
    }));

    const fragment = await getMemoryContext(
      'https://news.site/article',
      'Fed policy article',
      'A long discussion of monetary policy and central banks.',
    );

    expect(fragment.readingHistory).toContain('Entry one');
    expect(fragment.readingHistory).not.toContain('Unrelated entry');
  });

  test('matches by domain even when no topics overlap', async () => {
    await readingGraph.addEntry(makeEntry({ topics: ['unrelated-topic'] }));

    const fragment = await getMemoryContext(
      'https://example.com/new-article',
      'New article',
      'completely different text',
    );

    expect(fragment.readingHistory).toContain('Entry one');
  });

  test('excludes the current url and returns no history when nothing relates', async () => {
    await readingGraph.addEntry(makeEntry({ url: 'https://example.com/self', topics: ['some-topic'] }));

    const fragment = await getMemoryContext(
      'https://elsewhere.net/article',
      'Elsewhere',
      'text with no overlap whatsoever',
    );

    expect(fragment.readingHistory).toBeUndefined();
  });
});
