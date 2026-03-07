# Summary Card Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a floating summary card that appears above the pill, showing a one-paragraph page summary generated in parallel with annotations.

**Architecture:** When the user clicks the pill, the content script sends `START_ANNOTATE` over the port as before. The service worker fires both the annotation stream and a summary generation call in parallel. The summary result comes back as a new `PAGE_SUMMARY` port message. A new `SummaryCard` Preact component renders above the pill, dismissed by click-outside or close button.

**Tech Stack:** Preact, Shadow DOM, existing Anthropic API client, existing Readability extraction.

---

### Task 1: Add `PAGE_SUMMARY` port message type

**Files:**
- Modify: `src/shared/types.ts:115-119`

**Step 1: Add the new message variant to `PortMessage`**

In `src/shared/types.ts`, add `PAGE_SUMMARY` to the `PortMessage` union type:

```ts
export type PortMessage =
  | { type: 'START_ANNOTATE'; payload: { url: string; title: string; text: string } }
  | { type: 'ANNOTATION_CHUNK'; payload: { annotation: Annotation } }
  | { type: 'PAGE_SUMMARY'; payload: { summary: string } }
  | { type: 'STREAM_DONE'; payload: { usage: TokenUsage } }
  | { type: 'STREAM_ERROR'; payload: { message: string; code: string } };
```

**Step 2: Build to verify no type errors**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add src/shared/types.ts
git commit -m "feat: add PAGE_SUMMARY port message type"
```

---

### Task 2: Fire summary generation in parallel from service worker

**Files:**
- Modify: `src/background/service-worker.ts:70-125`

**Step 1: Add parallel summary call in the port handler**

In `src/background/service-worker.ts`, inside the `START_ANNOTATE` handler (after line 100), fire `generatePageSummary` in parallel with `streamAnnotations`. Both run concurrently — the summary result is sent as a `PAGE_SUMMARY` message on the port.

Replace the existing try block (lines 76-124) with:

```ts
try {
  const config = await getProviderConfig();

  if (!config.apiKey) {
    port.postMessage({
      type: 'STREAM_ERROR',
      payload: { message: 'No API key configured. Set your Anthropic API key in the extension options.', code: 'NO_API_KEY' },
    });
    return;
  }

  // Track session
  const tabId = port.sender?.tab?.id;
  if (tabId) {
    sessionTracker.startSession(tabId, url, title);
  }

  // Get memory context
  const memoryContext = await getMemoryContext(url, title, text, tabId);

  const request: AnnotationRequest = {
    pageContent: text,
    memoryContext,
    url,
    title,
  };

  // Fire annotations and summary in parallel
  const annotationPromise = anthropicProvider.streamAnnotations(
    request,
    config,
    (annotation) => {
      if (tabId) {
        sessionTracker.addAnnotation(tabId, annotation);
      }
      port.postMessage({ type: 'ANNOTATION_CHUNK', payload: { annotation } });
    },
  );

  const summaryPromise = anthropicProvider.generatePageSummary(text, title, config)
    .then((result) => {
      port.postMessage({ type: 'PAGE_SUMMARY', payload: { summary: result.summary } });
    })
    .catch((err) => {
      console.error('Marginalia: Summary generation failed:', err);
    });

  const [{ usage }] = await Promise.all([annotationPromise, summaryPromise]);

  // Store usage
  await usageTracker.recordUsage(usage.inputTokens, usage.outputTokens);

  port.postMessage({ type: 'STREAM_DONE', payload: { usage } });
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  port.postMessage({
    type: 'STREAM_ERROR',
    payload: { message, code: 'STREAM_FAILED' },
  });
}
```

**Step 2: Build to verify no type errors**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add src/background/service-worker.ts
git commit -m "feat: fire page summary in parallel with annotations"
```

---

### Task 3: Create `SummaryCard` component

**Files:**
- Create: `src/content/summary/SummaryCard.tsx`

**Step 1: Create the component**

The card floats above the pill (fixed, bottom-right). Shows a loading skeleton while waiting, then the summary text. Has a close button (x). Accepts `onClose` callback.

```tsx
interface SummaryCardProps {
  summary: string | null;
  loading: boolean;
  onClose: () => void;
}

export function SummaryCard({ summary, loading, onClose }: SummaryCardProps) {
  if (!loading && !summary) return null;

  return (
    <div class="marginalia-summary">
      <button
        class="marginalia-summary-close"
        onClick={onClose}
        title="Close summary"
      >
        ×
      </button>
      <div class="marginalia-summary-label">Summary</div>
      {loading && !summary ? (
        <div class="marginalia-summary-skeleton">
          <div class="marginalia-skeleton-line" />
          <div class="marginalia-skeleton-line" />
          <div class="marginalia-skeleton-line short" />
        </div>
      ) : (
        <p class="marginalia-summary-text">{summary}</p>
      )}
    </div>
  );
}
```

