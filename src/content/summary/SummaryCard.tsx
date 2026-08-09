import type { ContentType, SummarySection } from '@/shared/types';
import { renderMarkdownToHtml } from '../render/markdown';

const CONTENT_TYPE_LABELS: Record<ContentType, string> = {
  'news-report': 'News',
  'opinion-analysis': 'Opinion',
  'technical-blog': 'Technical',
  'research-paper': 'Research',
  'discussion-thread': 'Discussion',
  'reference-docs': 'Reference',
  'other': 'Article',
};

interface SummaryCardProps {
  sections: SummarySection[];
  contentType: ContentType | null;
  error: string | null;
  loading: boolean;
  visible: boolean;
  quickAddHost: string | null;
  quickAddAdded: boolean;
  onQuickAdd: () => void;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  onClose: () => void;
}

export function SummaryCard({
  sections,
  contentType,
  error,
  loading,
  visible,
  quickAddHost,
  quickAddAdded,
  onQuickAdd,
  onMouseEnter,
  onMouseLeave,
  onClose,
}: SummaryCardProps) {
  const hasContent = loading || sections.length > 0 || error !== null;
  if (!hasContent || !visible) return null;

  return (
    <div
      class="marginalia-summary"
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <button
        class="marginalia-summary-close"
        onClick={onClose}
        title="Close summary"
      >
        ×
      </button>
      <div class="marginalia-summary-label">
        Summary
        {contentType && (
          <span class={`marginalia-summary-badge is-${contentType}`}>
            {CONTENT_TYPE_LABELS[contentType]}
          </span>
        )}
      </div>
      {error !== null ? (
        <div class="marginalia-summary-error">Summary unavailable: {error}</div>
      ) : (
        <div class="marginalia-summary-body">
          {sections.map((section) => (
            <div class="marginalia-summary-section" key={section.id}>
              <div class="marginalia-summary-heading">{section.heading}</div>
              <div
                class="marginalia-summary-text"
                dangerouslySetInnerHTML={{ __html: renderMarkdownToHtml(section.markdown) }}
              />
            </div>
          ))}
          {loading && (
            <div class="marginalia-summary-skeleton">
              <div class="marginalia-skeleton-line" />
              <div class="marginalia-skeleton-line short" />
            </div>
          )}
        </div>
      )}
      {quickAddHost && error === null && (
        <div class="marginalia-summary-footer">
          {quickAddAdded ? (
            <span class="marginalia-quickadd-on">Auto-summarize is on for {quickAddHost}</span>
          ) : (
            <button class="marginalia-quickadd-btn" onClick={onQuickAdd}>
              Always summarize {quickAddHost}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
