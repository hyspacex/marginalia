import type { ContentType, SummarySection } from '@/shared/types';
import { ProviderError } from './provider';
import { createAnnotationStreamParser, createSummaryStreamParser, parseReaderProfile } from './response-parsers';

describe('response parsers', () => {
  test('annotation parser flushes buffered lines and skips invalid entries', () => {
    const parser = createAnnotationStreamParser({
      now: () => 123,
      generateId: (() => {
        let count = 0;
        return () => `annotation-${++count}`;
      })(),
    });

    expect(parser.push('not json\n{"anchor":"Alpha","content":"First"}\n{"anchor":"Beta"}\n')).toEqual([
      { id: 'annotation-1', anchor: 'Alpha', content: 'First', timestamp: 123 },
    ]);

    expect(parser.push('{"anchor":"Gamma","content":"Third"}')).toEqual([]);
    expect(parser.flush()).toEqual([
      { id: 'annotation-2', anchor: 'Gamma', content: 'Third', timestamp: 123 },
    ]);
    expect(parser.flush()).toEqual([]);
  });

  function collectSummaryEvents() {
    const events: {
      metas: ContentType[];
      sections: SummarySection[];
      graphs: { keyClaims: string[]; topics: string[] }[];
    } = { metas: [], sections: [], graphs: [] };

    const parser = createSummaryStreamParser({
      onMeta: (contentType) => events.metas.push(contentType),
      onSection: (section) => events.sections.push(section),
      onGraph: (graph) => events.graphs.push(graph),
    });

    return { events, parser };
  }

  test('summary parser emits meta, sections, and graph across split deltas', () => {
    const { events, parser } = collectSummaryEvents();

    parser.push('{"kind":"meta","contentType":"news-report"}\n{"kind":"section","id":"what-');
    parser.push('happened","heading":"What happened","markdown":"- a\\n- b"}\n');
    parser.push('{"kind":"graph","keyClaims":["claim"],"topics":["topic-one"]}');
    parser.flush();

    expect(events.metas).toEqual(['news-report']);
    expect(events.sections).toEqual([
      { id: 'what-happened', heading: 'What happened', markdown: '- a\n- b' },
    ]);
    expect(events.graphs).toEqual([{ keyClaims: ['claim'], topics: ['topic-one'] }]);
  });

  test('summary parser accepts the discussion-thread and reference-docs meta types', () => {
    const { events, parser } = collectSummaryEvents();

    parser.push('{"kind":"meta","contentType":"discussion-thread"}\n');
    parser.push('{"kind":"meta","contentType":"reference-docs"}\n');

    expect(events.metas).toEqual(['discussion-thread', 'reference-docs']);
  });

  test('summary parser drops malformed lines, unknown kinds, and invalid values', () => {
    const { events, parser } = collectSummaryEvents();

    parser.push('not json\n');
    parser.push('{"kind":"meta","contentType":"not-a-type"}\n');
    parser.push('{"kind":"mystery","id":"x"}\n');
    parser.push('{"kind":"section","id":"empty","heading":"Empty","markdown":"  "}\n');
    parser.push('{"kind":"graph","keyClaims":["ok"],"topics":[1]}\n');
    parser.push('{"kind":"section","id":"ok","heading":"OK","markdown":"- fine"}\n');
    parser.flush();

    expect(events.metas).toEqual([]);
    expect(events.graphs).toEqual([]);
    expect(events.sections).toEqual([{ id: 'ok', heading: 'OK', markdown: '- fine' }]);
  });

  test('summary parser recovers a final line missing its newline via flush', () => {
    const { events, parser } = collectSummaryEvents();

    parser.push('{"kind":"graph","keyClaims":["tail claim"],"topics":["tail-topic"]}');
    expect(events.graphs).toEqual([]);
    parser.flush();
    expect(events.graphs).toEqual([{ keyClaims: ['tail claim'], topics: ['tail-topic'] }]);

    // A truncated final object is dropped, not thrown.
    const second = collectSummaryEvents();
    second.parser.push('{"kind":"graph","keyClaims":["cut off"');
    second.parser.flush();
    expect(second.events.graphs).toEqual([]);
  });

  test('parseReaderProfile validates structure and stamps updatedAt', () => {
    const parsed = parseReaderProfile(
      'preface {"expertise":{"ai":"advanced"},"interests":["systems"],"annotationPreferences":{"depth":"brief","tone":"academic"},"readingGoals":["retain"]} suffix',
      () => Date.parse('2026-03-08T00:00:00.000Z'),
      'openai',
    );

    expect(parsed).toEqual({
      expertise: { ai: 'advanced' },
      interests: ['systems'],
      annotationPreferences: { depth: 'brief', tone: 'academic' },
      readingGoals: ['retain'],
      updatedAt: '2026-03-08T00:00:00.000Z',
    });
  });

  test('parseReaderProfile rejects invalid profiles', () => {
    expect(() => parseReaderProfile(
      '{"expertise":null,"interests":[],"annotationPreferences":{"depth":"brief","tone":"academic"},"readingGoals":[]}',
      () => 0,
      'anthropic',
    )).toThrowError(ProviderError);

    expect(() => parseReaderProfile(
      '{"expertise":{"ai":"expert"},"interests":[],"annotationPreferences":{"depth":"brief","tone":"academic"},"readingGoals":[]}',
      () => 0,
      'anthropic',
    )).toThrowError(ProviderError);
  });
});
