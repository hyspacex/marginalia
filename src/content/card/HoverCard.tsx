import { useState, useEffect, useRef, useMemo } from 'preact/hooks';
import { computePosition, flip, shift, offset, arrow } from '@floating-ui/dom';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import type { Annotation } from '@/shared/types';

interface HoverCardProps {
  annotation: Annotation | null;
  triggerRect: DOMRect | null;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}

export function HoverCard({ annotation, triggerRect, onMouseEnter, onMouseLeave }: HoverCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const arrowRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [arrowStyle, setArrowStyle] = useState<Record<string, string>>({});

  const html = useMemo(() => {
    if (!annotation) return '';
    const raw = marked.parse(annotation.content, { async: false }) as string;
    return DOMPurify.sanitize(raw);
  }, [annotation?.content]);

  useEffect(() => {
    if (!annotation || !triggerRect) {
      setVisible(false);
      return;
    }

    // Wait a frame for the card to be rendered with display:block
    console.log('[Marginalia] HoverCard useEffect', { annotationId: annotation.id, triggerRect: triggerRect.toJSON() });
    requestAnimationFrame(() => {
      const card = cardRef.current;
      const arrowEl = arrowRef.current;
      if (!card) {
        console.log('[Marginalia] HoverCard: cardRef is null!');
        return;
      }

      const virtualEl = {
        getBoundingClientRect: () => triggerRect,
      };

      computePosition(virtualEl, card, {
        strategy: 'fixed',
        placement: 'top',
        middleware: [
          offset(8),
          flip({ fallbackPlacements: ['bottom'] }),
          shift({ padding: 12 }),
          ...(arrowEl ? [arrow({ element: arrowEl })] : []),
        ],
      }).then(({ x, y, placement, middlewareData }) => {
        console.log('[Marginalia] computePosition result', { x, y, placement });
        setPosition({ x, y });

        if (middlewareData.arrow && arrowEl) {
          const side = placement.split('-')[0];
          const staticSide = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' }[side] || 'bottom';
          setArrowStyle({
            left: middlewareData.arrow.x != null ? `${middlewareData.arrow.x}px` : '',
            top: middlewareData.arrow.y != null ? `${middlewareData.arrow.y}px` : '',
            [staticSide]: '-4px',
          });
        }

        setVisible(true);
      });
    });
  }, [annotation, triggerRect]);

  // Always render the card — use display to hide/show.
  // This keeps the ref stable so computePosition can measure it.
  const show = annotation !== null;

  return (
    <div
      ref={cardRef}
      class={`marginalia-card ${visible && show ? 'visible' : ''}`}
      style={{
        display: show ? 'block' : 'none',
        left: `${position.x}px`,
        top: `${position.y}px`,
      }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <div class="marginalia-card-label">Marginalia</div>
      <div
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
