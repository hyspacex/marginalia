# Marginalia — Product & Technical Spec

## Overview

**Marginalia** is a Chrome extension that acts as an AI-powered reading companion. It extracts content from any web page and generates layered, contextual annotations — literary analysis, historical context, counterarguments, vocabulary — displayed in a sidebar. A persistent memory system learns the reader's interests, knowledge level, and reading history over time, delivering increasingly personalized annotations.

---

## Core Concepts

### The Reading Companion Mental Model

Marginalia is not a summarizer. It's the well-read friend sitting next to you who notices things you might miss: rhetorical moves, historical echoes, logical gaps, unfamiliar references. The memory system means this companion *knows you* — it won't explain what you already know, and it'll draw connections to things you've read before.

### Annotation Modes

Each mode represents a different "lens" for reading. Users can activate one or more simultaneously.

| Mode | Description | Example Output |
|------|-------------|----------------|
| **Close Reading** | Rhetorical devices, argument structure, prose style | "Notice the anaphora here — the repetition of 'We will' mirrors Churchill's wartime speeches, likely intentional given the author's thesis." |
| **Context** | Historical, cultural, and biographical background | "This was written 3 days after the SVB collapse, which explains the urgency in the author's tone about regulatory oversight." |
| **Devil's Advocate** | Challenges, counterarguments, logical weaknesses | "The author assumes correlation implies causation in paragraph 3. The cited study actually controlled for income, not education level." |
| **Vocabulary** | Definitions, etymology, domain-specific jargon | "'Hysteresis' here is used in the economic sense — the idea that temporary shocks have permanent effects — borrowed from physics." |
| **Connections** | Cross-references to the user's reading history | "This contradicts the McKinsey report you read last Tuesday, which argued the opposite about remote work productivity." |

---

## Memory System

### Architecture

The memory system has three layers, inspired by how a knowledgeable reading partner would naturally build context about you over time.

```
┌─────────────────────────────────────────────┐
│              MEMORY LAYERS                  │
├─────────────────────────────────────────────┤
│                                             │
│  Layer 1: Reader Profile (long-term)        │
│  ─────────────────────────────────          │
│  Who you are as a reader. Updated slowly.   │
│  • Expertise areas & knowledge level        │
│  • Interests and recurring themes           │
│  • Vocabulary familiarity                   │
│  • Preferred annotation depth               │
│  • Reading goals (if stated)                │
│                                             │
│  Layer 2: Reading Graph (medium-term)       │
│  ─────────────────────────────────          │
│  What you've read and what you took away.   │
│  • Page summaries + key claims              │
│  • Topics encountered (tagged)              │
│  • User highlights & saved annotations      │
│  • Cross-page theme clusters                │
│                                             │
│  Layer 3: Session Context (short-term)      │
│  ─────────────────────────────────          │
│  What you're doing right now.               │
│  • Current page content                     │
│  • Active annotation mode(s)                │
│  • Recent interactions this session         │
│  • Scroll position / focus area             │
│                                             │
└─────────────────────────────────────────────┘
```

### Layer 1: Reader Profile

Stored as a structured JSON object in `chrome.storage.local`. Updated after each reading session via an LLM summarization pass.

```json
{
  "profile": {
    "expertise": {
      "machine_learning": "advanced",
      "constitutional_law": "beginner",
      "literary_criticism": "intermediate",
      "economics": "intermediate"
    },
    "interests": ["AI governance", "urban design", "migration patterns", "Dostoevsky"],
    "vocabulary_known": ["heteroscedasticity", "transformer architecture", "hegemony"],
    "annotation_preferences": {
      "default_modes": ["context", "connections"],
      "depth": "detailed",
      "tone": "collegial"
    },
    "reading_goals": ["Prepare for EB-1 application research", "Understand housing policy"]
  },
  "updated_at": "2026-02-22T10:00:00Z"
}
```

**Update strategy:** After a session ends (tab closed or 30 min idle), a background job diffs the session against the current profile and proposes updates. This avoids excessive writes and keeps the profile stable.

