import type { AnnotationMode, ModelOption } from './types';

export const EXTENSION_NAME = 'Marginalia';

export const SIDEBAR_WIDTH = 380;

export const DEFAULT_MODES: AnnotationMode[] = ['close-reading', 'context', 'devil-advocate'];

export const MODE_LABELS: Record<AnnotationMode, string> = {
  'close-reading': 'Close Reading',
  'context': 'Context',
  'devil-advocate': "Devil's Advocate",
};

export const MODE_COLORS: Record<AnnotationMode, string> = {
  'close-reading': '#6366f1',
  'context': '#0891b2',
  'devil-advocate': '#dc2626',
};

export const MODE_ICONS: Record<AnnotationMode, string> = {
  'close-reading': '\u{1F4D6}',
  'context': '\u{1F30D}',
  'devil-advocate': '\u{1F525}',
};

export const ANTHROPIC_MODELS: ModelOption[] = [
  {
    id: 'claude-sonnet-4-5-20250929',
    name: 'Claude Sonnet 4.5',
    contextWindow: 200000,
    costPer1kInput: 0.003,
    costPer1kOutput: 0.015,
  },
  {
    id: 'claude-haiku-3-5-20241022',
    name: 'Claude Haiku 3.5',
    contextWindow: 200000,
    costPer1kInput: 0.0008,
    costPer1kOutput: 0.004,
  },
];

export const DEFAULT_ANTHROPIC_CONFIG = {
  baseUrl: 'https://api.anthropic.com',
  model: 'claude-sonnet-4-5-20250929',
};

export const MEMORY_TOKEN_BUDGET = 1000;

export const SESSION_IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

export const PORT_NAME = 'marginalia-stream';
