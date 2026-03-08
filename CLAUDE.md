# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build Commands

- `npm run build` — TypeScript check + Vite production build to `dist/`
- `npm run dev` — Vite dev server with HMR (uses @crxjs/vite-plugin beta)
- `npm run test` — Run tests with Vitest
- `npm run test:coverage` — Run tests with V8 coverage
- No linter configured

Load the extension in Chrome via `chrome://extensions` → Load unpacked → select `dist/`.

## Architecture

Chrome extension (Manifest V3) — AI reading companion that generates contextual inline annotations and a page summary via LLM APIs (Anthropic Claude or OpenAI). Annotations appear as text highlights with hover cards; the summary appears in a floating card above a bottom-right pill.

### Entry Points

| Entry | File | Role |
|---|---|---|
| Service Worker | `src/background/service-worker.ts` | Central message hub, orchestrates LLM + memory |
| Content Script | `src/content/content-script.ts` | Shadow DOM UI injection, highlight management, state coordination |
| Popup | `src/popup/Popup.tsx` | Toggle annotations, token stats |
| Options | `src/options/Options.tsx` | API key, model selection, data management |

### Build System

Vite + a **custom plugin** in `vite.config.ts` (`copyExtensionFiles()`) that builds each entry as a separate IIFE bundle, copies icons/CSS, generates HTML pages, and writes `manifest.json`. The crxjs beta is used only for dev HMR.

### Communication

- **Port-based streaming**: `chrome.runtime.connect(name: 'marginalia-stream')` for annotation chunks and page summary
- **One-shot messages**: `chrome.runtime.sendMessage()` for config, interactions

### Content Script UI (`src/content/`)

All UI lives in a single Shadow DOM host (`#marginalia-host`). Three Preact components rendered together:

- `HoverCard` — appears on highlight hover, positioned via `@floating-ui/dom`
- `FloatingPill` — bottom-right pill showing annotation count/loading state
- `SummaryCard` — floating card above the pill with page summary (skeleton loading → text)

State is managed via a plain `UIState` object + `setState()` pattern (no state library). CSS is imported as `?raw` strings into the Shadow DOM.

### LLM Integration (`src/background/llm/`)

Multi-provider architecture using raw `fetch()` (no SDK — MV3 service workers can't use it). SSE streaming with JSONL output: each line is one `Annotation` object.

- `provider.ts` — `ProviderTransport` interface (`generateText`, `streamText`) abstraction over LLM APIs
- `provider-registry.ts` — registers Anthropic and OpenAI providers with available models
- `providers/anthropic.ts` — Anthropic Messages API transport (requires `anthropic-dangerous-direct-browser-access: true` header)
- `providers/openai.ts` — OpenAI Responses API transport
- `provider-storage.ts` — persists active provider, API keys, base URLs, and model selection in `chrome.storage.local`
- `flows.ts` — high-level LLM service orchestrating `streamAnnotations`, `generatePageSummary`, `updateReaderProfile`, `testConnection`
- `prompt-builder.ts` — assembles system prompts from `src/prompts/*.txt` templates + memory context (`buildAnnotationPrompt`, `buildProfileUpdatePrompt`, `buildSummaryPrompt`)
- `response-parsers.ts` — JSONL annotation parsing and `PageSummary` extraction
- `sse.ts` — generic SSE stream parser shared by both providers

### Session Lifecycle

`START_ANNOTATE` → session starts → memory context assembled → LLM streams annotations + generates summary **in parallel** (`Promise.all`) → annotation chunks posted to port as `ANNOTATION_CHUNK` → summary posted as `PAGE_SUMMARY` → `STREAM_DONE` → tab closes or 30min idle → session ends → profile updated → reading graph entry created.

### Content Extraction (`src/content/extraction/`)

`readability.ts` wraps `@mozilla/readability` to extract article text from the page DOM.

### 3-Layer Memory System (`src/background/memory/`)

1. **Reader Profile** — `chrome.storage.local`; expertise, interests, preferences
2. **Reading Graph** — IndexedDB via Dexie; pages, topics, claims, connections
3. **Session Context** — In-memory `Map<tabId, SessionState>`; discarded on tab close or 30min idle

`memory-retriever.ts` assembles memory context (topic matches + domain history) into the LLM system prompt.

## Key Conventions

- **UI**: Preact with `jsxImportSource: preact` — import from `preact/hooks`, not React. `react`/`react-dom` are aliased to `preact/compat` in `vite.config.ts`. Content script uses `h()` calls directly (not JSX).
- **Styling**: Plain CSS with Slate color scale design tokens, imported as `?raw` strings into Shadow DOM. No Tailwind.
- **Rendering**: Annotation markdown converted via `marked` → sanitized with `DOMPurify` before injection.
- **Prompts**: `.txt` files in `src/prompts/` imported via `?raw` suffix
- **Path alias**: `@/*` maps to `src/*`
- **Types**: All shared interfaces in `src/shared/types.ts`
- **Message protocols**: `RequestMessage` (one-shot), `PortMessage` (streaming) — both defined in `types.ts`
- **Output format**: JSONL (one annotation per line), not JSON arrays
