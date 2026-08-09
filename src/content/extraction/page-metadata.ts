import type { ExtractedContent, PageMetadata } from '@/shared/types';

function collectTypes(node: unknown, out: string[]) {
  if (Array.isArray(node)) {
    for (const item of node) collectTypes(item, out);
    return;
  }
  if (node && typeof node === 'object') {
    const record = node as Record<string, unknown>;
    const type = record['@type'];
    if (typeof type === 'string') {
      out.push(type);
    } else if (Array.isArray(type)) {
      for (const t of type) {
        if (typeof t === 'string') out.push(t);
      }
    }
    if (record['@graph']) collectTypes(record['@graph'], out);
  }
}

function collectJsonLdTypes(): string[] {
  const types: string[] = [];
  const scripts = document.querySelectorAll('script[type="application/ld+json"]');
  for (const script of Array.from(scripts)) {
    try {
      collectTypes(JSON.parse(script.textContent ?? ''), types);
    } catch {
      // Malformed JSON-LD is common in the wild; skip the block.
    }
  }
  return types;
}

export function collectPageMetadata(extracted: ExtractedContent): PageMetadata {
  return {
    jsonLdTypes: collectJsonLdTypes(),
    ogType: document.querySelector('meta[property="og:type"]')?.getAttribute('content') ?? null,
    host: window.location.hostname,
    urlPath: window.location.pathname,
    byline: extracted.byline,
    siteName: extracted.siteName,
    wordCount: extracted.content.split(/\s+/).filter(Boolean).length,
  };
}
