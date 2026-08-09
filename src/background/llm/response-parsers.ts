import type { Annotation, ContentType, ProviderId, ReaderProfile, SummarySection } from '@/shared/types';
import { ProviderError } from './provider';

const EXPERTISE_LEVELS = new Set(['beginner', 'intermediate', 'advanced']);
const DEPTH_LEVELS = new Set(['brief', 'detailed']);
const TONE_LEVELS = new Set(['academic', 'collegial', 'casual']);

export function createAnnotationStreamParser(deps: {
  now: () => number;
  generateId: () => string;
}) {
  let buffer = '';

  return {
    push(delta: string): Annotation[] {
      buffer += delta;
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      return lines
        .map((line) => parseAnnotationLine(line, deps))
        .filter((annotation): annotation is Annotation => annotation !== null);
    },

    flush(): Annotation[] {
      if (!buffer.trim()) {
        return [];
      }

      const annotation = parseAnnotationLine(buffer, deps);
      buffer = '';
      return annotation ? [annotation] : [];
    },
  };
}

const CONTENT_TYPES = new Set<string>([
  'news-report',
  'opinion-analysis',
  'technical-blog',
  'research-paper',
  'other',
]);

export interface SummaryStreamHandlers {
  onMeta?: (contentType: ContentType) => void;
  onSection?: (section: SummarySection) => void;
  onGraph?: (graph: { keyClaims: string[]; topics: string[] }) => void;
}

// Line-buffered JSONL parser for the structured summary stream; malformed
// lines are dropped, mirroring the annotation stream's tolerance.
export function createSummaryStreamParser(handlers: SummaryStreamHandlers) {
  function handleLine(line: string) {
    const trimmed = line.trim();
    if (!trimmed || !trimmed.startsWith('{')) return;

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      return;
    }

    if (parsed.kind === 'meta' && typeof parsed.contentType === 'string' && CONTENT_TYPES.has(parsed.contentType)) {
      handlers.onMeta?.(parsed.contentType as ContentType);
    } else if (
      parsed.kind === 'section' &&
      typeof parsed.id === 'string' &&
      typeof parsed.heading === 'string' &&
      typeof parsed.markdown === 'string' &&
      parsed.markdown.trim() !== ''
    ) {
      handlers.onSection?.({ id: parsed.id, heading: parsed.heading, markdown: parsed.markdown });
    } else if (parsed.kind === 'graph' && isStringArray(parsed.keyClaims) && isStringArray(parsed.topics)) {
      handlers.onGraph?.({ keyClaims: parsed.keyClaims, topics: parsed.topics });
    }
  }

  let buffer = '';

  return {
    push(delta: string) {
      buffer += delta;
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) handleLine(line);
    },

    flush() {
      if (!buffer.trim()) {
        buffer = '';
        return;
      }
      // The final line often lacks its trailing newline; recover a complete
      // object from the residue with the brace scanner.
      const jsonText = extractFirstJsonObject(buffer);
      buffer = '';
      if (jsonText) handleLine(jsonText);
    },
  };
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

export function parseReaderProfile(text: string, now: () => number, providerId: ProviderId): ReaderProfile {
  const parsed = parseJsonObject(text, 'profile', providerId);

  const expertise = parsed.expertise;
  const annotationPreferences = parsed.annotationPreferences;

  if (
    !isStringRecord(expertise) ||
    !Object.values(expertise).every((value) => EXPERTISE_LEVELS.has(value)) ||
    !Array.isArray(parsed.interests) ||
    !parsed.interests.every((entry: unknown) => typeof entry === 'string') ||
    typeof annotationPreferences !== 'object' ||
    annotationPreferences === null ||
    !DEPTH_LEVELS.has((annotationPreferences as Record<string, unknown>).depth as string) ||
    !TONE_LEVELS.has((annotationPreferences as Record<string, unknown>).tone as string) ||
    !Array.isArray(parsed.readingGoals) ||
    !parsed.readingGoals.every((entry: unknown) => typeof entry === 'string')
  ) {
    throw new ProviderError(providerId, 'protocol', 'Profile response did not match the expected shape');
  }

  return {
    expertise: expertise as ReaderProfile['expertise'],
    interests: parsed.interests,
    annotationPreferences: {
      depth: annotationPreferences.depth as ReaderProfile['annotationPreferences']['depth'],
      tone: annotationPreferences.tone as ReaderProfile['annotationPreferences']['tone'],
    },
    readingGoals: parsed.readingGoals,
    updatedAt: new Date(now()).toISOString(),
  };
}

function parseAnnotationLine(
  line: string,
  deps: { now: () => number; generateId: () => string },
): Annotation | null {
  const trimmed = line.trim();
  if (!trimmed || !trimmed.startsWith('{')) {
    return null;
  }

  try {
    const parsed = JSON.parse(trimmed);
    if (typeof parsed.anchor !== 'string' || typeof parsed.content !== 'string') {
      return null;
    }

    return {
      id: deps.generateId(),
      anchor: parsed.anchor,
      content: parsed.content,
      timestamp: deps.now(),
    };
  } catch {
    return null;
  }
}

function parseJsonObject(text: string, label: string, providerId: ProviderId): Record<string, any> {
  const jsonText = extractFirstJsonObject(text);
  if (!jsonText) {
    throw new ProviderError(providerId, 'protocol', `No JSON object found in ${label} response`);
  }

  try {
    return JSON.parse(jsonText);
  } catch {
    throw new ProviderError(providerId, 'protocol', `Invalid JSON in ${label} response`);
  }
}

function extractFirstJsonObject(text: string): string | null {
  let depth = 0;
  let inString = false;
  let escaped = false;
  let start = -1;

  for (let index = 0; index < text.length; index++) {
    const char = text[index];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === '\\') {
      escaped = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      continue;
    }

    if (inString) {
      continue;
    }

    if (char === '{') {
      if (depth === 0) {
        start = index;
      }
      depth++;
    } else if (char === '}') {
      depth--;
      if (depth === 0 && start >= 0) {
        return text.slice(start, index + 1);
      }
    }
  }

  return null;
}

function isStringRecord(value: unknown): value is Record<string, string> {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  return Object.values(value).every((entry) => typeof entry === 'string');
}
