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
      pointerEvents: 'auto',
      cursor: 'pointer',
      background: 'transparent',
    });

    el.addEventListener('mouseenter', () => {
      onHoverCallback?.(annotation, rect);
    });

    el.addEventListener('mouseleave', (e) => {
      const related = (e as MouseEvent).relatedTarget as HTMLElement | null;
      if (related?.closest?.('#marginalia-host')) return;
      onLeaveCallback?.();
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

export const highlightManager = {
  init(
    onHover: (annotation: Annotation, rect: DOMRect) => void,
    onLeave: () => void,
  ) {
    onHoverCallback = onHover;
    onLeaveCallback = onLeave;

    window.addEventListener('scroll', scheduleReposition, { passive: true });
    window.addEventListener('resize', scheduleReposition, { passive: true });
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

    for (const entry of entries) {
      for (const el of entry.hitTargets) {
        el.remove();
      }
    }
    entries = [];

    window.removeEventListener('scroll', scheduleReposition);
    window.removeEventListener('resize', scheduleReposition);
    if (repositionRAF !== null) {
      cancelAnimationFrame(repositionRAF);
      repositionRAF = null;
    }
  },
};
