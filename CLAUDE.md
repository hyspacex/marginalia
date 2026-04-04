# CLAUDE.md

This file provides guidance to Claude Code when working in this repository.

## Build Commands

- `npm run build` — TypeScript check + Vite production build to `dist/`
- `npm run dev` — Vite dev server with HMR
- `npm run test` — Run all tests with Vitest
- `npm run test:coverage` — Run the coverage-targeted Vitest suite
- No linter is configured

Load the extension in Chrome via `chrome://extensions` → Load unpacked → select `dist/`.

## Current State

Marginalia `0.2.0` is an MV3 Chrome extension that combines:

- streamed inline annotations
- a floating summary card
- multi-provider LLM support
- an Active Reading Graph for cross-article memory
- expertise-adaptive prompting

The current connection rollout is intentionally conservative: all typed claim edges are stored, but only `refines` and `same-theme` edges are surfaced in prompts and UI.

## Testing

Vitest runs in `jsdom` with globals enabled.

- Config lives in `vitest.config.ts`
- Test-specific TS config lives in `tsconfig.test.json`
- Coverage is currently scoped to `src/background/llm/**/*.ts`
- Chrome APIs should be mocked with `vi.stubGlobal('chrome', ...)`
- Dexie graph tests use `fake-indexeddb`
- UI tests use `@testing-library/preact`

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

## Architecture

### Entry Points

| Entry | File | Role |
|---|---|---|
| Service Worker | `src/background/service-worker.ts` | Session orchestration, LLM calls, deferred claim extraction |
| Content Script | `src/content/content-script.ts` | Highlight rendering, hover/summary UI, streaming state |
| Popup | `src/popup/Popup.tsx` | Built but not wired — no `default_popup` in manifest; toolbar click uses `chrome.action.onClicked` directly |
| Options | `src/options/Options.tsx` | Provider setup, model selection, storage reset |

### Build System

Vite uses a custom `copyExtensionFiles()` plugin in `vite.config.ts` to:

- build each entry as an IIFE
- copy icons and CSS
- generate `popup.html` and `options.html`
- emit `dist/manifest.json`

The source `manifest.json` is a development template with `.ts` source paths. The actual manifest Chrome loads is generated into `dist/` by the Vite plugin with resolved `.js` paths and without `"type": "module"`.

### Provider System

Three providers are supported:

- Anthropic
- OpenAI
- OpenRouter

The implementation is split into:

1. `provider-registry.ts` for descriptors and defaults
2. `provider.ts` for shared transport/error types
3. `providers/*.ts` for provider-specific HTTP + SSE logic
4. `provider-model-catalog.ts` for persisted model catalog
5. `provider-storage.ts` for provider config storage
6. `flows.ts` for provider-agnostic orchestration

`flows.ts` now owns claim extraction in addition to streaming annotations, summary generation, profile updates, test-connection checks, and model listing.

### Memory System

Three layers are active:

1. Reader profile in `chrome.storage.local`
2. Reading graph in Dexie (`pages`, `claimEdges`, `pendingExtractions`)
3. In-memory session context in the service worker

Supporting modules:

- `memory-retriever.ts` assembles prompt context from profile, history, and connections
- `connection-scorer.ts` scores claim edges for relevance to the current page
- `session-tracker.ts` holds in-memory session state in the service worker
- `usage-tracker.ts` tracks token usage across sessions

### UI

The content script injects a Shadow DOM host containing:

- `HoverCard`
- `FloatingPill`
- `SummaryCard`

Highlighting is separate from the Shadow DOM and uses:

- `CSS.highlights.set('marginalia', ...)`
- `CSS.highlights.set('marginalia-connection', ...)`

Connection annotations are visually distinct and summary content includes surfaced connection previews plus an expertise badge.

### Session Lifecycle

`START_ANNOTATE`
→ gather prompt memory
→ stream annotations and generate summary in parallel
→ stream enriched `PAGE_SUMMARY`
→ persist session on idle/tab close
→ enqueue deferred claim extraction
→ process extraction jobs on alarms with retries

## Conventions

- Use Preact patterns, not React imports
- Shared protocol and domain types live in `src/shared/types.ts`
- Prompt templates live in `src/prompts/*.txt`
- Markdown rendering goes through `marked` and `DOMPurify`
- JSONL is the canonical wire format for annotations and claim-edge extraction
