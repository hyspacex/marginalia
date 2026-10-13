import type { ComponentChildren } from 'preact';
import { usePresence } from '../render/use-presence';

// Matches the .is-closing animation duration in inline.css
const PILL_EXIT_MS = 250;

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
  const show = !(summaryOnly && !hasSummary && !summaryLoading);
  const presence = usePresence(show, PILL_EXIT_MS);
  if (presence === 'closed') return null;

  const busy = loading || (summaryOnly && summaryLoading);
  const stateClass = busy ? 'is-busy' : !visible && !summaryOnly ? 'is-off' : 'is-on';

  let label;
  if (loading) {
    // Annotations stream in while loading; show the running count once one lands.
    label = count > 0
      ? <LabelSwap id="count-loading"><Count value={count} /> found…</LabelSwap>
      : <LabelSwap id="analyzing" shimmer>Reading…</LabelSwap>;
  } else if (summaryOnly) {
    label = summaryLoading
      ? <LabelSwap id="summarizing" shimmer>Summarizing…</LabelSwap>
      : <LabelSwap id="summary">Summary</LabelSwap>;
  } else {
    label = (
      <LabelSwap id="count">
        <Count value={count} /> note{count !== 1 ? 's' : ''}
      </LabelSwap>
    );
  }

  return (
    <div
      class={`marginalia-pill ${stateClass} is-${presence}`}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onClick={summaryOnly ? onShowSummary : onToggle}
      title={summaryOnly ? 'Show summary' : visible ? 'Hide notes' : 'Show notes'}
    >
      <span class="marginalia-pill-mark" aria-hidden="true" />
      <span class="marginalia-pill-label">{label}</span>
    </div>
  );
}

/** Remounts (and so re-runs the swap-in animation) whenever `id` changes. */
function LabelSwap({ id, shimmer, children }: { id: string; shimmer?: boolean; children: ComponentChildren }) {
  if (shimmer) {
    const text = typeof children === 'string' ? children : '';
    return (
      <span key={id} class="marginalia-swap marginalia-shimmer" data-text={text}>
        {children}
      </span>
    );
  }
  return <span key={id} class="marginalia-swap">{children}</span>;
}

/** Number that pops in each time its value changes. */
function Count({ value }: { value: number }) {
  return <span key={value} class="marginalia-count">{value}</span>;
}
