# AGENTS.md

This file provides guidance to coding agents working in this repository.

## Build Commands

- `npm run build` — TypeScript check + Vite production build to `dist/`
- `npm run dev` — Vite dev server with HMR
- `npm run test` — Run the full Vitest suite
- `npm run test:coverage` — Run tests with V8 coverage output
- No linter is configured

Load the extension in Chrome via `chrome://extensions` → Load unpacked → select `dist/`.

## Current Product

Marginalia `0.2.0` is a Chrome extension reading companion that:

- Streams inline annotations onto article text
- Generates a floating page summary in parallel
- Uses a three-layer memory system to adapt depth to the reader
- Surfaces cross-article connections from an Active Reading Graph

Connection annotations are staged in v1: the graph stores all typed edges (`supports`, `contradicts`, `refines`, `same-theme`), but the UI and prompts currently surface only `refines` and `same-theme`.

## Architecture

### Entry Points

| Entry | File | Role |
|---|---|---|
| Service Worker | `src/background/service-worker.ts` | Message hub, session finalization, deferred claim extraction jobs |
| Content Script | `src/content/content-script.ts` | Shadow DOM UI injection, highlight management, streaming UI state |
| Popup | `src/popup/Popup.tsx` | Built but not wired — no `default_popup` in manifest; toolbar click uses `chrome.action.onClicked` directly |
| Options | `src/options/Options.tsx` | Provider config, model selection, data clearing |

### Content Script UI

All UI lives in a single Shadow DOM host (`#marginalia-host`) with three Preact components:

- `HoverCard` — regular and connection annotation variants
- `FloatingPill` — insight count, loading state, connection badge, visibility toggle
- `SummaryCard` — summary text, expertise badge, surfaced connections

Highlighting uses the CSS Custom Highlight API with dual channels:

- `marginalia` for regular annotations
- `marginalia-connection` for cross-article connection annotations

### LLM Provider System

The extension supports three providers:

- Anthropic
- OpenAI
- OpenRouter

The provider stack is layered:

1. `provider-registry.ts` defines descriptors and default config behavior
2. `provider.ts` defines the transport interface and shared `ProviderError`
3. `providers/*.ts` implement provider-specific HTTP and SSE handling
4. `provider-model-catalog.ts` persists available models per provider
5. `provider-storage.ts` manages provider config in `chrome.storage.local`
6. `flows.ts` provides provider-agnostic operations:
   - `streamAnnotations`
   - `generatePageSummary`
   - `updateReaderProfile`
   - `extractClaimEdges`
   - `testConnection`
   - `listModels`

### Memory System

The extension uses three layers of memory:

1. `ReaderProfile` in `chrome.storage.local`
2. `ReadingGraph` in IndexedDB via Dexie
3. In-memory `SessionState` in the service worker

The reading graph now contains:

- `pages`
- `claimEdges`
- `pendingExtractions`

Supporting modules:

- `memory-retriever.ts` assembles prompt context from profile, history, and connections
- `connection-scorer.ts` scores claim edges for relevance to the current page
- `session-tracker.ts` holds in-memory session state in the service worker
- `usage-tracker.ts` tracks token usage across sessions

### Session Lifecycle

`START_ANNOTATE`
→ session starts
→ memory context assembled from local profile + graph
→ annotations stream and page summary run in parallel
→ `ANNOTATION_CHUNK` and enriched `PAGE_SUMMARY` messages go to the content script
→ tab closes or idles out
→ session is persisted to the reading graph
→ a deferred claim-extraction job is enqueued
→ alarm-driven processing turns stored page claims into graph edges

Claim extraction is intentionally deferred instead of running inline during session finalization so MV3 worker shutdowns do not drop user-visible work.

## Testing

Vitest runs in a `jsdom` environment. Important patterns:

- Chrome APIs must be mocked with `vi.stubGlobal('chrome', ...)`
- UI tests use `@testing-library/preact`
- Dexie-backed graph tests use `fake-indexeddb`
- Provider conformance tests verify Anthropic, OpenAI, and OpenRouter against the same request/response expectations

Test suites:

- `src/background/llm/provider-conformance.test.ts`
- `src/background/llm/provider-storage.test.ts`
- `src/background/llm/provider-model-catalog.test.ts`
- `src/background/llm/providers/provider-edge-cases.test.ts`
- `src/background/llm/flows.test.ts`
- `src/background/llm/response-parsers.test.ts`
- `src/background/llm/prompt-builder.test.ts`
- `src/background/service-worker.test.ts`
- `src/background/usage-tracker.test.ts`
- `src/background/memory/reading-graph.test.ts`
- `src/background/memory/memory-retriever.test.ts`
- `src/background/memory/connection-scorer.test.ts`
- `src/content/content-ui.test.tsx`
- `src/options/Options.test.tsx`

## Key Conventions

- Preact only: import hooks from `preact/hooks`
- `react` and `react-dom` are aliased to `preact/compat`
- Styling is plain CSS imported as `?raw` into the Shadow DOM
- Shared types and wire protocols live in `src/shared/types.ts`
- Prompt templates live in `src/prompts/*.txt`
- Annotation and claim-edge streaming/parsing uses JSONL, not arrays
