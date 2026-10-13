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
- multi-provider LLM support: Anthropic, OpenAI, OpenRouter (all with API keys), and a Local OpenAI-compatible chat-completions provider
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

Four providers are supported:

- `anthropic` — Messages API with an API key, called with `fetch` from the service worker. Current models (Opus/Sonnet 5.5, Fable 5.1) get `fallbacks: "default"` + `anthropic-beta: server-side-fallback-2026-07-01` on `api.anthropic.com` only (not Haiku 5.5, which has no fallback); `stop_reason: "refusal"` raises a `ProviderError`. Thinking is on by default for current Claude models and counts against `max_tokens`, hence the 16K output caps in `flows.ts`.
- `openai`, `openrouter` — Responses APIs with API keys.
- `local` — OpenAI-compatible `/chat/completions` (CLIProxyAPI, llama.cpp, vLLM, ...). Generic in source (`http://localhost:8317/v1`, placeholder model). A personal build sets its name, server address and model list in `config/local-provider.json` (gitignored; template in `config/local-provider.example.json`), which `vite.config.ts` injects as `__MARGINALIA_LOCAL_PROVIDER__` and adds to `host_permissions`. "Refresh models" reads the live list and drops image/video models.

Plain-HTTP servers need `host_permissions` to bypass CORS: the generated manifest always has localhost plus the configured server's origin. Never commit personal server addresses, model lists, or keys — the repo is public; they belong in the gitignored config file.

1. `provider-registry.ts` for descriptors and defaults
2. `provider.ts` for shared transport/error types
3. `providers/*.ts` for provider-specific HTTP + SSE logic
4. `provider-model-catalog.ts` for persisted model catalog
5. `provider-storage.ts` for provider config storage (`resolveProviderConfigForModel` supports the auto-summarize model override)
6. `flows.ts` for provider-agnostic orchestration: `streamAnnotations`, `streamPageSummary`, `updateReaderProfile`, `testConnection`, `listModels`

### Summary Pipeline

- Content script collects `PageMetadata` (`src/content/extraction/page-metadata.ts`: JSON-LD `@type`s, `og:type`, host/path, byline/siteName from Readability).
- `src/shared/classify-content.ts` deterministically classifies into `ContentType` (`news-report | opinion-analysis | technical-blog | research-paper | discussion-thread | reference-docs | other`); `null` means the LLM decides in-prompt.
- Prompts live in `src/prompts/summary/` — `base.txt` (JSONL contract) + one template per content type + `classify-fallback.txt`. Composed by `buildSummaryPrompt` with memory context injected. The `other` template is dynamic: instead of a fixed section list, the model designs 3-5 page-appropriate sections (always including `net-new`) — the JSONL parser accepts arbitrary section ids/headings, so no parser changes are needed for it.
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
- `SummaryCard` (content-type badge + type-colored header mark and heading ticks, streaming status line, per-section markdown blocks, error state, quick-add footer, A−/A+ font-size control persisted as `uiFontScale` in `chrome.storage.local` and applied as a `--m-scale` CSS var on the shadow host)

Visual design: warm paper/ink palette with a vermilion accent. Shared palette and motion tokens live in `src/shared/styles/tokens.css` (`:root, :host`), prepended to the shadow-DOM styles by the content script and to `options.css`/`popup.css` by the Vite copy step — edit tokens there, not per page. Motion follows transitions.dev patterns (tooltip, panel reveal, toast, texts reveal, text swap, shimmer, success check, error shake); `src/content/render/use-presence.ts` keeps cards mounted for their exit animation. Icon master SVGs are in `src/assets/icons/`.

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
