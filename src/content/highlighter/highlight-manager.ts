import type { Annotation } from '@/shared/types';
import { findTextInDOM } from './text-finder';

interface HighlightEntry {
  annotation: Annotation;
  range: Range;
  hitTargets: HTMLElement[];
}

const HIGHLIGHT_NAME = 'marginalia';
const HIT_TARGET_CLASS = 'marginalia-hit-target';

let entries: HighlightEntry[] = [];
let highlight: Highlight | null = null;
let visible = true;
let onHoverCallback: ((annotation: Annotation, rect: DOMRect) => void) | null = null;
let onLeaveCallback: (() => void) | null = null;
let repositionRAF: number | null = null;

function createHitTargets(range: Range, annotation: Annotation): HTMLElement[] {
  const rects = range.getClientRects();
  const targets: HTMLElement[] = [];

  for (const rect of rects) {
    const el = document.createElement('div');
    el.className = HIT_TARGET_CLASS;
    el.dataset.annotationId = annotation.id;
    Object.assign(el.style, {
      position: 'absolute',
      top: `${window.scrollY + rect.top}px`,
      left: `${window.scrollX + rect.left}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
      zIndex: '2147483645',
      pointerEvents: 'none',
      background: 'transparent',
    });

    document.body.appendChild(el);
    targets.push(el);
  }

  return targets;
}

function repositionHitTargets() {
  for (const entry of entries) {
    const rects = entry.range.getClientRects();
    const targets = entry.hitTargets;

    // If rect count changed (text reflow), recreate hit targets
    if (rects.length !== targets.length) {
      for (const el of targets) el.remove();
      entry.hitTargets = createHitTargets(entry.range, entry.annotation);
      continue;
    }

    for (let i = 0; i < targets.length && i < rects.length; i++) {
      const rect = rects[i];
      Object.assign(targets[i].style, {
        top: `${window.scrollY + rect.top}px`,
        left: `${window.scrollX + rect.left}px`,
        width: `${rect.width}px`,
        height: `${rect.height}px`,
      });
    }
  }
}

function scheduleReposition() {
  if (repositionRAF !== null) return;
  repositionRAF = requestAnimationFrame(() => {
    repositionHitTargets();
    repositionRAF = null;
  });
}

// Hover detection via mousemove — avoids pointer-events blocking on hit targets
let currentHoverEntry: HighlightEntry | null = null;

function findEntryAtPoint(x: number, y: number): HighlightEntry | null {
  for (const entry of entries) {
    const rects = entry.range.getClientRects();
    for (const rect of rects) {
      if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
        return entry;
      }
    }
  }
  return null;
}

function handleMouseMove(e: MouseEvent) {
  if (!visible) return;
  const entry = findEntryAtPoint(e.clientX, e.clientY);

  if (entry && entry !== currentHoverEntry) {
    currentHoverEntry = entry;
    const rect = entry.range.getClientRects()[0];
    if (rect) {
      onHoverCallback?.(entry.annotation, rect);
    }
  } else if (!entry && currentHoverEntry) {
    currentHoverEntry = null;
    onLeaveCallback?.();
  }
}

export const highlightManager = {
  init(
    onHover: (annotation: Annotation, rect: DOMRect) => void,
    onLeave: () => void,
  ) {
    onHoverCallback = onHover;
    onLeaveCallback = onLeave;

    window.addEventListener('scroll', scheduleReposition, { passive: true });
    window.addEventListener('resize', scheduleReposition, { passive: true });
    document.addEventListener('mousemove', handleMouseMove, { passive: true });
  },

  addAnnotation(annotation: Annotation): boolean {
    const range = findTextInDOM(annotation.anchor);
    if (!range) return false;

    if (!highlight) {
      highlight = new Highlight();
      CSS.highlights.set(HIGHLIGHT_NAME, highlight);
    }
    highlight.add(range);

    const hitTargets = createHitTargets(range, annotation);
    entries.push({ annotation, range, hitTargets });
    return true;
  },

  setVisible(show: boolean) {
    visible = show;
    if (show) {
      if (highlight) {
        CSS.highlights.set(HIGHLIGHT_NAME, highlight);
      }
      for (const entry of entries) {
        for (const el of entry.hitTargets) {
          el.style.display = '';
        }
      }
    } else {
      CSS.highlights.delete(HIGHLIGHT_NAME);
      for (const entry of entries) {
        for (const el of entry.hitTargets) {
          el.style.display = 'none';
        }
      }
    }
  },

  isVisible(): boolean {
    return visible;
  },

  getCount(): number {
    return entries.length;
  },

  clear() {
    CSS.highlights.delete(HIGHLIGHT_NAME);
    highlight = null;
    currentHoverEntry = null;

    for (const entry of entries) {
      for (const el of entry.hitTargets) {
        el.remove();
      }
    }
    entries = [];

    if (repositionRAF !== null) {
      cancelAnimationFrame(repositionRAF);
      repositionRAF = null;
    }
  },
};
