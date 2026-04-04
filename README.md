# Marginalia

Marginalia is a Chrome extension reading companion that annotates web articles in place, summarizes pages, and remembers what the reader has seen before.

Version: `0.2.0`

## What It Does

- Streams inline annotations directly onto article text
- Shows a floating summary card with page takeaways
- Tracks reading history in a local Active Reading Graph
- Surfaces low-risk cross-article connections from prior reading
- Adapts explanation depth to the reader's inferred expertise
- Supports Anthropic, OpenAI, and OpenRouter

## Development

```bash
npm install
npm run test
npm run build
```

Load the extension from `dist/`:

1. Open `chrome://extensions`
2. Enable Developer mode
3. Click `Load unpacked`
4. Select the repository's `dist/` directory

## Architecture Snapshot

- `src/background/service-worker.ts`
  Handles runtime messaging, session persistence, and deferred claim extraction jobs.
- `src/background/llm/`
  Provider-agnostic LLM flows plus provider-specific transports.
- `src/background/memory/`
  Reader profile, reading graph, connection scoring, and session tracking.
- `src/content/`
  Highlight manager, hover card, floating pill, summary card, and page extraction.
- `src/shared/types.ts`
  Shared data model and wire protocol.

## Active Reading Graph

The reading graph stores:

- page summaries
- key claims
- topic tags
- extracted claim edges
- pending claim-extraction jobs

Claim extraction is deferred after session finalization so the MV3 service worker does not block or lose work. The graph stores full edge types, but the current UI surfaces only `refines` and `same-theme`.

## Testing

The repo uses Vitest with `jsdom`.

- Background/provider tests cover JSONL parsing, provider conformance, and service-worker behavior
- Dexie graph tests use `fake-indexeddb`
- UI tests use `@testing-library/preact`

## Documentation

- [AGENTS.md](./AGENTS.md) — agent-oriented repo guide
- [CLAUDE.md](./CLAUDE.md) — Claude Code guide
- [marginalia-spec.md](./marginalia-spec.md) — current product and technical spec
- `docs/plans/` — historical milestone design notes, not current architecture docs