**Step 2: Build to verify**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add src/content/summary/SummaryCard.tsx
git commit -m "feat: add SummaryCard component"
```

---

### Task 4: Add summary card styles

**Files:**
- Modify: `src/content/styles/inline.css`

**Step 1: Add styles at the end of `inline.css`**

```css
/* Summary Card */
.marginalia-summary {
  position: fixed;
  bottom: 64px;
  right: 24px;
  z-index: 2147483647;
  max-width: 360px;
  padding: 14px 18px;
  padding-right: 32px;
  background: #fff;
  border-radius: 10px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.10), 0 1px 3px rgba(0, 0, 0, 0.06);
  font-family: system-ui, -apple-system, 'Segoe UI', sans-serif;
  font-size: 13px;
  line-height: 1.6;
  color: #334155;
  animation: marginalia-summary-in 200ms ease-out;
  box-sizing: border-box;
}

.marginalia-summary *,
.marginalia-summary *::before,
.marginalia-summary *::after {
  box-sizing: border-box;
}

@keyframes marginalia-summary-in {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.marginalia-summary-close {
  position: absolute;
  top: 10px;
  right: 10px;
  width: 20px;
  height: 20px;
  border: none;
  background: none;
  color: #94a3b8;
  font-size: 16px;
  line-height: 1;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  padding: 0;
}

.marginalia-summary-close:hover {
  color: #475569;
  background: #f1f5f9;
}

.marginalia-summary-label {
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: #94a3b8;
  margin-bottom: 8px;
}

.marginalia-summary-text {
  margin: 0;
}

/* Skeleton loading */
.marginalia-summary-skeleton {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.marginalia-skeleton-line {
  height: 12px;
  background: linear-gradient(90deg, #f1f5f9 25%, #e2e8f0 50%, #f1f5f9 75%);
  background-size: 200% 100%;
  border-radius: 4px;
  animation: marginalia-shimmer 1.5s ease-in-out infinite;
}

.marginalia-skeleton-line.short {
  width: 60%;
}

@keyframes marginalia-shimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}
```

**Step 2: Build to verify**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add src/content/styles/inline.css
git commit -m "feat: add summary card styles with skeleton loading"
```

---

### Task 5: Wire up summary state and rendering in content script

**Files:**
- Modify: `src/content/content-script.ts`

**Step 1: Add summary state fields to `UIState`**

Add to the `UIState` interface (line 16):
```ts
summaryText: string | null;
summaryLoading: boolean;
```

Add to the initial `state` object (line 24):
```ts
summaryText: null,
summaryLoading: false,
```

**Step 2: Import `SummaryCard`**

Add import at the top alongside existing imports:
```ts
import { SummaryCard } from './summary/SummaryCard';
```

**Step 3: Render `SummaryCard` in `injectHost`**

In the `renderUI` function (line 73), add `SummaryCard` to the render tree after `FloatingPill`:

```ts
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
      h(SummaryCard, {
        summary: state.summaryText,
        loading: state.summaryLoading,
        onClose: () => {
          setState({ summaryText: null, summaryLoading: false });
        },
      }),
    ),
    container,
  );
};
```

**Step 4: Set summary loading state in `startAnnotating`**

In the `setState` call inside `startAnnotating()` (line 117), add:
```ts
summaryText: null,
summaryLoading: true,
```

**Step 5: Handle `PAGE_SUMMARY` in port message listener**

In the `port.onMessage.addListener` callback (line 136), add a case:
```ts
case 'PAGE_SUMMARY':
  setState({ summaryText: msg.payload.summary, summaryLoading: false });
  break;
```

**Step 6: Stop summary loading on errors/disconnect**

In the `STREAM_ERROR` case and `port.onDisconnect` handler, add `summaryLoading: false` to the `setState` calls (but don't clear `summaryText` — if the summary arrived before the error, keep it visible).

**Step 7: Add click-outside dismiss**

Add a click listener after the `renderUI` assignment inside `injectHost()`. This listens on `document` and closes the summary if the click is outside the shadow host:

```ts
document.addEventListener('click', (e) => {
  if (!state.summaryText) return;
  const host = document.getElementById(HOST_ID);
  if (host && !host.contains(e.target as Node)) {
    setState({ summaryText: null, summaryLoading: false });
  }
});
```

**Step 8: Build to verify**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 9: Commit**

```bash
git add src/content/content-script.ts
git commit -m "feat: wire summary card into content script with click-outside dismiss"
```

---

### Task 6: Manual testing

**Step 1: Build the extension**

Run: `npm run build`
Expected: Successful build in `dist/`

**Step 2: Load in Chrome**

- Go to `chrome://extensions`
- Click "Load unpacked" (or reload if already loaded) → select `dist/`
- Navigate to an article page (e.g., a blog post or news article)

**Step 3: Test the flow**

1. Click the extension popup → click Annotate
2. Verify the floating pill appears with "Analyzing..."
3. Verify a summary card appears above the pill with skeleton loading
4. Verify skeleton is replaced by summary text once it arrives
5. Verify annotations continue streaming as highlights
6. Click the × button on the summary card → card dismisses
7. Click outside the card → card dismisses (trigger again to test)

**Step 4: Test edge cases**

- Page with no extractable content (e.g., a blank page) — no card should appear
- Very long article — summary should still be one paragraph
- No API key configured — error message, no stuck loading state
