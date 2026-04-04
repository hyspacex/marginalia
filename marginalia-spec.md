# Marginalia Product And Technical Spec

## Status

- Product version: `0.2.0`
- Platform: Chrome extension, Manifest V3
- Runtime model providers: Anthropic, OpenAI, OpenRouter
- Current flagship capability: Active Reading Graph v1

## Product Thesis

Marginalia should feel like a well-read companion, not a chatbot sidebar. It should annotate text in place, summarize the page at a glance, remember what the reader has read before, and occasionally surface a connection that changes how the current passage lands.

The key product promise is proactive recall:

- inline annotations for the current sentence
- summary for the current page
- memory-driven connections to prior reading
- deeper or lighter explanations based on inferred expertise

## User-Facing Features

### Inline Annotations

- The extension streams annotations over a runtime port
- The content script highlights matching text with the CSS Custom Highlight API
- Hovering a highlight opens a floating card rendered inside a Shadow DOM host

### Summary Card

- Summary generation runs in parallel with annotation streaming
- The summary card appears above the pill
- The payload includes:
  - summary text
  - primary topic
  - expertise level badge
  - surfaced connection previews

### Active Reading Graph

The local reading graph stores:

- page metadata and summaries
- key claims
- topic tags
- saved annotations
- claim edges between articles
- pending claim-extraction jobs

Claim-edge extraction is deferred and alarm-driven. This avoids doing extra LLM work inline during session finalization and is safer under MV3 worker suspension.

### Staged Connection Rollout

The graph stores all typed edges:

- `supports`
- `contradicts`
- `refines`
- `same-theme`

Current UI and prompt rollout intentionally surfaces only:

- `refines`
- `same-theme`

This keeps the first shipped experience conservative while preserving the richer graph for later releases.

## Architecture

### Entry Points

| Entry | File | Responsibility |
|---|---|---|
| Service worker | `src/background/service-worker.ts` | runtime message hub, session persistence, deferred jobs |
| Content script | `src/content/content-script.ts` | extraction trigger, streaming UI, highlight rendering |
| Popup | `src/popup/Popup.tsx` | built but not wired — no `default_popup` in manifest |
| Options page | `src/options/Options.tsx` | provider config, model catalog, data reset |

### Shared Data Model

Key shared types live in `src/shared/types.ts`.

Important objects:

- `Annotation`
  - regular inline annotation, or `type: 'connection'`
- `PageSummaryPayload`
  - summary text plus optional topic, expertise, and connection previews
- `ReaderProfile`
  - long-lived reader preferences and expertise map
- `ReadingGraphEntry`
  - persisted page record
- `ClaimEdge`
  - typed relation between stored claims
- `PendingClaimExtraction`
  - deferred extraction job record

### Memory Layers

1. Reader profile in `chrome.storage.local`
2. Reading graph in IndexedDB via Dexie
3. Current session state in the service worker

Prompt context is assembled from all three layers:

- profile JSON
- scored reading-history matches from stored `topics` and `keyClaims`
- connection previews from prior claim edges
- session-local interaction context

### Provider Stack

The provider system is layered:

1. `provider-registry.ts`
2. `provider.ts`
3. `providers/anthropic.ts`
4. `providers/openai.ts`
5. `providers/openrouter.ts`
6. `provider-model-catalog.ts`
7. `provider-storage.ts`
8. `flows.ts`

`flows.ts` provides the provider-agnostic operations used by the service worker:

- `streamAnnotations`
- `generatePageSummary`
- `updateReaderProfile`
- `extractClaimEdges`
- `testConnection`
- `listModels`

### UI Model

The content script renders three Preact components inside one Shadow DOM host:

- `HoverCard`
- `FloatingPill`
- `SummaryCard`

Highlights are managed outside the Shadow DOM with two named highlight channels:

- `marginalia`
- `marginalia-connection`

## Runtime Flows

### Annotation And Summary Flow

1. User triggers annotation from the toolbar icon (`chrome.action.onClicked`)
2. Content script extracts readable article text
3. Service worker assembles memory context
4. Annotation streaming and summary generation run in parallel
5. Content script updates highlights, pill state, and summary card as messages arrive

### Session Finalization Flow

1. Session ends on tab close, URL change, or idle timeout
2. Profile update runs
3. Page summary is persisted into the reading graph
4. A pending claim-extraction job is enqueued if the topic cluster is dense enough

### Deferred Claim Extraction Flow

1. A recurring alarm wakes the service worker
2. Pending jobs are loaded in small batches
3. The worker compares new-page claims to prior related claims
4. Parsed claim edges are stored in IndexedDB
5. Failures retry up to a bounded limit, then drop the job

## Testing And Verification

Current test coverage includes:

- provider transport conformance
- JSONL parsing for annotations and claim edges
- prompt builder behavior
- service-worker persistence and retry behavior
- Dexie-backed reading-graph behavior with `fake-indexeddb`
- content UI rendering for connection cards, summary metadata, and pill badges
- options page provider and data-management flows

Verification commands:

```bash
npm run test
npm run build
```

## Historical Notes

Older documents in `docs/plans/` describe the early inline-annotations and first summary-card milestones. They are useful background, but they are not the current source of truth for architecture. The current canonical docs are:

- `README.md`
- `AGENTS.md`
- `CLAUDE.md`
- this file
