# Inline Annotations Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the sidebar-based annotation UI with inline highlights on article text + hover cards, using CSS Custom Highlight API for zero-DOM-mutation highlighting and Floating UI for card positioning.

**Architecture:** Content script creates highlights via CSS Custom Highlight API on page text, positions invisible hit-target overlays for hover detection, and renders a single reusable HoverCard + FloatingPill in Shadow DOM. Service worker streams simplified JSONL annotations (anchor + content, no modes) via existing port-based protocol.

**Tech Stack:** Preact, CSS Custom Highlight API, @floating-ui/dom, marked, DOMPurify, Chrome Extension MV3

---

### Task 1: Install @floating-ui/dom

**Files:**
- Modify: `package.json`

**Step 1: Install the dependency**

Run: `npm install @floating-ui/dom`

**Step 2: Verify installation**

Run: `ls node_modules/@floating-ui/dom/dist/`
Expected: Files present including `floating-ui.dom.mjs` or similar

**Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "Add @floating-ui/dom dependency for hover card positioning"
```

---

### Task 2: Simplify shared types (drop modes, require anchor)

**Files:**
- Modify: `src/shared/types.ts`

**Step 1: Update types**

Remove `AnnotationMode` type entirely.

Update `Annotation`:
```typescript
export interface Annotation {
  id: string;
  content: string;
  anchor: string;  // Required: exact quote from article
  timestamp: number;
}
```

Update `AnnotationRequest` — remove `modes` and `selectedText`:
```typescript
export interface AnnotationRequest {
  pageContent: string;
  memoryContext: MemoryPromptFragment;
  url: string;
  title: string;
}
```

Update `ReaderProfile` — remove `annotationPreferences.defaultModes`:
```typescript
export interface ReaderProfile {
  expertise: Record<string, 'beginner' | 'intermediate' | 'advanced'>;
  interests: string[];
  annotationPreferences: {
    depth: 'brief' | 'detailed';
    tone: 'academic' | 'collegial' | 'casual';
  };
  readingGoals: string[];
  updatedAt: string;
}
```

Update `SessionState` — remove `modes`:
```typescript
export interface SessionState {
  tabId: number;
  url: string;
  title: string;
  annotations: Annotation[];
  interactions: UserInteraction[];
  startedAt: number;
  lastActiveAt: number;
}
```

Update `RequestMessage` — simplify:
```typescript
export type RequestMessage =
  | { type: 'ANNOTATE_PAGE'; payload: { url: string; title: string; text: string } }
  | { type: 'SAVE_ANNOTATION'; payload: { annotation: Annotation } }
  | { type: 'RECORD_INTERACTION'; payload: { interaction: UserInteraction } }
  | { type: 'GET_SESSION'; payload: { tabId: number } }
  | { type: 'END_SESSION'; payload: { tabId: number } }
  | { type: 'TEST_CONNECTION'; payload: { config: ProviderConfig } };
```

Update `PortMessage` — remove modes and selectedText:
```typescript
export type PortMessage =
  | { type: 'START_ANNOTATE'; payload: { url: string; title: string; text: string } }
  | { type: 'ANNOTATION_CHUNK'; payload: { annotation: Annotation } }
  | { type: 'STREAM_DONE'; payload: { usage: TokenUsage } }
  | { type: 'STREAM_ERROR'; payload: { message: string; code: string } };
```

**Step 2: Verify types compile**

Run: `npx tsc --noEmit 2>&1 | head -50`
Expected: Type errors in files that still reference `AnnotationMode` — these will be fixed in subsequent tasks.

**Step 3: Commit**

```bash
git add src/shared/types.ts
git commit -m "Simplify types: drop annotation modes, require anchor field"
```

---

### Task 3: Simplify constants (remove modes)

**Files:**
- Modify: `src/shared/constants.ts`

**Step 1: Replace constants file content**

Remove: `SIDEBAR_WIDTH`, `DEFAULT_MODES`, `MODE_LABELS`, `MODE_COLORS`, `MODE_ICONS`, and the `AnnotationMode` import.

Add highlight/card constants:

```typescript
export const EXTENSION_NAME = 'Marginalia';

export const HIGHLIGHT_COLORS = {
  background: 'rgba(255, 200, 80, 0.15)',
  backgroundHover: 'rgba(255, 200, 80, 0.30)',
  underline: 'rgba(180, 140, 50, 0.5)',
};

export const CARD_CONFIG = {
  maxWidth: 360,
  openDelay: 300,
  closeDelay: 200,
};

export const ANTHROPIC_MODELS: ModelOption[] = [
  {
    id: 'claude-sonnet-4-5-20250929',
    name: 'Claude Sonnet 4.5',
    contextWindow: 200000,
    costPer1kInput: 0.003,
    costPer1kOutput: 0.015,
  },
  {
    id: 'claude-haiku-3-5-20241022',
    name: 'Claude Haiku 3.5',
    contextWindow: 200000,
    costPer1kInput: 0.0008,
    costPer1kOutput: 0.004,
  },
];

