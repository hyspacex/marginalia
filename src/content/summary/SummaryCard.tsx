import { renderMarkdownToHtml } from '../render/markdown';

interface SummaryCardProps {
  summary: string | null;
  loading: boolean;
  visible: boolean;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  onClose: () => void;
}

export function SummaryCard({
  summary,
  loading,
  visible,
  onMouseEnter,
  onMouseLeave,
  onClose,
}: SummaryCardProps) {
  if ((!loading && !summary) || !visible) return null;

  const html = summary ? renderMarkdownToHtml(summary) : '';

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
      <div class="marginalia-summary-label">Summary</div>
      {loading && !summary ? (
        <div class="marginalia-summary-skeleton">
          <div class="marginalia-skeleton-line" />
          <div class="marginalia-skeleton-line" />
          <div class="marginalia-skeleton-line short" />
        </div>
      ) : (
        <div
          class="marginalia-summary-text"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      )}
    </div>
  );
}
