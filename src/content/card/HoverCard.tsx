import { useState, useEffect, useRef, useMemo } from 'preact/hooks';
import { computePosition, flip, shift, offset, arrow } from '@floating-ui/dom';
import type { Annotation } from '@/shared/types';
import { renderMarkdownToHtml } from '../render/markdown';
import { usePresence } from '../render/use-presence';

// Matches the closing transition in inline.css
const CARD_EXIT_MS = 80;

interface HoverCardProps {
  annotation: Annotation | null;
  triggerRect: DOMRect | null;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}

export function HoverCard({ annotation, triggerRect, onMouseEnter, onMouseLeave }: HoverCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const arrowRef = useRef<HTMLDivElement>(null);
  // Keep the last annotation so the card can fade out with its content.
  const shownRef = useRef<Annotation | null>(annotation);
  if (annotation) shownRef.current = annotation;
  const placedRef = useRef(false);

  const [placed, setPlaced] = useState(false);
  // True when the card moves between highlights while already open.
  const [travel, setTravel] = useState(false);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [arrowStyle, setArrowStyle] = useState<Record<string, string>>({});

  const presence = usePresence(annotation !== null && placed, CARD_EXIT_MS);
  const shown = shownRef.current;

  const html = useMemo(() => {
    if (!shown) return '';
    return renderMarkdownToHtml(shown.content);
  }, [shown?.content]);

  useEffect(() => {
    if (!annotation || !triggerRect) {
      placedRef.current = false;
      setPlaced(false);
      return;
    }

    // Wait a frame so the card is laid out (display:block) before measuring.
    let cancelled = false;
    requestAnimationFrame(() => {
      const card = cardRef.current;
      const arrowEl = arrowRef.current;
      if (!card || cancelled) return;

      const virtualEl = {
        getBoundingClientRect: () => triggerRect,
      };

      computePosition(virtualEl, card, {
        strategy: 'fixed',
        placement: 'top',
        middleware: [
          offset(10),
          flip({ fallbackPlacements: ['bottom'] }),
          shift({ padding: 12 }),
          ...(arrowEl ? [arrow({ element: arrowEl, padding: 12 })] : []),
        ],
      }).then(({ x, y, placement, middlewareData }) => {
        if (cancelled) return;
        setTravel(placedRef.current);
        placedRef.current = true;
        setPosition({ x, y });

        if (middlewareData.arrow && arrowEl) {
          const side = placement.split('-')[0];
          const staticSide = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' }[side] || 'bottom';
          setArrowStyle({
            left: middlewareData.arrow.x != null ? `${middlewareData.arrow.x}px` : '',
            top: middlewareData.arrow.y != null ? `${middlewareData.arrow.y}px` : '',
            [staticSide]: '-5px',
          });
        }

        card.style.transformOrigin = placement.startsWith('bottom') ? '50% 0%' : '50% 100%';
        setPlaced(true);
      });
    });

    return () => {
      cancelled = true;
    };
  }, [annotation, triggerRect]);

  // Stay in layout while open, measuring, or fading out, so the ref stays
  // measurable and the close transition can play.
  const mounted = annotation !== null || presence !== 'closed';

  return (
    <div
      ref={cardRef}
      class={`marginalia-card is-${presence}${travel ? ' is-travel' : ''}`}
      style={{
        display: mounted ? 'block' : 'none',
        translate: `${position.x}px ${position.y}px`,
      }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <div class="marginalia-card-label">Margin note</div>
      <div
        key={shown?.id}
        class="marginalia-card-body"
        dangerouslySetInnerHTML={{ __html: html }}
      />
      <div
        ref={arrowRef}
        class="marginalia-card-arrow"
        style={arrowStyle}
      />
    </div>
  );
}