export const DEFAULT_ANTHROPIC_CONFIG = {
  baseUrl: 'https://api.anthropic.com',
  model: 'claude-sonnet-4-5-20250929',
};

export const MEMORY_TOKEN_BUDGET = 1000;
export const SESSION_IDLE_TIMEOUT_MS = 30 * 60 * 1000;
export const PORT_NAME = 'marginalia-stream';
```

**Step 2: Commit**

```bash
git add src/shared/constants.ts
git commit -m "Replace mode constants with highlight/card constants"
```

---

### Task 4: Write new annotation prompt

**Files:**
- Create: `src/prompts/annotate.txt`
- Delete: `src/prompts/close-reading.txt`
- Delete: `src/prompts/context.txt`
- Delete: `src/prompts/devil-advocate.txt`
- Modify: `src/prompts/base.txt`

**Step 1: Replace base.txt**

```
You are Marginalia, an AI reading companion. You identify the most interesting and insightful sentences in an article and annotate them with brief, illuminating observations — like a well-read friend's margin notes.

## Output Format

Output one JSON object per line (JSONL format). Each annotation is a separate line:

{"anchor": "Exact quote from the article text", "content": "Your 1-3 sentence annotation."}

Rules:
- Each line must be a valid JSON object
- Do NOT wrap in a code block or array
- The "anchor" field MUST be an exact substring copied from the article text (15-80 characters). The reader's browser will search for this exact string to highlight it.
- The "content" field is a concise insight (1-3 sentences). Supports markdown.
- Generate exactly 3-5 annotations total for the article
- Pick the most interesting, non-obvious observations
- Mix annotation types: definitions of jargon, historical context, unstated assumptions, connections to broader trends, surprising implications
- Adapt to the reader's expertise — skip explanations they already know
- Be specific to this article, not generic
```

**Step 2: Create annotate.txt**

```
When selecting which sentences to annotate, prioritize:

1. Jargon or technical terms a general reader might not know
2. Claims that deserve scrutiny or context
3. Sentences where historical or cultural context enriches understanding
4. Implicit assumptions the author makes without stating
5. Connections to broader patterns or recent events

Your annotations should be:
- Concise: 1-3 sentences max. No filler.
- Specific: Reference the exact text, not abstract ideas.
- Illuminating: Tell the reader something they didn't know or hadn't considered.
- Varied: Don't annotate 5 similar things. Mix definitions, context, and critical observations.
```

**Step 3: Delete old mode prompts**

```bash
rm src/prompts/close-reading.txt src/prompts/context.txt src/prompts/devil-advocate.txt
```

**Step 4: Commit**

```bash
git add src/prompts/
git commit -m "Replace mode-specific prompts with single annotation prompt"
```

---

### Task 5: Update prompt-builder.ts

**Files:**
- Modify: `src/background/llm/prompt-builder.ts`

**Step 1: Rewrite prompt-builder.ts**

Remove mode-specific imports and logic. New implementation:

```typescript
import type { AnnotationRequest, ReaderProfile, SessionState, MemoryPromptFragment } from '@/shared/types';
import basePrompt from '@/prompts/base.txt?raw';
import annotatePrompt from '@/prompts/annotate.txt?raw';

function buildMemorySection(memory: MemoryPromptFragment): string {
  const parts: string[] = [];

  if (memory.profile) {
    parts.push(`<reader_profile>\n${memory.profile}\n</reader_profile>`);
  }

  if (memory.readingHistory) {
    parts.push(`<reading_history>\n${memory.readingHistory}\n</reading_history>`);
  }

  if (memory.sessionContext) {
    parts.push(`<session_context>\n${memory.sessionContext}\n</session_context>`);
  }

  return parts.length > 0
    ? `\n\n## Reader Context\n\n${parts.join('\n\n')}`
    : '';
}

export function buildAnnotationPrompt(request: AnnotationRequest): { system: string; user: string } {
  const memorySection = buildMemorySection(request.memoryContext);
  const system = `${basePrompt}\n\n## Annotation Guidelines\n\n${annotatePrompt}${memorySection}`;
  const user = `Page: "${request.title}" (${request.url})\n\n<page_content>\n${request.pageContent.slice(0, 12000)}\n</page_content>\n\nGenerate 3-5 inline annotations for this article.`;

  return { system, user };
}

export function buildProfileUpdatePrompt(
  current: ReaderProfile,
  session: SessionState,
): { system: string; user: string } {
  const system = `You are updating a reader profile based on a reading session. Output a valid JSON object with the same structure as the current profile, incorporating any new information from the session. Only make meaningful updates — don't change things unnecessarily.

The profile JSON must have these fields:
- expertise: Record<string, "beginner" | "intermediate" | "advanced">
- interests: string[]
- annotationPreferences: { depth: "brief" | "detailed", tone: "academic" | "collegial" | "casual" }
- readingGoals: string[]`;

  const user = `Current profile:\n${JSON.stringify(current, null, 2)}\n\nSession summary:\n- URL: ${session.url}\n- Title: ${session.title}\n- Annotations generated: ${session.annotations.length}\n- Interactions: ${session.interactions.map((i) => `${i.type}${i.text ? `: ${i.text}` : ''}`).join('; ') || 'none'}\n- Duration: ${Math.round((session.lastActiveAt - session.startedAt) / 1000)}s\n\nOutput the updated profile JSON:`;

  return { system, user };
}

