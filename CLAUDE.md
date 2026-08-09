# CLAUDE.md

This file provides guidance to Claude Code when working in this repository.

## Build Commands

- `npm run build` — TypeScript check + Vite production build to `dist/`
- `npm run dev` — Vite dev server with HMR
- `npm run test` — Run all tests with Vitest
- `npm run test:coverage` — Run the coverage-targeted Vitest suite (branch threshold currently fails at baseline; `npm run test` is the green gate)
- No linter is configured

Load the extension in Chrome via `chrome://extensions` → Load unpacked → select `dist/`.

## Current State

Marginalia `0.2.0` is an MV3 Chrome extension that combines:

- streamed inline annotations (toolbar click)
- structured, content-type-adaptive page summaries streamed section-by-section as JSONL
- auto-summarize on a user-managed site allowlist (summary-only sessions, optional cheaper model override)
- multi-provider LLM support (Anthropic, OpenAI, OpenRouter, and a Local OpenAI-compatible chat-completions provider)
- a reading graph in Dexie used for "net-new to you" summary context

Note: an earlier "Active Reading Graph v1" connections system (typed claim edges, connection scoring, deferred extraction) was designed but never committed — `notes/v0.2.0-connections-roadmap.md` preserves that design. Do not assume claim edges exist in code.

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
- `src/background/memory/memory-retriever.test.ts`
- `src/background/settings/auto-summarize-storage.test.ts`
- `src/shared/classify-content.test.ts`
- `src/shared/site-match.test.ts`
- `src/content/auto/auto-trigger.test.ts`
- `src/options/Options.test.tsx`

## Architecture

### Entry Points

| Entry | File | Role |
|---|---|---|
| Service Worker | `src/background/service-worker.ts` | Session orchestration, LLM calls, summary replay, auto-site settings |
| Content Script | `src/content/content-script.ts` | Highlight rendering, hover/summary UI, streaming state, auto-trigger |
| Popup | `src/popup/Popup.tsx` | Built but not wired — no `default_popup` in manifest; toolbar click uses `chrome.action.onClicked` directly |
| Options | `src/options/Options.tsx` | Provider setup, model selection, auto-summarize settings, storage reset |

### Build System

Vite uses a custom `copyExtensionFiles()` plugin in `vite.config.ts` to:

- build each entry as an IIFE
- copy icons and CSS
- generate `popup.html` and `options.html`
- emit `dist/manifest.json` (version read from `package.json`)

The source `manifest.json` is a development template with `.ts` source paths. The actual manifest Chrome loads is generated into `dist/` by the Vite plugin — any manifest change must be made in BOTH `manifest.json` and the generator in `vite.config.ts`.

### Provider System

Four providers are supported: Anthropic, OpenAI, OpenRouter (all via Responses/Messages APIs), and Local (OpenAI-compatible `/chat/completions` for self-hosted servers; its origin needs a `host_permissions` entry in both manifests to bypass CORS).

1. `provider-registry.ts` for descriptors and defaults
2. `provider.ts` for shared transport/error types
3. `providers/*.ts` for provider-specific HTTP + SSE logic
4. `provider-model-catalog.ts` for persisted model catalog
5. `provider-storage.ts` for provider config storage (`resolveProviderConfigForModel` supports the auto-summarize model override)
6. `flows.ts` for provider-agnostic orchestration: `streamAnnotations`, `streamPageSummary`, `updateReaderProfile`, `testConnection`, `listModels`

### Summary Pipeline

- Content script collects `PageMetadata` (`src/content/extraction/page-metadata.ts`: JSON-LD `@type`s, `og:type`, host/path, byline/siteName from Readability).
- `src/shared/classify-content.ts` deterministically classifies into `ContentType` (`news-report | opinion-analysis | technical-blog | research-paper | other`); `null` means the LLM decides in-prompt.
- Prompts live in `src/prompts/summary/` — `base.txt` (JSONL contract) + one template per content type + `classify-fallback.txt`. Composed by `buildSummaryPrompt` with memory context injected.
- The model emits JSONL lines: `{"kind":"meta"}`, then `{"kind":"section"}` per section, then a trailing `{"kind":"graph","keyClaims":[],"topics":[]}` line. Parsed by `createSummaryStreamParser` in `response-parsers.ts`.
- Port protocol: `SUMMARY_META` → `SUMMARY_SECTION`* → `SUMMARY_DONE` (or `SUMMARY_ERROR`), independent of the annotation stream.

### Auto-Summarize

- Settings in `chrome.storage.local` under `autoSummarizeSettings` (`src/background/settings/auto-summarize-storage.ts`): `enabled`, `sites` (normalized hostnames), `autoModelId`.
- Site matching in `src/shared/site-match.ts` (subdomain suffix match; www/m/amp stripped at add-time; no PSL reduction).
- `src/content/auto/auto-trigger.ts` self-gates in the content script: allowlist match → per-URL dedup → `isProbablyReaderable` (1.5s debounce, one 2s retry) → `startSession('summary-only')`.
- SPA navigation: the SW forwards `tabs.onUpdated` URL changes as `PAGE_NAVIGATED`; the content script also listens to `popstate`/`visibilitychange`.
- Summary-only sessions skip annotations, may use the `autoModelId` override, and persist to the reading graph. A later toolbar click replays the stored summary instead of regenerating it.
- Quick-add: `ADD_AUTO_SITE` runtime message from the SummaryCard footer button.

### Memory System

Three layers are active:

1. Reader profile in `chrome.storage.local` (skipped/unchanged for interaction-less sessions)
2. Reading graph in Dexie — single `pages` table; entries store flattened `summary` plus optional `sections`/`contentType`
3. In-memory session context in the service worker (`session-tracker.ts`)

`memory-retriever.ts` assembles prompt context from profile, history (topic retrieval matches page text against the stored tag vocabulary via `selectRelevantStoredTopics`), and session state. Memory is injected into BOTH annotation and summary prompts; the summary's "net-new" section relies on it. `usage-tracker.ts` tracks token usage (annotation + summary streams both recorded).

### UI

The content script injects a Shadow DOM host containing:

- `HoverCard`
- `FloatingPill` (also surfaces summary-only auto runs)
- `SummaryCard` (content-type badge, per-section markdown blocks, error state, quick-add footer)

Highlighting is separate from the Shadow DOM and uses `CSS.highlights.set('marginalia', ...)`.

### Session Lifecycle

`START_ANNOTATE {url,title,text,metadata,mode}`
→ resolve config (auto model override for `summary-only`)
→ gather prompt memory
→ stream annotations (full mode only) and stream structured summary in parallel (or replay a stored same-URL summary)
→ `SUMMARY_META`/`SUMMARY_SECTION`/`SUMMARY_DONE` + `STREAM_DONE`
→ persist session on idle/tab close/url change (requires annotations OR a summary; no LLM calls at persist time)

## Conventions

- Use Preact patterns, not React imports
- Shared protocol and domain types live in `src/shared/types.ts`
- Prompt templates live in `src/prompts/**/*.txt`, loaded via Vite `?raw` imports
- Markdown rendering goes through `marked` and `DOMPurify`
- JSONL is the canonical wire format for annotations and structured summaries
