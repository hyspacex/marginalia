interface SummaryCardProps {
  summary: string | null;
  loading: boolean;
  onClose: () => void;
}

export function SummaryCard({ summary, loading, onClose }: SummaryCardProps) {
  if (!loading && !summary) return null;

  return (
    <div class="marginalia-summary">
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
        <p class="marginalia-summary-text">{summary}</p>
      )}
    </div>
  );
}
