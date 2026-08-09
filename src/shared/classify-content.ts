import type { ContentType, PageMetadata } from './types';

const OPINION_PATH = /\/(opinion|opinions|editorial|editorials|commentary|column|columnist|columnists)(\/|$)/i;
const RESEARCH_HOST = /(^|\.)(arxiv\.org|doi\.org|biorxiv\.org|medrxiv\.org|ssrn\.com|nature\.com|science\.org|acm\.org|ieee\.org)$/i;
const DISCUSSION_HOST = /(^|\.)(news\.ycombinator\.com|lobste\.rs|reddit\.com|stackoverflow\.com|serverfault\.com|superuser\.com|stackexchange\.com)$/i;
const GITHUB_DISCUSSION_PATH = /\/(issues|discussions|pull)\/\d+/i;
const DOCS_HOST = /(^|\.)(wikipedia\.org|developer\.mozilla\.org|readthedocs\.io)$/i;
const DOCS_HOST_PREFIX = /^docs\./i;
const DOCS_PATH = /\/(docs|documentation)(\/|$)/i;

const OPINION_LD_TYPES = new Set(['opinionnewsarticle', 'analysisnewsarticle', 'reviewnewsarticle', 'review']);
const TECHNICAL_LD_TYPES = new Set(['techarticle', 'blogposting']);
const RESEARCH_LD_TYPES = new Set(['scholarlyarticle']);
const DISCUSSION_LD_TYPES = new Set(['discussionforumposting', 'qapage', 'question']);

// Deterministic heuristics; null means inconclusive — the LLM then classifies
// in-prompt during the summary call (no extra request).
export function classifyContent(meta: PageMetadata): ContentType | null {
  const ldTypes = meta.jsonLdTypes.map((t) => t.toLowerCase());

  // Discussion hosts before the opinion path check: forum paths embed user-chosen
  // segments (e.g. reddit.com/r/opinions/...) that would false-match OPINION_PATH.
  if (DISCUSSION_HOST.test(meta.host)) return 'discussion-thread';
  if (/(^|\.)github\.com$/i.test(meta.host) && GITHUB_DISCUSSION_PATH.test(meta.urlPath)) {
    return 'discussion-thread';
  }
  if (ldTypes.some((t) => DISCUSSION_LD_TYPES.has(t))) return 'discussion-thread';

  // URL section beats JSON-LD: publishers commonly mark opinion pieces as plain NewsArticle.
  if (OPINION_PATH.test(meta.urlPath)) return 'opinion-analysis';
  if (ldTypes.some((t) => OPINION_LD_TYPES.has(t))) return 'opinion-analysis';

  if (ldTypes.some((t) => RESEARCH_LD_TYPES.has(t)) || RESEARCH_HOST.test(meta.host)) {
    return 'research-paper';
  }

  // Docs before TECHNICAL_LD_TYPES: doc sites (e.g. MDN) often mark pages as
  // TechArticle. docs.google.com is a user's own document, not documentation.
  if (meta.host.toLowerCase() !== 'docs.google.com') {
    if (
      DOCS_HOST.test(meta.host) ||
      DOCS_HOST_PREFIX.test(meta.host) ||
      DOCS_PATH.test(meta.urlPath)
    ) {
      return 'reference-docs';
    }
  }

  if (ldTypes.some((t) => TECHNICAL_LD_TYPES.has(t))) return 'technical-blog';

  if (ldTypes.some((t) => t.endsWith('newsarticle'))) return 'news-report';
  if (meta.ogType === 'article' && meta.byline !== null && meta.siteName !== null) {
    return 'news-report';
  }

  return null;
}
