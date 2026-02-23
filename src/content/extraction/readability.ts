import { Readability } from '@mozilla/readability';
import type { ExtractedContent } from '@/shared/types';

export function extractPageContent(): ExtractedContent | null {
  const docClone = document.cloneNode(true) as Document;
  const reader = new Readability(docClone);
  const article = reader.parse();

  if (!article) return null;

  return {
    title: article.title,
    content: article.textContent,
    excerpt: article.excerpt,
    byline: article.byline,
    siteName: article.siteName,
    url: window.location.href,
    length: article.length,
  };
}
