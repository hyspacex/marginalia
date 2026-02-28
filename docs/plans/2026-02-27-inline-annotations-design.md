# Inline Annotations Design

## Problem

The sidebar-based annotation UI is disruptive to the reading experience. Users want annotations that live within the article itself — subtle highlights on key sentences with hover cards that reveal concise insights.

## Design Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Highlight method | CSS Custom Highlight API | Zero DOM mutation, best performance, Baseline browser support |
| Reveal mode | Progressive streaming | Highlights appear one by one as LLM streams — feels alive |
| Annotation density | Sparse (3-5 per article) | Research shows >5 per screen causes annotation fatigue |
| Mode system | Single mode (no distinction) | Simpler UI, less visual noise — content speaks for itself |
| Hover card style | Rich card with label | 2-4 sentences, clean white card, arrow pointer, fade-in animation |
| Card positioning | Floating UI | Handles flip/shift/offset automatically, lightweight (~3KB) |

## Interaction Flow

1. User clicks extension icon
2. Content script extracts article text, sends to service worker
3. Service worker streams JSONL annotations (each with required `anchor` field)
4. Content script receives each annotation progressively:
   - Finds anchor text in DOM via TreeWalker + fuzzy text matching
   - Creates Range over matching text
   - Registers Range in CSS Highlight → subtle highlight appears
   - Creates invisible hit-target overlay at range position
5. On hover (300ms delay): rich card appears via Floating UI
6. On mouse-out (200ms delay with hover bridge): card fades out
7. Floating pill in bottom-right shows count + toggle control

## Visual Design

### Highlights

- Background: `rgba(255, 200, 80, 0.15)` — warm amber wash
- Underline: `text-decoration: underline dotted` at `rgba(180, 140, 50, 0.5)`
- Hover state: background intensifies to `rgba(255, 200, 80, 0.30)`

### Hover Card

- White background, `border-radius: 8px`, shadow `0 4px 12px rgba(0,0,0,0.1)`
- Max width 360px, padding 12px 16px
- Small "Marginalia" label top-left, muted gray
- Fade-in: `opacity 0→1, translateY 4px→0, 150ms ease`
- Arrow pointer via Floating UI

### Floating Pill

- Bottom-right corner, fixed position
- Shows "N insights" with toggle icon
- Click to hide/show all highlights
- Loading state: "Analyzing..." with pulse animation

## Data Model

```typescript
interface Annotation {
  id: string;
  content: string;     // 1-4 sentence insight (markdown)
  anchor: string;      // REQUIRED: exact quote from article
  timestamp: number;
}
```

## Architecture

```
Content Script
├── HighlightManager (page DOM context)
│   ├── findTextInDOM(anchor) → Range
│   ├── CSS.highlights.set('marginalia', highlight)
│   └── createHitTarget(range, annotation)
├── HoverCard (Shadow DOM, Preact)
│   ├── Single reusable instance
│   ├── Positioned via Floating UI computePosition()
│   └── Renders annotation.content as sanitized markdown
└── FloatingPill (Shadow DOM, Preact)
    ├── Annotation count display
    ├── Toggle highlights on/off
    └── Loading indicator during streaming
```

### Why Split Between Page DOM and Shadow DOM

- **HighlightManager + hit targets** must be in page DOM because CSS Custom Highlight API targets page text nodes and hit targets need correct positioning relative to article text
- **HoverCard + FloatingPill** live in Shadow DOM for style isolation — card styling must not be affected by page CSS

## What Changes

### Removed

- `src/content/sidebar/Sidebar.tsx` — replaced by inline system
- `src/content/sidebar/AnnotationCard.tsx` — replaced by HoverCard
- `src/content/sidebar/ModeSelector.tsx` — modes removed entirely
- `src/content/styles/sidebar.css` — replaced by inline.css
- Mode-related types and constants (AnnotationMode, MODE_COLORS, MODE_ICONS, MODE_LABELS)
- Body margin adjustment logic

### Added

- `src/content/highlighter/highlight-manager.ts` — text search, Range/Highlight management, hit targets
- `src/content/highlighter/text-finder.ts` — TreeWalker-based fuzzy text search
- `src/content/card/HoverCard.tsx` — Preact hover card component
- `src/content/pill/FloatingPill.tsx` — Preact floating control pill
- `src/content/styles/inline.css` — styles for card, pill, hit targets

### Modified

- `src/shared/types.ts` — simplify Annotation type (drop mode, require anchor)
- `src/shared/constants.ts` — remove mode constants, add highlight/card constants
- `src/background/llm/prompt-builder.ts` — single prompt, require anchor in output
- `src/background/service-worker.ts` — simplify message handling (no modes)
- `src/content/content-script.ts` — replace sidebar injection with highlight system
- `src/prompts/` — replace mode-specific prompts with single annotation prompt
- `src/popup/Popup.tsx` — simplify (no mode selection)

## Prompt Strategy

Single system prompt instructing the LLM to:

1. Read the article carefully
2. Identify the 3-5 most insightful sentences worth annotating
3. For each, return JSONL with the exact quoted text (`anchor`) and a concise insight (`content`)
4. Adapt annotations to reader's knowledge profile (via memory context)

## Dependencies

- `@floating-ui/dom` — hover card positioning (~3KB tree-shaken)
- Existing: `marked`, `dompurify`, `@mozilla/readability`, `dexie`
