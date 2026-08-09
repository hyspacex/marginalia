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
