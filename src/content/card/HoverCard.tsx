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
  const [arrowPosition, setArrowPosition] = useState({ x: 0, y: 0, side: 'bottom' as string });

  const html = useMemo(() => {
    if (!annotation) return '';
    const raw = marked.parse(annotation.content, { async: false }) as string;
    return DOMPurify.sanitize(raw);
  }, [annotation?.content]);

  useEffect(() => {
    if (!annotation || !triggerRect || !cardRef.current) {
      setVisible(false);
      return;
    }

    // Create a virtual element for Floating UI from the DOMRect
    const virtualEl = {
      getBoundingClientRect: () => triggerRect,
    };

    computePosition(virtualEl, cardRef.current, {
      placement: 'top',
      middleware: [
        offset(8),
        flip({ fallbackPlacements: ['bottom', 'top'] }),
        shift({ padding: 12 }),
        arrow({ element: arrowRef.current! }),
      ],
    }).then(({ x, y, placement, middlewareData }) => {
      setPosition({ x, y });

      if (middlewareData.arrow) {
        const side = placement.split('-')[0];
        setArrowPosition({
          x: middlewareData.arrow.x ?? 0,
          y: middlewareData.arrow.y ?? 0,
          side,
        });
      }

      // Trigger visible on next frame for animation
      requestAnimationFrame(() => setVisible(true));
    });
  }, [annotation, triggerRect]);

  if (!annotation) return null;

  const arrowSideMap: Record<string, Record<string, string>> = {
    top: { bottom: '-4px', left: `${arrowPosition.x}px` },
    bottom: { top: '-4px', left: `${arrowPosition.x}px` },
    left: { right: '-4px', top: `${arrowPosition.y}px` },
    right: { left: '-4px', top: `${arrowPosition.y}px` },
  };

  return (
    <div
      ref={cardRef}
      class={`marginalia-card ${visible ? 'visible' : ''}`}
      style={{ left: `${position.x}px`, top: `${position.y}px` }}
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
        style={arrowSideMap[arrowPosition.side] || {}}
      />
    </div>
  );
}
