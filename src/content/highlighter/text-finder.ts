/**
 * Finds an anchor text string in the page DOM and returns a Range
 * covering the matched text. Uses TreeWalker for efficient text node
 * enumeration and supports cross-node matching.
 */

function collectTextNodes(root: Node): Text[] {
  const nodes: Text[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!parent) return NodeFilter.FILTER_REJECT;
      const tag = parent.tagName;
      if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT') {
        return NodeFilter.FILTER_REJECT;
      }
      if (!node.textContent?.trim()) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  let node: Text | null;
  while ((node = walker.nextNode() as Text | null)) {
    nodes.push(node);
  }
  return nodes;
}

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * Find the anchor text in the DOM and return a Range.
 * Tries exact match first, then normalized whitespace match.
 */
export function findTextInDOM(anchor: string, root: Node = document.body): Range | null {
  const textNodes = collectTextNodes(root);
  if (textNodes.length === 0) return null;

  // Build a concatenated text with node boundary tracking
  const segments: { node: Text; start: number; end: number }[] = [];
  let fullText = '';

  for (const node of textNodes) {
    const text = node.textContent || '';
    const start = fullText.length;
    fullText += text;
    segments.push({ node, start, end: fullText.length });
  }

  // Try exact match first
  let matchIndex = fullText.indexOf(anchor);

  // Fallback: normalized whitespace match
  if (matchIndex === -1) {
    const normalizedFull = normalizeWhitespace(fullText);
    const normalizedAnchor = normalizeWhitespace(anchor);
    const normalizedIndex = normalizedFull.indexOf(normalizedAnchor);

    if (normalizedIndex === -1) return null;

    // Map normalized index back to original index
    let origIdx = 0;
    let normIdx = 0;
    while (origIdx < fullText.length && /\s/.test(fullText[origIdx])) origIdx++;

    while (normIdx < normalizedIndex && origIdx < fullText.length) {
      origIdx++;
      if (origIdx < fullText.length && /\s/.test(fullText[origIdx])) {
        while (origIdx < fullText.length && /\s/.test(fullText[origIdx])) origIdx++;
        normIdx++;
      } else {
        normIdx++;
      }
    }
    matchIndex = origIdx;
  }

  if (matchIndex === -1) return null;

  // Find start node and offset
  let startNode: Text | null = null;
  let startOffset = 0;
  let endNode: Text | null = null;
  let endOffset = 0;

  const matchEnd = matchIndex + anchor.length;

  for (const seg of segments) {
    if (!startNode && matchIndex >= seg.start && matchIndex < seg.end) {
      startNode = seg.node;
      startOffset = matchIndex - seg.start;
    }
    if (matchEnd > seg.start && matchEnd <= seg.end) {
      endNode = seg.node;
      endOffset = matchEnd - seg.start;
      break;
    }
  }

  if (!startNode || !endNode) return null;

  try {
    const range = document.createRange();
    range.setStart(startNode, startOffset);
    range.setEnd(endNode, endOffset);
    return range;
  } catch {
    return null;
  }
}
