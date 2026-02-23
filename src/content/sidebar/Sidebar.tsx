import { useState, useEffect, useCallback } from 'preact/hooks';
import type { Annotation, AnnotationMode, TokenUsage } from '@/shared/types';
import { DEFAULT_MODES, PORT_NAME } from '@/shared/constants';
import { ModeSelector } from './ModeSelector';
import { AnnotationCard } from './AnnotationCard';
import { extractPageContent } from '../extraction/readability';

interface SidebarProps {
  onClose: () => void;
}

export function Sidebar({ onClose }: SidebarProps) {
  const [activeModes, setActiveModes] = useState<AnnotationMode[]>([...DEFAULT_MODES]);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [usage, setUsage] = useState<TokenUsage | null>(null);

  const toggleMode = useCallback((mode: AnnotationMode) => {
    setActiveModes((prev) =>
      prev.includes(mode) ? prev.filter((m) => m !== mode) : [...prev, mode]
    );
  }, []);

  const handleAnnotate = useCallback(() => {
    if (activeModes.length === 0) return;

    const content = extractPageContent();
    if (!content) {
      setError('Could not extract page content');
      return;
    }

    setLoading(true);
    setError(null);
    setAnnotations([]);
    setUsage(null);

    const port = chrome.runtime.connect({ name: PORT_NAME });

    port.postMessage({
      type: 'START_ANNOTATE',
      payload: {
        url: content.url,
        title: content.title,
        text: content.content,
        modes: activeModes,
      },
    });

    port.onMessage.addListener((msg) => {
      switch (msg.type) {
        case 'ANNOTATION_CHUNK':
          setAnnotations((prev) => [...prev, msg.payload.annotation]);
          break;
        case 'STREAM_DONE':
          setUsage(msg.payload.usage);
          setLoading(false);
          port.disconnect();
          break;
        case 'STREAM_ERROR':
          setError(msg.payload.message);
          setLoading(false);
          port.disconnect();
          break;
      }
    });

    port.onDisconnect.addListener(() => {
      setLoading(false);
    });
  }, [activeModes]);

  // Listen for selection-based annotation events
  useEffect(() => {
    const handleSelectionAnnotation = (e: Event) => {
      const detail = (e as CustomEvent).detail as {
        selectedText: string;
        modes: AnnotationMode[];
      };

      const content = extractPageContent();
      if (!content) return;

      setLoading(true);
      setError(null);
      setAnnotations([]);
      setUsage(null);

      const port = chrome.runtime.connect({ name: PORT_NAME });

      port.postMessage({
        type: 'START_ANNOTATE',
        payload: {
          url: content.url,
          title: content.title,
          text: content.content,
          selectedText: detail.selectedText,
          modes: detail.modes,
        },
      });

      port.onMessage.addListener((msg) => {
        switch (msg.type) {
          case 'ANNOTATION_CHUNK':
            setAnnotations((prev) => [...prev, msg.payload.annotation]);
            break;
          case 'STREAM_DONE':
            setUsage(msg.payload.usage);
            setLoading(false);
            port.disconnect();
            break;
          case 'STREAM_ERROR':
            setError(msg.payload.message);
            setLoading(false);
            port.disconnect();
            break;
        }
      });
    };

    window.addEventListener('marginalia:annotate-selection', handleSelectionAnnotation);
    return () => window.removeEventListener('marginalia:annotate-selection', handleSelectionAnnotation);
  }, []);

  const estimatedCost = usage
    ? ((usage.inputTokens * 0.003 + usage.outputTokens * 0.015) / 1000).toFixed(4)
    : null;

  return (
    <div class="sidebar">
      <div class="sidebar-header">
        <span class="sidebar-title">Marginalia</span>
        <div class="sidebar-actions">
          <button class="sidebar-btn" onClick={onClose} title="Close">
            \u2715
          </button>
        </div>
      </div>

      <ModeSelector activeModes={activeModes} onToggleMode={toggleMode} />

      <div class="annotate-section">
        <button
          class="annotate-btn"
          onClick={handleAnnotate}
          disabled={loading || activeModes.length === 0}
        >
          {loading ? 'Annotating...' : 'Annotate this page'}
        </button>
      </div>

      <div class="annotation-list">
        {error && <div class="error-banner">{error}</div>}

        {annotations.map((ann) => (
          <AnnotationCard key={ann.id} annotation={ann} />
        ))}

        {loading && (
          <div class="loading-indicator">
            <div class="loading-spinner" />
            <span>Generating annotations...</span>
          </div>
        )}

        {!loading && annotations.length === 0 && !error && (
          <div class="empty-state">
            <p>Click "Annotate this page" to generate annotations</p>
          </div>
        )}
      </div>

      {usage && (
        <div class="sidebar-footer">
          Tokens: {(usage.inputTokens + usage.outputTokens).toLocaleString()} &middot; ~${estimatedCost}
        </div>
      )}
    </div>
  );
}
