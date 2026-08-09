import type { PageMetadata } from './types';
import { classifyContent } from './classify-content';

function meta(overrides: Partial<PageMetadata> = {}): PageMetadata {
  return {
    jsonLdTypes: [],
    ogType: null,
    host: 'example.com',
    urlPath: '/article',
    byline: null,
    siteName: null,
    wordCount: 800,
    ...overrides,
  };
}

describe('classifyContent', () => {
  test('classifies NewsArticle JSON-LD (including subtypes) as news-report', () => {
    expect(classifyContent(meta({ jsonLdTypes: ['NewsArticle'] }))).toBe('news-report');
    expect(classifyContent(meta({ jsonLdTypes: ['ReportageNewsArticle'] }))).toBe('news-report');
  });

  test('opinion URL path overrides NewsArticle JSON-LD', () => {
    expect(classifyContent(meta({
      jsonLdTypes: ['NewsArticle'],
      urlPath: '/opinion/some-take.html',
    }))).toBe('opinion-analysis');
    expect(classifyContent(meta({ urlPath: '/2026/07/columnists/writer' }))).toBe('opinion-analysis');
  });

  test('classifies opinion and analysis JSON-LD subtypes', () => {
    expect(classifyContent(meta({ jsonLdTypes: ['OpinionNewsArticle'] }))).toBe('opinion-analysis');
    expect(classifyContent(meta({ jsonLdTypes: ['AnalysisNewsArticle'] }))).toBe('opinion-analysis');
  });

  test('classifies research hosts and ScholarlyArticle as research-paper', () => {
    expect(classifyContent(meta({ host: 'arxiv.org', urlPath: '/abs/2401.00001' }))).toBe('research-paper');
    expect(classifyContent(meta({ host: 'www.nature.com' }))).toBe('research-paper');
    expect(classifyContent(meta({ jsonLdTypes: ['ScholarlyArticle'] }))).toBe('research-paper');
  });

  test('classifies BlogPosting and TechArticle as technical-blog', () => {
    expect(classifyContent(meta({ jsonLdTypes: ['BlogPosting'] }))).toBe('technical-blog');
    expect(classifyContent(meta({ jsonLdTypes: ['TechArticle'] }))).toBe('technical-blog');
  });

  test('classifies discussion hosts and forum/Q&A JSON-LD as discussion-thread', () => {
    expect(classifyContent(meta({ host: 'news.ycombinator.com', urlPath: '/item' }))).toBe('discussion-thread');
    expect(classifyContent(meta({ host: 'old.reddit.com', urlPath: '/r/programming/comments/abc' }))).toBe('discussion-thread');
    expect(classifyContent(meta({ host: 'stackoverflow.com', urlPath: '/questions/1234/how' }))).toBe('discussion-thread');
    expect(classifyContent(meta({ host: 'unix.stackexchange.com', urlPath: '/questions/1' }))).toBe('discussion-thread');
    expect(classifyContent(meta({ jsonLdTypes: ['DiscussionForumPosting'] }))).toBe('discussion-thread');
    expect(classifyContent(meta({ jsonLdTypes: ['QAPage'] }))).toBe('discussion-thread');
  });

  test('classifies GitHub issues, discussions, and PRs as discussion-thread, but not repo pages', () => {
    expect(classifyContent(meta({ host: 'github.com', urlPath: '/owner/repo/issues/42' }))).toBe('discussion-thread');
    expect(classifyContent(meta({ host: 'github.com', urlPath: '/owner/repo/discussions/7' }))).toBe('discussion-thread');
    expect(classifyContent(meta({ host: 'github.com', urlPath: '/owner/repo/pull/99' }))).toBe('discussion-thread');
    expect(classifyContent(meta({ host: 'github.com', urlPath: '/owner/repo' }))).toBeNull();
  });

  test('discussion host wins over an opinion-looking forum path', () => {
    expect(classifyContent(meta({
      host: 'www.reddit.com',
      urlPath: '/r/opinions/comments/abc/take',
    }))).toBe('discussion-thread');
  });

  test('classifies documentation hosts and paths as reference-docs', () => {
    expect(classifyContent(meta({ host: 'en.wikipedia.org', urlPath: '/wiki/Topic' }))).toBe('reference-docs');
    expect(classifyContent(meta({ host: 'developer.mozilla.org', urlPath: '/en-US/docs/Web' }))).toBe('reference-docs');
    expect(classifyContent(meta({ host: 'docs.python.org', urlPath: '/3/library/asyncio.html' }))).toBe('reference-docs');
    expect(classifyContent(meta({ host: 'myproject.readthedocs.io', urlPath: '/en/stable/' }))).toBe('reference-docs');
    expect(classifyContent(meta({ host: 'example.com', urlPath: '/docs/getting-started' }))).toBe('reference-docs');
  });

  test('reference-docs wins over TechArticle JSON-LD on doc sites', () => {
    expect(classifyContent(meta({
      host: 'developer.mozilla.org',
      urlPath: '/en-US/docs/Web/API',
      jsonLdTypes: ['TechArticle'],
    }))).toBe('reference-docs');
  });

  test('does not classify docs.google.com documents as reference-docs', () => {
    expect(classifyContent(meta({ host: 'docs.google.com', urlPath: '/document/d/abc/edit' }))).toBeNull();
  });

  test('falls back to news-report for og:type article with byline and site name', () => {
    expect(classifyContent(meta({
      ogType: 'article',
      byline: 'A. Writer',
      siteName: 'The Example Times',
    }))).toBe('news-report');
  });

  test('returns null when signals are inconclusive', () => {
    expect(classifyContent(meta())).toBeNull();
    expect(classifyContent(meta({ ogType: 'article' }))).toBeNull();
    expect(classifyContent(meta({ ogType: 'website', byline: 'X', siteName: 'Y' }))).toBeNull();
  });
});
