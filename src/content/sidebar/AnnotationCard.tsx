import { useMemo } from 'preact/hooks';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import type { Annotation } from '@/shared/types';
import { MODE_LABELS, MODE_COLORS, MODE_ICONS } from '@/shared/constants';

interface AnnotationCardProps {
  annotation: Annotation;
  onSave?: (annotation: Annotation) => void;
  onThumbsUp?: (annotation: Annotation) => void;
  onThumbsDown?: (annotation: Annotation) => void;
}

export function AnnotationCard({ annotation, onSave, onThumbsUp, onThumbsDown }: AnnotationCardProps) {
  const html = useMemo(() => {
    const raw = marked.parse(annotation.content, { async: false }) as string;
    return DOMPurify.sanitize(raw);
  }, [annotation.content]);

  const color = MODE_COLORS[annotation.mode];

  return (
    <div class="annotation-card">
      <div class="annotation-card-header" style={{ color }}>
        <span>{MODE_ICONS[annotation.mode]}</span>
        <span>{MODE_LABELS[annotation.mode]}</span>
      </div>
      <div
        class="annotation-card-body"
        dangerouslySetInnerHTML={{ __html: html }}
      />
      <div class="annotation-card-footer">
        <button class="card-action-btn" onClick={() => onSave?.(annotation)} title="Save">
          {'\u{1F4BE}'}
        </button>
        <button class="card-action-btn" onClick={() => onThumbsUp?.(annotation)} title="Helpful">
          {'\u{1F44D}'}
        </button>
        <button class="card-action-btn" onClick={() => onThumbsDown?.(annotation)} title="Not helpful">
          {'\u{1F44E}'}
        </button>
      </div>
    </div>
  );
}
