import type { ProviderId } from '@/shared/types';

export interface UsageRecord {
  date: string;
  providerId: ProviderId;
  modelId: string;
  inputTokens: number;
  outputTokens: number;
  estimatedCost: number;
  unpricedRequests: number;
  requests: number;
}

export interface UsageTotals {
  inputTokens: number;
  outputTokens: number;
  estimatedCost: number | null;
}

interface UsageSummary extends UsageTotals {
  estimatedCost: number;
  unpricedRequests: number;
}

interface RecordUsageInput {
  providerId: ProviderId;
  modelId: string;
  inputTokens: number;
  outputTokens: number;
  estimatedCost: number | null;
}

const TOTAL_INPUT_KEY = 'totalInputTokens';
const TOTAL_OUTPUT_KEY = 'totalOutputTokens';
const TOTAL_ESTIMATED_COST_KEY = 'totalEstimatedCost';
const TOTAL_UNPRICED_REQUESTS_KEY = 'totalUnpricedRequests';
const USAGE_HISTORY_KEY = 'usageHistory';

function coerceHistory(value: unknown): UsageRecord[] {
  if (!Array.isArray(value)) return [];

  return value.filter((entry): entry is UsageRecord => {
    return typeof entry?.date === 'string'
      && (entry.providerId === 'anthropic' || entry.providerId === 'openai')
      && typeof entry.modelId === 'string'
      && typeof entry.inputTokens === 'number'
      && typeof entry.outputTokens === 'number'
      && typeof entry.estimatedCost === 'number'
      && typeof entry.unpricedRequests === 'number'
      && typeof entry.requests === 'number';
  });
}

function toDisplayTotals(summary: UsageSummary): UsageTotals {
  return {
    inputTokens: summary.inputTokens,
    outputTokens: summary.outputTokens,
    estimatedCost: summary.unpricedRequests > 0 ? null : summary.estimatedCost,
  };
}

export const usageTracker = {
  async recordUsage(input: RecordUsageInput): Promise<void> {
    const today = new Date().toISOString().split('T')[0];
    const result = await chrome.storage.local.get([
      TOTAL_INPUT_KEY,
      TOTAL_OUTPUT_KEY,
      TOTAL_ESTIMATED_COST_KEY,
      TOTAL_UNPRICED_REQUESTS_KEY,
      USAGE_HISTORY_KEY,
    ]);

    const history = coerceHistory(result[USAGE_HISTORY_KEY]);
    const todayRecord = history.find((entry) =>
      entry.date === today
      && entry.providerId === input.providerId
      && entry.modelId === input.modelId,
    );

    if (todayRecord) {
      todayRecord.inputTokens += input.inputTokens;
      todayRecord.outputTokens += input.outputTokens;
      todayRecord.requests += 1;
      if (input.estimatedCost == null) {
        todayRecord.unpricedRequests += 1;
      } else {
        todayRecord.estimatedCost += input.estimatedCost;
      }
    } else {
      history.push({
        date: today,
        providerId: input.providerId,
        modelId: input.modelId,
        inputTokens: input.inputTokens,
        outputTokens: input.outputTokens,
        estimatedCost: input.estimatedCost ?? 0,
        unpricedRequests: input.estimatedCost == null ? 1 : 0,
        requests: 1,
      });
    }

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 30);
    const filteredHistory = history.filter((entry) => new Date(entry.date) >= cutoff);

    await chrome.storage.local.set({
      [TOTAL_INPUT_KEY]: (result[TOTAL_INPUT_KEY] || 0) + input.inputTokens,
      [TOTAL_OUTPUT_KEY]: (result[TOTAL_OUTPUT_KEY] || 0) + input.outputTokens,
      [TOTAL_ESTIMATED_COST_KEY]: (result[TOTAL_ESTIMATED_COST_KEY] || 0) + (input.estimatedCost ?? 0),
      [TOTAL_UNPRICED_REQUESTS_KEY]: (result[TOTAL_UNPRICED_REQUESTS_KEY] || 0) + (input.estimatedCost == null ? 1 : 0),
      [USAGE_HISTORY_KEY]: filteredHistory,
    });
  },

  async getTotals(): Promise<UsageTotals> {
    const result = await chrome.storage.local.get([
      TOTAL_INPUT_KEY,
      TOTAL_OUTPUT_KEY,
      TOTAL_ESTIMATED_COST_KEY,
      TOTAL_UNPRICED_REQUESTS_KEY,
    ]);

    return toDisplayTotals({
      inputTokens: result[TOTAL_INPUT_KEY] || 0,
      outputTokens: result[TOTAL_OUTPUT_KEY] || 0,
      estimatedCost: result[TOTAL_ESTIMATED_COST_KEY] || 0,
      unpricedRequests: result[TOTAL_UNPRICED_REQUESTS_KEY] || 0,
    });
  },

  async getHistory(): Promise<UsageRecord[]> {
    const result = await chrome.storage.local.get(USAGE_HISTORY_KEY);
    return coerceHistory(result[USAGE_HISTORY_KEY]);
  },

  async reset(): Promise<void> {
    await chrome.storage.local.remove([
      TOTAL_INPUT_KEY,
      TOTAL_OUTPUT_KEY,
      TOTAL_ESTIMATED_COST_KEY,
      TOTAL_UNPRICED_REQUESTS_KEY,
      USAGE_HISTORY_KEY,
    ]);
  },
};
