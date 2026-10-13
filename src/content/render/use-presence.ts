import { useEffect, useState } from 'preact/hooks';

export type PresenceState = 'open' | 'closing' | 'closed';

/**
 * Keeps an element mounted for `exitMs` after `open` turns false so its
 * close transition can play. Returns 'closed' once it should unmount.
 */
export function usePresence(open: boolean, exitMs: number): PresenceState {
  const [state, setState] = useState<PresenceState>(open ? 'open' : 'closed');

  useEffect(() => {
    if (open) {
      setState('open');
      return;
    }
    setState((current) => (current === 'closed' ? 'closed' : 'closing'));
    const timer = setTimeout(() => setState('closed'), exitMs);
    return () => clearTimeout(timer);
  }, [open, exitMs]);

  return open ? 'open' : state;
}
