interface FloatingPillProps {
  count: number;
  loading: boolean;
  visible: boolean;
  hasSummary: boolean;
  summaryLoading: boolean;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  onToggle: () => void;
  onShowSummary: () => void;
}

export function FloatingPill({
  count,
  loading,
  visible,
  hasSummary,
  summaryLoading,
  onMouseEnter,
  onMouseLeave,
  onToggle,
  onShowSummary,
}: FloatingPillProps) {
  const summaryOnly = count === 0 && !loading;
  if (summaryOnly && !hasSummary && !summaryLoading) return null;

  const busy = loading || (summaryOnly && summaryLoading);

  const label = loading
    ? 'Analyzing…'
    : summaryOnly
      ? summaryLoading ? 'Summarizing…' : 'Summary'
      : `${count} insight${count !== 1 ? 's' : ''}`;

  const stateClass = busy ? 'is-busy' : !visible && !summaryOnly ? 'is-off' : 'is-on';

  return (
    <div
      class={`marginalia-pill ${stateClass}`}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onClick={summaryOnly ? onShowSummary : onToggle}
      title={summaryOnly ? 'Show summary' : visible ? 'Hide annotations' : 'Show annotations'}
    >
      <span class="marginalia-pill-dot" />
      <span class="marginalia-pill-label">{label}</span>
    </div>
  );
}
