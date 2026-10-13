import { useEffect, useState } from 'preact/hooks';
import type { ContentType, SummarySection } from '@/shared/types';
import { renderMarkdownToHtml } from '../render/markdown';
import { usePresence } from '../render/use-presence';

const CONTENT_TYPE_LABELS: Record<ContentType, string> = {
  'news-report': 'News',
  'opinion-analysis': 'Opinion',
  'technical-blog': 'Technical',
  'research-paper': 'Research',
  'discussion-thread': 'Discussion',
  'reference-docs': 'Reference',
  'other': 'Article',
};

// Matches the .is-closing animation duration in inline.css
const SUMMARY_EXIT_MS = 350;

const THINKING_BEFORE_FIRST = ['Reading the page', 'Finding the core claim', 'Drafting the summary'];
const THINKING_AFTER_FIRST = ['Writing the next section', 'Checking what is new to you'];
const THINKING_HOLD_MS = 2200;

interface SummaryCardProps {
  sections: SummarySection[];
  contentType: ContentType | null;
  error: string | null;
  loading: boolean;
  visible: boolean;
  quickAddHost: string | null;
  quickAddAdded: boolean;
  onQuickAdd: () => void;
  onAdjustFont: (direction: 1 | -1) => void;
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
  onAdjustFont,
  onMouseEnter,
  onMouseLeave,
  onClose,
}: SummaryCardProps) {
  const hasContent = loading || sections.length > 0 || error !== null;
  const presence = usePresence(hasContent && visible, SUMMARY_EXIT_MS);
  if (presence === 'closed') return null;

  const style = contentType
    ? { '--m-type-accent': `var(--m-type-${contentType})` }
    : undefined;

  return (
    <div
      class={`marginalia-summary is-${presence}`}
      style={style}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <div class="marginalia-summary-header">
        <span class="marginalia-summary-mark" aria-hidden="true" />
        <span class="marginalia-summary-label">Summary</span>
        {contentType && (
          <span class="marginalia-summary-badge" key={contentType}>
            {CONTENT_TYPE_LABELS[contentType]}
          </span>
        )}
        <span class="marginalia-summary-tools">
          <button
            class="marginalia-icon-btn marginalia-font-btn"
            title="Smaller text"
            onClick={() => onAdjustFont(-1)}
          >
            A<span class="marginalia-font-sign">−</span>
          </button>
          <button
            class="marginalia-icon-btn marginalia-font-btn is-large"
            title="Larger text"
            onClick={() => onAdjustFont(1)}
          >
            A<span class="marginalia-font-sign">+</span>
          </button>
          <button
            class="marginalia-icon-btn"
            onClick={onClose}
            title="Close summary"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
              <path d="M2.5 2.5l7 7M9.5 2.5l-7 7" />
            </svg>
          </button>
        </span>
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
            <ThinkingLine
              phrases={sections.length === 0 ? THINKING_BEFORE_FIRST : THINKING_AFTER_FIRST}
            />
          )}
        </div>
      )}
      {quickAddHost && error === null && (
        <div class="marginalia-summary-footer">
          {quickAddAdded ? (
            <span class="marginalia-quickadd-on">
              <span class="marginalia-check" aria-hidden="true">
                <svg width="14" height="14" viewBox="0 0 14 14">
                  <path d="M3 7.4l2.6 2.6L11 4.4" />
                </svg>
              </span>
              Auto-summarize is on for {quickAddHost}
            </span>
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

/** Shimmering status line that steps through phrases while the summary streams. */
function ThinkingLine({ phrases }: { phrases: string[] }) {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    setIndex(0);
    if (phrases.length < 2) return;
    const timer = setInterval(() => {
      setIndex((current) => Math.min(current + 1, phrases.length - 1));
    }, THINKING_HOLD_MS);
    return () => clearInterval(timer);
  }, [phrases]);

  const phrase = phrases[index];

  return (
    <div class="marginalia-thinking" role="status">
      <span class="marginalia-thinking-dot" aria-hidden="true" />
      <span class="marginalia-thinking-text" key={phrase} data-text={`${phrase}…`}>
        {phrase}…
      </span>
    </div>
  );
}
