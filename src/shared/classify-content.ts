import type { ContentType, PageMetadata } from './types';

const OPINION_PATH = /\/(opinion|opinions|editorial|editorials|commentary|column|columnist|columnists)(\/|$)/i;
const RESEARCH_HOST = /(^|\.)(arxiv\.org|doi\.org|biorxiv\.org|medrxiv\.org|ssrn\.com|nature\.com|science\.org|acm\.org|ieee\.org)$/i;

const OPINION_LD_TYPES = new Set(['opinionnewsarticle', 'analysisnewsarticle', 'reviewnewsarticle', 'review']);
const TECHNICAL_LD_TYPES = new Set(['techarticle', 'blogposting']);
const RESEARCH_LD_TYPES = new Set(['scholarlyarticle']);

// Deterministic heuristics; null means inconclusive — the LLM then classifies
// in-prompt during the summary call (no extra request).
export function classifyContent(meta: PageMetadata): ContentType | null {
  const ldTypes = meta.jsonLdTypes.map((t) => t.toLowerCase());

  // URL section beats JSON-LD: publishers commonly mark opinion pieces as plain NewsArticle.
  if (OPINION_PATH.test(meta.urlPath)) return 'opinion-analysis';
  if (ldTypes.some((t) => OPINION_LD_TYPES.has(t))) return 'opinion-analysis';

  if (ldTypes.some((t) => RESEARCH_LD_TYPES.has(t)) || RESEARCH_HOST.test(meta.host)) {
    return 'research-paper';
  }

  if (ldTypes.some((t) => TECHNICAL_LD_TYPES.has(t))) return 'technical-blog';

  if (ldTypes.some((t) => t.endsWith('newsarticle'))) return 'news-report';
  if (meta.ogType === 'article' && meta.byline !== null && meta.siteName !== null) {
    return 'news-report';
  }

  return null;
}
