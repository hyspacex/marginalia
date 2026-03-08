import { ProviderError } from './provider';
import { createAnnotationStreamParser, parsePageSummary, parseReaderProfile } from './response-parsers';

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

  test('parsePageSummary extracts the first JSON object and validates shape', () => {
    expect(parsePageSummary(
      'prefix {"summary":"- one","keyClaims":["claim"],"topics":["topic-{x}"]} suffix',
      'openai',
    )).toEqual({
      summary: '- one',
      keyClaims: ['claim'],
      topics: ['topic-{x}'],
    });
  });

  test('parsePageSummary throws for missing or invalid JSON', () => {
    expect(() => parsePageSummary('no json here', 'anthropic')).toThrowError(ProviderError);
    expect(() => parsePageSummary('{"summary":1,"keyClaims":[],"topics":[]}', 'anthropic')).toThrowError(ProviderError);
    expect(() => parsePageSummary('{"summary":"ok"', 'anthropic')).toThrowError(ProviderError);
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
