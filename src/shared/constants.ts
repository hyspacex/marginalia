import type { ModelOption } from './types';

export const EXTENSION_NAME = 'Marginalia';

export const HIGHLIGHT_COLORS = {
  background: 'rgba(255, 200, 80, 0.15)',
  backgroundHover: 'rgba(255, 200, 80, 0.30)',
  underline: 'rgba(180, 140, 50, 0.5)',
};

export const CARD_CONFIG = {
  maxWidth: 360,
  openDelay: 300,
  closeDelay: 200,
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
export const SESSION_IDLE_TIMEOUT_MS = 30 * 60 * 1000;
export const PORT_NAME = 'marginalia-stream';
