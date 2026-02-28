interface FloatingPillProps {
  count: number;
  loading: boolean;
  visible: boolean;
  onToggle: () => void;
}

export function FloatingPill({ count, loading, visible, onToggle }: FloatingPillProps) {
  if (count === 0 && !loading) return null;

  const label = loading
    ? 'Analyzing...'
    : `${count} insight${count !== 1 ? 's' : ''}`;

  const icon = loading ? '\u25CF' : visible ? '\u25C9' : '\u25CB';

  return (
    <div
      class={`marginalia-pill ${loading ? 'loading' : ''} ${!visible && !loading ? 'hidden-state' : ''}`}
      onClick={onToggle}
      title={visible ? 'Hide annotations' : 'Show annotations'}
    >
      <span class="marginalia-pill-icon">{icon}</span>
      <span>{label}</span>
    </div>
  );
}
