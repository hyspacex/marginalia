import type { AnnotationMode } from '@/shared/types';
import { MODE_LABELS, MODE_COLORS } from '@/shared/constants';

interface ModeSelectorProps {
  activeModes: AnnotationMode[];
  onToggleMode: (mode: AnnotationMode) => void;
}

const ALL_MODES: AnnotationMode[] = ['close-reading', 'context', 'devil-advocate'];

export function ModeSelector({ activeModes, onToggleMode }: ModeSelectorProps) {
  return (
    <div class="mode-selector">
      {ALL_MODES.map((mode) => {
        const isActive = activeModes.includes(mode);
        return (
          <button
            key={mode}
            class={`mode-btn ${isActive ? 'active' : ''}`}
            style={isActive ? { background: MODE_COLORS[mode] } : undefined}
            onClick={() => onToggleMode(mode)}
          >
            {MODE_LABELS[mode]}
          </button>
        );
      })}
    </div>
  );
}