export function buildSummaryPrompt(
  text: string,
  title: string,
): { system: string; user: string } {
  const system = `Summarize the following page for a reading graph. Output a JSON object with:
- summary: 2-3 sentence summary
- keyClaims: array of 2-5 key claims or arguments
- topics: array of 3-7 topic tags (lowercase, hyphenated)

Output only the JSON object, nothing else.`;

  const user = `Title: ${title}\n\n${text.slice(0, 8000)}`;

  return { system, user };
}
```

**Step 2: Commit**

```bash
git add src/background/llm/prompt-builder.ts
git commit -m "Simplify prompt builder: single annotation prompt, no modes"
```

---

### Task 6: Update anthropic.ts (parser + stream)

**Files:**
- Modify: `src/background/llm/anthropic.ts`

**Step 1: Update imports and parseAnnotationLines**

Remove `AnnotationMode` from imports. Update `parseAnnotationLines`:

```typescript
function parseAnnotationLines(text: string): Annotation[] {
  const annotations: Annotation[] = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || !trimmed.startsWith('{')) continue;
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed.anchor && parsed.content) {
        annotations.push({
          id: crypto.randomUUID(),
          content: parsed.content,
          anchor: parsed.anchor,
          timestamp: Date.now(),
        });
      }
    } catch {
      // Skip unparseable lines
    }
  }
  return annotations;
}
```

**Step 2: Update streamAnnotations JSONL parsing**

In the `streamAnnotations` method, update the inline JSONL parser to check for `anchor` + `content` instead of `mode` + `content`:

```typescript
// Inside the streaming loop, replace the annotation creation:
if (parsed.anchor && parsed.content) {
  onAnnotation({
    id: crypto.randomUUID(),
    content: parsed.content,
    anchor: parsed.anchor,
    timestamp: Date.now(),
  });
}
```

Apply the same change to the trailing text parser at the end of `streamAnnotations`.

**Step 3: Update generateAnnotations**

Change the call from `parseAnnotationLines(text, request.modes)` to `parseAnnotationLines(text)`.

**Step 4: Update provider.ts interface**

Remove `AnnotationMode` from the import in `src/background/llm/provider.ts`. The `LLMProvider` interface types should still work since `AnnotationRequest` and `Annotation` are already updated.

**Step 5: Commit**

```bash
git add src/background/llm/anthropic.ts src/background/llm/provider.ts
git commit -m "Update LLM parser: require anchor field, drop mode field"
```

---

### Task 7: Update session-tracker.ts

**Files:**
- Modify: `src/background/memory/session-tracker.ts`

**Step 1: Remove mode references**

Remove `AnnotationMode` import. Update `startSession` signature — remove `modes` parameter:

```typescript
startSession(tabId: number, url: string, title: string) {
  const existing = sessions.get(tabId);
  if (existing && existing.url === url) {
    existing.lastActiveAt = Date.now();
    return;
  }

  sessions.set(tabId, {
    tabId,
    url,
    title,
    annotations: [],
    interactions: [],
    startedAt: Date.now(),
    lastActiveAt: Date.now(),
  });
},
```

**Step 2: Commit**

```bash
git add src/background/memory/session-tracker.ts
git commit -m "Remove mode references from session tracker"
```

---

### Task 8: Update service-worker.ts

**Files:**
- Modify: `src/background/service-worker.ts`

**Step 1: Simplify the port message handler**

In the `START_ANNOTATE` handler:
- Remove `selectedText` and `modes` destructuring from `msg.payload`
- Change `sessionTracker.startSession(tabId, url, title, modes)` to `sessionTracker.startSession(tabId, url, title)`
- Remove `selectedText` and `modes` from the `AnnotationRequest` object

Updated handler section:

```typescript
port.onMessage.addListener(async (msg: PortMessage) => {
  if (msg.type !== 'START_ANNOTATE') return;

  const { url, title, text } = msg.payload;

  try {
    const config = await getProviderConfig();

    if (!config.apiKey) {
      port.postMessage({
        type: 'STREAM_ERROR',
        payload: { message: 'No API key configured. Set your Anthropic API key in the extension options.', code: 'NO_API_KEY' },
      });
      return;
    }

    const tabId = port.sender?.tab?.id;
    if (tabId) {
      sessionTracker.startSession(tabId, url, title);
    }

    const memoryContext = await getMemoryContext(url, title, text, tabId);

    const request: AnnotationRequest = {
      pageContent: text,
      memoryContext,
      url,
      title,
    };

    const { usage } = await anthropicProvider.streamAnnotations(
      request,
      config,
      (annotation) => {
        if (tabId) {
          sessionTracker.addAnnotation(tabId, annotation);
        }
        port.postMessage({ type: 'ANNOTATION_CHUNK', payload: { annotation } });
      },
    );

    await usageTracker.recordUsage(usage.inputTokens, usage.outputTokens);
    port.postMessage({ type: 'STREAM_DONE', payload: { usage } });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    port.postMessage({
      type: 'STREAM_ERROR',
      payload: { message, code: 'STREAM_FAILED' },
    });
  }
});
```

**Step 2: Update endSession**

The `endSession` function references `session.modes` in the profile update prompt. Since `SessionState` no longer has `modes`, this is already handled by the updated `buildProfileUpdatePrompt` in Task 5.

**Step 3: Commit**

```bash
git add src/background/service-worker.ts
git commit -m "Simplify service worker: remove modes from annotation flow"
```

---

### Task 9: Create text-finder.ts

**Files:**
- Create: `src/content/highlighter/text-finder.ts`

**Step 1: Write the text finder module**

This module finds an exact text substring in the page DOM and returns a Range.

```typescript
/**
 * Finds an anchor text string in the page DOM and returns a Range
 * covering the matched text. Uses TreeWalker for efficient text node
 * enumeration and supports cross-node matching.
 */