### Layer 2: Reading Graph

Stored in IndexedDB as structured records. Each entry represents a page the user has read with Marginalia active.

```json
{
  "id": "uuid",
  "url": "https://example.com/article",
  "title": "The Case Against Remote Work",
  "domain": "example.com",
  "read_at": "2026-02-20T14:30:00Z",
  "duration_seconds": 420,
  "summary": "Argues that remote work reduces serendipitous innovation. Cites 3 studies...",
  "key_claims": [
    "Remote workers produce 13% fewer patents",
    "Proximity increases weak-tie network effects"
  ],
  "topics": ["remote-work", "innovation", "organizational-design"],
  "user_highlights": ["The paragraph about Bell Labs corridor design"],
  "saved_annotations": [
    {
      "type": "devil_advocate",
      "content": "The patent metric is misleading because...",
      "anchor_text": "Remote workers produce 13% fewer patents"
    }
  ],
  "connections_to": ["uuid-of-related-article-1", "uuid-of-related-article-2"]
}
```

**Retrieval strategy:** When generating annotations for a new page, the system queries the reading graph for:
1. Topic overlap (semantic similarity on `topics` and `key_claims`)
2. Same-domain history (has the user read this author/publication before?)
3. Contradictions (claims that oppose current page's claims)

This is done locally using lightweight embedding similarity (see Tech Stack) to select the top-N relevant entries, which are then included in the LLM prompt as context.

### Layer 3: Session Context

Held in memory (extension service worker + content script state). Discarded on session end after contributing to Layer 1 and Layer 2 updates.

```json
{
  "current_page": {
    "url": "...",
    "extracted_text": "...",
    "active_modes": ["close_reading", "context"],
    "annotations_generated": [...],
    "user_interactions": [
      { "type": "highlight", "text": "...", "timestamp": "..." },
      { "type": "thumbs_down", "annotation_id": "...", "timestamp": "..." }
    ]
  },
  "session_start": "2026-02-22T09:15:00Z"
}
```

### Memory Context Window Management

The full memory can't be sent with every LLM call. The system constructs a **memory prompt fragment** for each request:

1. **Always included:** Reader profile (Layer 1) — small, fits easily
2. **Selectively included:** Top 3-5 relevant reading graph entries (Layer 2), retrieved by topic similarity to current page
3. **Always included:** Current session context (Layer 3)

Budget: ~2,000 tokens for memory context per annotation request. The system truncates/summarizes as needed.

---

## LLM Provider System

### Provider Interface

Abstract interface that both Claude and OpenAI providers implement:

```typescript
interface LLMProvider {
  id: string;                          // "anthropic" | "openai"
  name: string;                        // Display name
  models: ModelOption[];               // Available models

  generateAnnotations(request: AnnotationRequest): Promise<AnnotationResponse>;
  updateReaderProfile(current: ReaderProfile, session: SessionContext): Promise<ReaderProfile>;
  generatePageSummary(text: string): Promise<PageSummary>;
}

interface ModelOption {
  id: string;                          // "claude-sonnet-4-5-20250929", "gpt-4o", etc.
  name: string;                        // Display name
  contextWindow: number;               // For budget planning
  costPer1kInput: number;              // For usage tracking
  costPer1kOutput: number;
}

interface AnnotationRequest {
  pageContent: string;                 // Extracted readable text
  selectedText?: string;               // If user selected specific passage
  modes: AnnotationMode[];             // Active annotation modes
  memoryContext: MemoryPromptFragment;  // Assembled memory context
}

interface AnnotationResponse {
  annotations: Annotation[];
  usage: { inputTokens: number; outputTokens: number };
}
```

### Provider Configuration

```json
{
  "provider": {
    "active": "anthropic",
    "anthropic": {
      "apiKey": "sk-ant-...",
      "model": "claude-sonnet-4-5-20250929",
      "baseUrl": "https://api.anthropic.com"
    },
    "openai": {
      "apiKey": "sk-...",
      "model": "gpt-4o",
      "baseUrl": "https://api.openai.com"
    }
  }
}
```

Users configure this in the extension options page. API keys are stored in `chrome.storage.local` (encrypted at rest by Chrome). Support custom base URLs for proxies or self-hosted endpoints.

### Prompt Architecture

Each annotation mode has a dedicated system prompt template. The final prompt is assembled as:

```
[System] Base persona + active mode instructions
[System] Memory context (profile + relevant reading history + session)
[User]   Page content (or selected passage)
[User]   "Generate annotations for the above using the following modes: ..."
```

Mode-specific prompt templates live in `/prompts/` as editable text files within the extension. Power users can customize them.

---

## Extension Architecture

### Component Map

```
marginalia/
├── manifest.json                    # Manifest V3
├── background/
│   ├── service-worker.ts            # Main background script
│   ├── llm/
│   │   ├── provider.ts              # Provider interface
│   │   ├── anthropic.ts             # Claude provider
│   │   ├── openai.ts                # OpenAI provider
│   │   └── prompt-builder.ts        # Assembles prompts with memory
│   ├── memory/
│   │   ├── profile-manager.ts       # Layer 1: Reader profile CRUD
│   │   ├── reading-graph.ts         # Layer 2: IndexedDB operations
│   │   ├── session-tracker.ts       # Layer 3: Session state
│   │   ├── memory-retriever.ts      # Selects relevant memories for context
│   │   └── embeddings.ts            # Local embedding for similarity search
│   └── extraction/
│       └── readability.ts           # Content extraction wrapper
├── content/
│   ├── content-script.ts            # Injected into pages
│   ├── sidebar/
│   │   ├── Sidebar.tsx              # Main sidebar component
│   │   ├── AnnotationCard.tsx       # Individual annotation display
│   │   ├── ModeSelector.tsx         # Toggle annotation modes
│   │   └── HighlightOverlay.tsx     # In-page text highlights
│   └── styles/
│       └── sidebar.css              # Sidebar styles (scoped, no Tailwind)
├── popup/
│   ├── Popup.tsx                    # Quick controls popup
│   └── popup.css
├── options/
│   ├── Options.tsx                  # Full settings page
│   ├── ProviderConfig.tsx           # API key + model selection
│   ├── MemoryManager.tsx            # View/edit/export/clear memory
│   └── PromptEditor.tsx             # Edit mode prompt templates
├── prompts/
│   ├── base.txt                     # Base system prompt
│   ├── close-reading.txt
│   ├── context.txt
│   ├── devil-advocate.txt
│   ├── vocabulary.txt
│   └── connections.txt
├── shared/
│   ├── types.ts                     # Shared TypeScript types
│   ├── constants.ts
│   └── utils.ts
└── assets/
    ├── icons/                       # Extension icons
    └── fonts/                       # Optional: custom annotation typography
```

### Data Flow

```
User opens page
    │
    ▼
Content Script extracts text (Readability)
    │
    ▼
Sends to Service Worker via chrome.runtime.sendMessage
    │
    ▼
Service Worker:
    ├── 1. Session Tracker records page visit
    ├── 2. Memory Retriever queries Reading Graph for related entries
    ├── 3. Prompt Builder assembles: system prompt + memory + page content
    ├── 4. LLM Provider sends request to Claude/OpenAI API
    └── 5. Returns annotations to Content Script
    │
    ▼
Content Script renders sidebar + optional inline highlights
    │
    ▼
User interacts (highlights, thumbs up/down, saves)
    │
    ▼
Session Tracker records interactions
    │
    ▼
On session end:
    ├── Reading Graph stores page summary + saved annotations
    └── Profile Manager proposes profile updates via LLM
```

### Message Protocol

Communication between content script and service worker:

```typescript
// Content → Background
type RequestMessage =
  | { type: "ANNOTATE_PAGE"; payload: { url: string; text: string; modes: AnnotationMode[] } }
  | { type: "ANNOTATE_SELECTION"; payload: { text: string; modes: AnnotationMode[] } }
  | { type: "SAVE_ANNOTATION"; payload: { annotation: Annotation } }
  | { type: "RECORD_INTERACTION"; payload: { interaction: UserInteraction } }
  | { type: "GET_PAGE_HISTORY"; payload: { url: string } }

// Background → Content
type ResponseMessage =
  | { type: "ANNOTATIONS_READY"; payload: { annotations: Annotation[] } }
  | { type: "ANNOTATIONS_STREAMING"; payload: { chunk: string; annotationId: string } }
  | { type: "ERROR"; payload: { message: string; code: string } }
```

---

## User Interface

### Sidebar

The primary UI surface. Opens on the right side of the page as a shadow DOM panel (to avoid CSS conflicts with host page).

**Layout:**
```
┌──────────────────────────────────────┐
│ MARGINALIA                    [—] [×]│
├──────────────────────────────────────┤
│ Modes: [Close Reading] [Context] ... │
├──────────────────────────────────────┤
│                                      │
│ ┌──────────────────────────────────┐ │
│ │ 📖 Close Reading          ¶ 3   │ │
│ │                                  │ │
│ │ The author opens with a          │ │
│ │ deliberate inversion of the      │ │
│ │ conventional Silicon Valley...   │ │
│ │                          [💾][👍]│ │
│ └──────────────────────────────────┘ │
│                                      │
│ ┌──────────────────────────────────┐ │
│ │ 🌍 Context               ¶ 3   │ │
│ │                                  │ │
│ │ This was published one week      │ │
│ │ after the EU AI Act vote...      │ │
│ │                          [💾][👍]│ │
│ └──────────────────────────────────┘ │
│                                      │
│ ┌──────────────────────────────────┐ │
│ │ 🔗 Connection                   │ │
│ │                                  │ │
│ │ Compare with "The Case for      │ │
│ │ Regulation" you read on Feb 15  │ │
│ │ which argued the opposite...     │ │
│ │                          [💾][👍]│ │
│ └──────────────────────────────────┘ │
│                                      │
├──────────────────────────────────────┤
│ Tokens used: 2,847 · ~$0.004       │
└──────────────────────────────────────┘
```

**Key interactions:**
- Click annotation → highlights corresponding text on page
- Select text on page → "Annotate this" floating button appears
- Thumbs up/down → feeds into profile preferences (annotation quality signal)
- Save icon → persists annotation to Reading Graph
- `¶ 3` → paragraph anchor (clickable, scrolls to location)

### Popup

Minimal quick-controls accessible from the extension icon:

- Toggle Marginalia on/off for current tab
- Quick mode selector
- Current session stats (annotations generated, tokens used)
- Link to full options page

### Options Page

Full configuration:

- **Provider tab:** API key entry, model selection, custom base URL, test connection button
- **Modes tab:** Enable/disable modes, reorder priority, edit prompt templates
- **Memory tab:**
  - View reader profile (editable)
  - Browse reading graph (searchable list of past pages)
  - Export all memory as JSON
  - Clear memory (with confirmation)
  - Memory stats (total entries, topics distribution)
- **Appearance tab:** Sidebar width, font size, color theme (light/dark/auto)
- **Usage tab:** Token usage history, estimated costs by provider

---

## Tech Stack

| Component | Technology | Rationale |
|-----------|-----------|-----------|
| Extension framework | Manifest V3 | Required for Chrome Web Store |
| Language | TypeScript | Type safety across message passing |
| Build | Vite + CRXJS | Fast builds, HMR for extension dev |
| Content extraction | @mozilla/readability | Battle-tested, same lib as Firefox Reader View |
| Sidebar UI | Preact + Shadow DOM | Lightweight React-compatible, isolated from host CSS |
| Storage (profile) | chrome.storage.local | Synced, small data |
| Storage (reading graph) | IndexedDB via Dexie.js | Structured queries, large datasets |
| Local embeddings | Transformers.js (MiniLM) | In-browser similarity search, no API call needed |
| Markdown rendering | marked + DOMPurify | Annotations may contain formatting |
| Streaming | Fetch + ReadableStream | Stream annotations as they generate |

### Why Local Embeddings?

The Reading Graph needs similarity search to find relevant past entries. Sending every query to an LLM API would be slow and expensive. Instead, we use `Transformers.js` with `all-MiniLM-L6-v2` (~23MB model) to generate embeddings locally in the service worker. This enables:

- Fast cosine similarity search across reading graph entries
- No API cost for memory retrieval
- Works offline for memory-only features

The model is loaded lazily on first use and cached.

---

## Data Privacy & Storage

All data stays local by default:
- API keys in `chrome.storage.local` (encrypted at rest by Chrome)
- Reader profile in `chrome.storage.local`
- Reading graph in IndexedDB
- No telemetry, no cloud sync (v1)

**Future consideration:** Optional encrypted cloud sync via user-provided storage (e.g., personal S3 bucket or Google Drive) for cross-device continuity.

---

## Performance Budget

| Metric | Target |
|--------|--------|
| Sidebar open time | < 200ms |
| Content extraction | < 500ms |
| First annotation visible (streaming) | < 2s |
| Full page annotation set | < 8s |
| Memory retrieval (similarity search) | < 100ms |
| Extension memory footprint (idle) | < 50MB |
| Extension memory footprint (active, with ML model) | < 150MB |

---

## MVP Scope (v0.1)

Ship the smallest thing that's useful, then iterate.

### In Scope
- [ ] Content extraction from any web page
- [ ] Sidebar with annotation display
- [ ] 3 annotation modes: Close Reading, Context, Devil's Advocate
- [ ] Claude provider (single provider)
- [ ] Basic reader profile (expertise areas, interests)
- [ ] Reading graph (stores page summaries, retrieves by topic overlap)
- [ ] Select text → annotate selection
- [ ] Streaming annotation display
- [ ] Token usage tracking

### Out of Scope (v0.2+)
- [ ] OpenAI provider
- [ ] Connections mode (requires meaningful reading history)
- [ ] Vocabulary mode
- [ ] Custom prompt editing
- [ ] PDF support
- [ ] Export/import memory
- [ ] Cross-device sync
- [ ] Firefox / Safari ports

---

## Open Questions

1. **Annotation granularity:** Annotate the full page at once, or paragraph-by-paragraph? Full page is simpler but uses more tokens and may produce less precise annotations. Paragraph-level is more precise but requires multiple API calls or a chunking strategy.

2. **Streaming UX:** Stream annotations one at a time into the sidebar, or wait for the full batch? Streaming feels faster but the order may shift as later annotations reference earlier paragraphs.

3. **Memory compaction:** As the reading graph grows (hundreds of entries), how aggressively should we summarize/compact old entries? LLM-based compaction is effective but adds cost.

4. **Embedding model size vs accuracy:** MiniLM is small (~23MB) but less accurate than larger models. Is the similarity search good enough for reading graph retrieval, or do we need a larger model?

5. **Rate limiting:** How to handle users who annotate many pages quickly? Queue system? Per-session token budget with warnings?

---

## Getting Started (Scaffolding Order)

Recommended order for building this out:

1. **Scaffold the extension** — Vite + CRXJS + Manifest V3 + TypeScript config. Get a "hello world" sidebar rendering.
2. **Content extraction** — Integrate Readability, test on 10 diverse pages (news, blog, docs, academic).
3. **LLM provider (Claude only)** — Implement the provider interface with Anthropic SDK. Get a hardcoded prompt returning annotations.
4. **Sidebar UI** — Preact components for annotation cards. Wire up to provider.
5. **Prompt architecture** — Build the mode-specific prompts. Iterate on quality.
6. **Memory Layer 3 (session)** — Track current session state, feed into prompts.
7. **Memory Layer 2 (reading graph)** — IndexedDB + Dexie. Store page summaries. Implement local embeddings for retrieval.
8. **Memory Layer 1 (reader profile)** — LLM-based profile updates after sessions.
9. **Polish** — Streaming, token tracking, options page, error handling.

---

*Last updated: February 22, 2026*
