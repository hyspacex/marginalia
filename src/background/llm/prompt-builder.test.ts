import type { AnnotationRequest, ReaderProfile, SessionState, SummaryRequest } from '@/shared/types';
import { buildAnnotationPrompt, buildProfileUpdatePrompt, buildSummaryPrompt } from './prompt-builder';

const annotationRequest: AnnotationRequest = {
  pageContent: 'x'.repeat(13000),
  memoryContext: {
    profile: 'reader profile',
    readingHistory: 'history',
    sessionContext: 'session context',
  },
  url: 'https://example.com/article',
  title: 'Example title',
};

const profile: ReaderProfile = {
  expertise: { ai: 'advanced' },
  interests: ['systems'],
  annotationPreferences: { depth: 'detailed', tone: 'collegial' },
  readingGoals: ['retain'],
  updatedAt: '2026-03-01T00:00:00.000Z',
};

const session: SessionState = {
  tabId: 1,
  url: 'https://example.com/article',
  title: 'Example title',
  pageContent: 'body',
  pageSummary: null,
  annotations: [{ id: 'a1', anchor: 'Alpha', content: 'First', timestamp: 1 }],
  interactions: [{ type: 'thumbs_up', text: 'helpful', timestamp: 10 }],
  startedAt: 0,
  lastActiveAt: 3000,
};

describe('prompt builder', () => {
  test('includes available memory sections and truncates page content', () => {
    const prompt = buildAnnotationPrompt(annotationRequest);

    expect(prompt.system).toContain('<reader_profile>\nreader profile\n</reader_profile>');
    expect(prompt.system).toContain('<reading_history>\nhistory\n</reading_history>');
    expect(prompt.system).toContain('<session_context>\nsession context\n</session_context>');
    expect(prompt.user).toContain('"Example title" (https://example.com/article)');
    expect(prompt.user).toContain('Generate 3-5 inline annotations');
    expect(prompt.user).toContain('x'.repeat(12000));
    expect(prompt.user).not.toContain('x'.repeat(12001));
  });

  test('omits the reader context section when memory is empty', () => {
    const prompt = buildAnnotationPrompt({
      ...annotationRequest,
      memoryContext: {},
      pageContent: 'short body',
    });

    expect(prompt.system).not.toContain('## Reader Context');
  });

  test('buildProfileUpdatePrompt summarizes interactions and duration', () => {
    const prompt = buildProfileUpdatePrompt(profile, session);

    expect(prompt.user).toContain('Annotations generated: 1');
    expect(prompt.user).toContain('Interactions: thumbs_up: helpful');
    expect(prompt.user).toContain('Duration: 3s');
  });

  test('buildProfileUpdatePrompt falls back to "none" when there are no interactions', () => {
    const prompt = buildProfileUpdatePrompt(profile, {
      ...session,
      interactions: [],
    });

    expect(prompt.user).toContain('Interactions: none');
  });

  const summaryRequest: SummaryRequest = {
    text: 'body',
    title: 'Summary title',
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

  test('buildSummaryPrompt uses the classified type template and truncates text', () => {
    const prompt = buildSummaryPrompt({ ...summaryRequest, text: 'y'.repeat(13000) });

    expect(prompt.system).toContain('Content type: news-report');
    expect(prompt.system).toContain('fact-vs-framing');
    expect(prompt.system).not.toContain('First decide the content type');
    expect(prompt.user).toContain('"Summary title" (https://example.com/article)');
    expect(prompt.user).toContain('y'.repeat(12000));
    expect(prompt.user).not.toContain('y'.repeat(12001));
  });

  test('buildSummaryPrompt falls back to in-prompt classification with all schemas', () => {
    const prompt = buildSummaryPrompt({ ...summaryRequest, contentType: null });

    expect(prompt.system).toContain('First decide the content type');
    expect(prompt.system).toContain('Content type: news-report');
    expect(prompt.system).toContain('Content type: technical-blog');
    expect(prompt.system).toContain('Content type: research-paper');
    expect(prompt.system).toContain('Content type: opinion-analysis');
    expect(prompt.system).toContain('Content type: other');
  });

  test('buildSummaryPrompt injects reader memory when provided', () => {
    const prompt = buildSummaryPrompt({
      ...summaryRequest,
      memoryContext: { profile: 'reader profile', readingHistory: 'history' },
    });

    expect(prompt.system).toContain('<reader_profile>\nreader profile\n</reader_profile>');
    expect(prompt.system).toContain('<reading_history>\nhistory\n</reading_history>');
  });

  test('buildSummaryPrompt omits reader context when memory is empty', () => {
    const prompt = buildSummaryPrompt(summaryRequest);

    expect(prompt.system).not.toContain('## Reader Context');
  });
});