interface TextMatch {
  range: Range;
  node: Text;
  startOffset: number;
}

function collectTextNodes(root: Node): Text[] {
  const nodes: Text[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      // Skip invisible nodes (script, style, noscript)
      const parent = node.parentElement;
      if (!parent) return NodeFilter.FILTER_REJECT;
      const tag = parent.tagName;
      if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT') {
        return NodeFilter.FILTER_REJECT;
      }
      // Skip empty text nodes
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
    // Walk through original text tracking normalized position
    let origIdx = 0;
    let normIdx = 0;
    // Skip leading whitespace
    while (origIdx < fullText.length && /\s/.test(fullText[origIdx])) origIdx++;

    while (normIdx < normalizedIndex && origIdx < fullText.length) {
      origIdx++;
      if (origIdx < fullText.length && /\s/.test(fullText[origIdx])) {
        while (origIdx < fullText.length && /\s/.test(fullText[origIdx])) origIdx++;
        normIdx++; // One normalized space
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
```

**Step 2: Commit**

```bash
git add src/content/highlighter/text-finder.ts
git commit -m "Add text-finder: TreeWalker-based DOM text search for anchoring"
```

---

### Task 10: Create highlight-manager.ts

**Files:**
- Create: `src/content/highlighter/highlight-manager.ts`

**Step 1: Write the highlight manager**

This module manages CSS Custom Highlights, hit-target overlays, and coordinates with the hover card.

```typescript
import type { Annotation } from '@/shared/types';
import { findTextInDOM } from './text-finder';

interface HighlightEntry {
  annotation: Annotation;
  range: Range;
  hitTargets: HTMLElement[];
}

const HIGHLIGHT_NAME = 'marginalia';
const HIT_TARGET_CLASS = 'marginalia-hit-target';

let entries: HighlightEntry[] = [];
let highlight: Highlight | null = null;
let visible = true;
let onHoverCallback: ((annotation: Annotation, rect: DOMRect) => void) | null = null;
let onLeaveCallback: (() => void) | null = null;
let repositionRAF: number | null = null;

function createHitTargets(range: Range, annotation: Annotation): HTMLElement[] {
  const rects = range.getClientRects();
  const targets: HTMLElement[] = [];

  for (const rect of rects) {
    const el = document.createElement('div');
    el.className = HIT_TARGET_CLASS;
    el.dataset.annotationId = annotation.id;
    Object.assign(el.style, {
      position: 'absolute',
      top: `${window.scrollY + rect.top}px`,
      left: `${window.scrollX + rect.left}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
      zIndex: '2147483645',
      pointerEvents: 'auto',
      cursor: 'pointer',
      background: 'transparent',
    });

    el.addEventListener('mouseenter', () => {
      onHoverCallback?.(annotation, rect);
    });

    el.addEventListener('mouseleave', (e) => {
      // Check if moving to the hover card (hover bridge)
      const related = (e as MouseEvent).relatedTarget as HTMLElement | null;
      if (related?.closest?.('#marginalia-host')) return;
      onLeaveCallback?.();
    });

    document.body.appendChild(el);
    targets.push(el);
  }

  return targets;
}

function repositionHitTargets() {
  for (const entry of entries) {
    const rects = entry.range.getClientRects();
    const targets = entry.hitTargets;

    for (let i = 0; i < targets.length && i < rects.length; i++) {
      const rect = rects[i];
      Object.assign(targets[i].style, {
        top: `${window.scrollY + rect.top}px`,
        left: `${window.scrollX + rect.left}px`,
        width: `${rect.width}px`,
        height: `${rect.height}px`,
      });
    }
  }
}

function scheduleReposition() {
  if (repositionRAF !== null) return;
  repositionRAF = requestAnimationFrame(() => {
    repositionHitTargets();
    repositionRAF = null;
  });
}

export const highlightManager = {
  init(
    onHover: (annotation: Annotation, rect: DOMRect) => void,
    onLeave: () => void,
  ) {
    onHoverCallback = onHover;
    onLeaveCallback = onLeave;

    window.addEventListener('scroll', scheduleReposition, { passive: true });
    window.addEventListener('resize', scheduleReposition, { passive: true });
  },

  addAnnotation(annotation: Annotation): boolean {
    const range = findTextInDOM(annotation.anchor);
    if (!range) return false;

    // Register CSS highlight
    if (!highlight) {
      highlight = new Highlight();
      CSS.highlights.set(HIGHLIGHT_NAME, highlight);
    }
    highlight.add(range);

    // Create hit targets
    const hitTargets = createHitTargets(range, annotation);

    entries.push({ annotation, range, hitTargets });
    return true;
  },

  setVisible(show: boolean) {
    visible = show;
    if (show) {
      if (highlight) {
        CSS.highlights.set(HIGHLIGHT_NAME, highlight);
      }
      for (const entry of entries) {
        for (const el of entry.hitTargets) {
          el.style.display = '';
        }
      }
    } else {
      CSS.highlights.delete(HIGHLIGHT_NAME);
      for (const entry of entries) {
        for (const el of entry.hitTargets) {
          el.style.display = 'none';
        }
      }
    }
  },

  isVisible(): boolean {
    return visible;
  },

  getCount(): number {
    return entries.length;
  },

  clear() {
    CSS.highlights.delete(HIGHLIGHT_NAME);
    highlight = null;

    for (const entry of entries) {
      for (const el of entry.hitTargets) {
        el.remove();
      }
    }
    entries = [];

    window.removeEventListener('scroll', scheduleReposition);
    window.removeEventListener('resize', scheduleReposition);
    if (repositionRAF !== null) {
      cancelAnimationFrame(repositionRAF);
      repositionRAF = null;
    }
  },
};
```

**Step 2: Commit**

```bash
git add src/content/highlighter/highlight-manager.ts
git commit -m "Add highlight-manager: CSS Custom Highlight API + hit targets"
```

---

### Task 11: Create inline.css

**Files:**
- Create: `src/content/styles/inline.css`

**Step 1: Write the inline styles**

These styles go into the Shadow DOM for the hover card and floating pill. The `::highlight()` pseudo-element rule is injected into the page head separately (not Shadow DOM).

```css
:host {
  all: initial;
}

/* Hover Card */
.marginalia-card {
  position: fixed;
  z-index: 2147483647;
  max-width: 360px;
  padding: 12px 16px;
  background: #fff;
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12), 0 1px 3px rgba(0, 0, 0, 0.06);
  font-family: system-ui, -apple-system, 'Segoe UI', sans-serif;
  font-size: 13px;
  line-height: 1.6;
  color: #334155;
  opacity: 0;
  transform: translateY(4px);
  transition: opacity 150ms ease, transform 150ms ease;
  pointer-events: auto;
  box-sizing: border-box;
}

.marginalia-card *,
.marginalia-card *::before,
.marginalia-card *::after {
  box-sizing: border-box;
}

.marginalia-card.visible {
  opacity: 1;
  transform: translateY(0);
}

.marginalia-card-label {
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: #94a3b8;
  margin-bottom: 6px;
}

.marginalia-card-body p {
  margin: 0 0 8px;
}

.marginalia-card-body p:last-child {
  margin-bottom: 0;
}

.marginalia-card-body strong {
  font-weight: 600;
  color: #1e293b;
}

.marginalia-card-body em {
  font-style: italic;
}

.marginalia-card-body code {
  font-size: 12px;
  padding: 1px 4px;
  background: #f1f5f9;
  border-radius: 3px;
}

/* Arrow */
.marginalia-card-arrow {
  position: absolute;
  width: 8px;
  height: 8px;
  background: #fff;
  transform: rotate(45deg);
  box-shadow: -1px -1px 2px rgba(0, 0, 0, 0.04);
}

/* Floating Pill */
.marginalia-pill {
  position: fixed;
  bottom: 24px;
  right: 24px;
  z-index: 2147483647;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 14px;
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 20px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
  font-family: system-ui, -apple-system, 'Segoe UI', sans-serif;
  font-size: 12px;
  font-weight: 500;
  color: #475569;
  cursor: pointer;
  user-select: none;
  transition: box-shadow 0.15s, background 0.15s;
  box-sizing: border-box;
}

.marginalia-pill:hover {
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12);
  background: #f8fafc;
}

.marginalia-pill-icon {
  width: 16px;
  height: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.marginalia-pill.loading {
  color: #94a3b8;
}

.marginalia-pill.loading .marginalia-pill-icon {
  animation: marginalia-pulse 1.5s ease-in-out infinite;
}

@keyframes marginalia-pulse {
  0%, 100% { opacity: 0.4; }
  50% { opacity: 1; }
}

.marginalia-pill.hidden-state {
  opacity: 0.6;
}
```

**Step 2: Commit**

```bash
git add src/content/styles/inline.css
git commit -m "Add inline CSS for hover card and floating pill"
```

---

### Task 12: Create HoverCard.tsx

**Files:**
- Create: `src/content/card/HoverCard.tsx`

**Step 1: Write the HoverCard component**

Single reusable card positioned via Floating UI's `computePosition`.

```tsx
import { useState, useEffect, useRef, useCallback, useMemo } from 'preact/hooks';
import { computePosition, flip, shift, offset, arrow } from '@floating-ui/dom';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import type { Annotation } from '@/shared/types';
import { CARD_CONFIG } from '@/shared/constants';

interface HoverCardProps {
  annotation: Annotation | null;
  triggerRect: DOMRect | null;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}

export function HoverCard({ annotation, triggerRect, onMouseEnter, onMouseLeave }: HoverCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const arrowRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [arrowPosition, setArrowPosition] = useState({ x: 0, y: 0, side: 'bottom' as string });

  const html = useMemo(() => {
    if (!annotation) return '';
    const raw = marked.parse(annotation.content, { async: false }) as string;
    return DOMPurify.sanitize(raw);
  }, [annotation?.content]);

  useEffect(() => {
    if (!annotation || !triggerRect || !cardRef.current) {
      setVisible(false);
      return;
    }

    // Create a virtual element for Floating UI from the DOMRect
    const virtualEl = {
      getBoundingClientRect: () => triggerRect,
    };

    computePosition(virtualEl, cardRef.current, {
      placement: 'top',
      middleware: [
        offset(8),
        flip({ fallbackPlacements: ['bottom', 'top'] }),
        shift({ padding: 12 }),
        arrow({ element: arrowRef.current! }),
      ],
    }).then(({ x, y, placement, middlewareData }) => {
      setPosition({ x, y });

      if (middlewareData.arrow) {
        const side = placement.split('-')[0];
        setArrowPosition({
          x: middlewareData.arrow.x ?? 0,
          y: middlewareData.arrow.y ?? 0,
          side,
        });
      }

      // Trigger visible on next frame for animation
      requestAnimationFrame(() => setVisible(true));
    });
  }, [annotation, triggerRect]);

  if (!annotation) return null;

  const arrowSideMap: Record<string, Record<string, string>> = {
    top: { bottom: '-4px', left: `${arrowPosition.x}px` },
    bottom: { top: '-4px', left: `${arrowPosition.x}px` },
    left: { right: '-4px', top: `${arrowPosition.y}px` },
    right: { left: '-4px', top: `${arrowPosition.y}px` },
  };

  return (
    <div
      ref={cardRef}
      class={`marginalia-card ${visible ? 'visible' : ''}`}
      style={{ left: `${position.x}px`, top: `${position.y}px` }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <div class="marginalia-card-label">Marginalia</div>
      <div
        class="marginalia-card-body"
        dangerouslySetInnerHTML={{ __html: html }}
      />
      <div
        ref={arrowRef}
        class="marginalia-card-arrow"
        style={arrowSideMap[arrowPosition.side] || {}}
      />
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add src/content/card/HoverCard.tsx
git commit -m "Add HoverCard: Floating UI-positioned annotation popover"
```

---

### Task 13: Create FloatingPill.tsx

**Files:**
- Create: `src/content/pill/FloatingPill.tsx`

**Step 1: Write the FloatingPill component**

```tsx
interface FloatingPillProps {
  count: number;
  loading: boolean;
  visible: boolean;
  onToggle: () => void;
}

export function FloatingPill({ count, loading, visible, onToggle }: FloatingPillProps) {
  if (count === 0 && !loading) return null;

  const label = loading
    ? 'Analyzing...'
    : `${count} insight${count !== 1 ? 's' : ''}`;

  const icon = loading ? '\u25CF' : visible ? '\u25C9' : '\u25CB';

  return (
    <div
      class={`marginalia-pill ${loading ? 'loading' : ''} ${!visible && !loading ? 'hidden-state' : ''}`}
      onClick={onToggle}
      title={visible ? 'Hide annotations' : 'Show annotations'}
    >
      <span class="marginalia-pill-icon">{icon}</span>
      <span>{label}</span>
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add src/content/pill/FloatingPill.tsx
git commit -m "Add FloatingPill: annotation count + toggle control"
```

---

### Task 14: Rewrite content-script.ts

**Files:**
- Modify: `src/content/content-script.ts`
- Delete: `src/content/sidebar/Sidebar.tsx`
- Delete: `src/content/sidebar/AnnotationCard.tsx`
- Delete: `src/content/sidebar/ModeSelector.tsx`
- Delete: `src/content/styles/sidebar.css`

**Step 1: Rewrite content-script.ts**

Complete rewrite replacing sidebar with inline annotation system:

```typescript
import { render, h } from 'preact';
import { PORT_NAME } from '@/shared/constants';
import type { Annotation, TokenUsage, PortMessage } from '@/shared/types';
import { highlightManager } from './highlighter/highlight-manager';
import { HoverCard } from './card/HoverCard';
import { FloatingPill } from './pill/FloatingPill';
import { extractPageContent } from './extraction/readability';
import inlineCSS from './styles/inline.css?raw';

const HOST_ID = 'marginalia-host';
const HIGHLIGHT_STYLE_ID = 'marginalia-highlight-styles';

let annotating = false;

// --- State for Preact UI ---
interface UIState {
  annotations: Annotation[];
  loading: boolean;
  highlightsVisible: boolean;
  hoverAnnotation: Annotation | null;
  hoverRect: DOMRect | null;
}

let state: UIState = {
  annotations: [],
  loading: false,
  highlightsVisible: true,
  hoverAnnotation: null,
  hoverRect: null,
};

let renderUI: (() => void) | null = null;
let closeTimer: ReturnType<typeof setTimeout> | null = null;

function setState(partial: Partial<UIState>) {
  Object.assign(state, partial);
  renderUI?.();
}

// --- Inject highlight styles into page <head> ---
function injectHighlightStyles() {
  if (document.getElementById(HIGHLIGHT_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = HIGHLIGHT_STYLE_ID;
  style.textContent = `
    ::highlight(marginalia) {
      background-color: rgba(255, 200, 80, 0.15);
      text-decoration: underline dotted;
      text-decoration-color: rgba(180, 140, 50, 0.5);
    }
  `;
  document.head.appendChild(style);
}

// --- Shadow DOM host for card + pill ---
function injectHost() {
  if (document.getElementById(HOST_ID)) return;

  const host = document.createElement('div');
  host.id = HOST_ID;
  const shadow = host.attachShadow({ mode: 'open' });

  const style = document.createElement('style');
  style.textContent = inlineCSS;
  shadow.appendChild(style);

  const container = document.createElement('div');
  container.id = 'marginalia-root';
  shadow.appendChild(container);

  document.body.appendChild(host);

  renderUI = () => {
    render(
      h('div', null,
        h(HoverCard, {
          annotation: state.hoverAnnotation,
          triggerRect: state.hoverRect,
          onMouseEnter: () => {
            if (closeTimer) {
              clearTimeout(closeTimer);
              closeTimer = null;
            }
          },
          onMouseLeave: () => {
            setState({ hoverAnnotation: null, hoverRect: null });
          },
        }),
        h(FloatingPill, {
          count: state.annotations.length,
          loading: state.loading,
          visible: state.highlightsVisible,
          onToggle: () => {
            const next = !state.highlightsVisible;
            highlightManager.setVisible(next);
            setState({ highlightsVisible: next });
            if (!next) {
              setState({ hoverAnnotation: null, hoverRect: null });
            }
          },
        }),
      ),
      container,
    );
  };
}

// --- Annotation flow ---
function startAnnotating() {
  if (annotating) return;

  const content = extractPageContent();
  if (!content) return;

  annotating = true;
  highlightManager.clear();
  setState({
    annotations: [],
    loading: true,
    highlightsVisible: true,
    hoverAnnotation: null,
    hoverRect: null,
  });

  const port = chrome.runtime.connect({ name: PORT_NAME });

  port.postMessage({
    type: 'START_ANNOTATE',
    payload: {
      url: content.url,
      title: content.title,
      text: content.content,
    },
  } satisfies PortMessage);

  port.onMessage.addListener((msg: PortMessage) => {
    switch (msg.type) {
      case 'ANNOTATION_CHUNK': {
        const annotation = msg.payload.annotation;
        const added = highlightManager.addAnnotation(annotation);
        if (added) {
          setState({
            annotations: [...state.annotations, annotation],
          });
        }
        break;
      }
      case 'STREAM_DONE':
        setState({ loading: false });
        annotating = false;
        port.disconnect();
        break;
      case 'STREAM_ERROR':
        setState({ loading: false });
        annotating = false;
        port.disconnect();
        break;
    }
  });

  port.onDisconnect.addListener(() => {
    setState({ loading: false });
    annotating = false;
  });
}

// --- Message listener (from popup) ---
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'TOGGLE_ANNOTATIONS') {
    if (state.annotations.length === 0 && !annotating) {
      startAnnotating();
      sendResponse({ annotating: true });
    } else {
      const next = !state.highlightsVisible;
      highlightManager.setVisible(next);
      setState({ highlightsVisible: next });
      sendResponse({ visible: next });
    }
  }
  return true;
});

// --- Initialize ---
function init() {
  injectHighlightStyles();
  injectHost();

  highlightManager.init(
    // onHover
    (annotation, rect) => {
      if (closeTimer) {
        clearTimeout(closeTimer);
        closeTimer = null;
      }
      setState({ hoverAnnotation: annotation, hoverRect: rect });
    },
    // onLeave
    () => {
      closeTimer = setTimeout(() => {
        setState({ hoverAnnotation: null, hoverRect: null });
        closeTimer = null;
      }, 200);
    },
  );
}

init();
```

**Step 2: Delete old sidebar files**

```bash
rm src/content/sidebar/Sidebar.tsx src/content/sidebar/AnnotationCard.tsx src/content/sidebar/ModeSelector.tsx src/content/styles/sidebar.css
rmdir src/content/sidebar
```

**Step 3: Commit**

```bash
git add -A
git commit -m "Replace sidebar with inline annotation system

Content script now uses CSS Custom Highlight API for text highlighting,
invisible hit-target overlays for hover detection, and Shadow DOM for
the HoverCard and FloatingPill components."
```

---

### Task 15: Update Popup.tsx

**Files:**
- Modify: `src/popup/Popup.tsx`

**Step 1: Simplify popup**

Remove mode selector, change "Open Sidebar" to "Annotate Page":

```tsx
import { render } from 'preact';
import { useState, useEffect } from 'preact/hooks';

function Popup() {
  const [totalTokens, setTotalTokens] = useState(0);
  const [hasApiKey, setHasApiKey] = useState(false);

  useEffect(() => {
    chrome.storage.local.get(['apiKey', 'totalInputTokens', 'totalOutputTokens'], (result) => {
      setHasApiKey(!!result.apiKey);
      setTotalTokens((result.totalInputTokens || 0) + (result.totalOutputTokens || 0));
    });
  }, []);

  const handleAnnotate = () => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]?.id) {
        chrome.tabs.sendMessage(tabs[0].id, { type: 'TOGGLE_ANNOTATIONS' });
        window.close();
      }
    });
  };

  const openOptions = () => {
    chrome.runtime.openOptionsPage();
  };

  return (
    <div class="popup">
      <h1>Marginalia</h1>

      {!hasApiKey && (
        <div class="popup-warning">
          No API key set.{' '}
          <a href="#" onClick={openOptions}>Configure in settings</a>
        </div>
      )}

      <button class="popup-toggle" onClick={handleAnnotate} disabled={!hasApiKey}>
        Annotate Page
      </button>

      <div class="popup-stats">
        <span>Total tokens used: {totalTokens.toLocaleString()}</span>
      </div>

      <button class="popup-link" onClick={openOptions}>
        Settings
      </button>
    </div>
  );
}

render(<Popup />, document.getElementById('popup-root')!);
```

**Step 2: Commit**

```bash
git add src/popup/Popup.tsx
git commit -m "Simplify popup: single 'Annotate Page' button, no sidebar toggle"
```

---

### Task 16: Update Options.tsx (remove mode references)

**Files:**
- Modify: `src/options/Options.tsx`

**Step 1: Remove mode-related code**

Remove the `AnnotationMode` import and any reference to `DEFAULT_MODES` or `defaultModes` in the profile display. The `ReaderProfile` type no longer has `defaultModes` in `annotationPreferences`, so this should compile cleanly.

The Options.tsx currently doesn't display mode-related profile fields directly (it only shows `expertise` and `interests`), so the changes are minimal — just ensure no type errors from the updated `ReaderProfile` type.

**Step 2: Verify build**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add src/options/Options.tsx
git commit -m "Remove mode references from Options page"
```

---

### Task 17: Update memory-retriever.ts if needed

**Files:**
- Modify: `src/background/memory/memory-retriever.ts` (if it references modes)

**Step 1: Check for mode references**

Read the file and remove any imports or usage of `AnnotationMode`, `DEFAULT_MODES`, `MODE_LABELS` etc.

**Step 2: Commit if changes made**

```bash
git add src/background/memory/memory-retriever.ts
git commit -m "Remove mode references from memory retriever"
```

---

### Task 18: Full build and verify

**Step 1: Type check**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 2: Build**

Run: `npm run build`
Expected: Build succeeds, `dist/` contains `content-script.js`, `service-worker.js`, `popup.js`, `options.js`, `manifest.json`

**Step 3: Fix any issues**

If there are type errors or build failures, fix them iteratively.

**Step 4: Commit any fixes**

```bash
git add -A
git commit -m "Fix build issues from inline annotation migration"
```

---

### Task 19: Verify in browser

**Step 1: Load extension**

- Open `chrome://extensions`
- Click "Load unpacked" → select `dist/`
- Navigate to a news article (e.g., any article page)

**Step 2: Test flow**

1. Click the Marginalia extension icon in toolbar
2. Click "Annotate Page" in popup
3. Verify: floating pill appears with "Analyzing..." state
4. Verify: highlights appear progressively on article text
5. Verify: pill updates to "N insights"
6. Hover over a highlight → verify hover card appears
7. Move mouse away → verify card fades out
8. Click pill → verify highlights toggle off/on

**Step 3: Fix any runtime issues**

Commit any fixes with descriptive messages.
