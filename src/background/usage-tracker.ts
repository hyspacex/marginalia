import { ANTHROPIC_MODELS } from '@/shared/constants';

interface UsageRecord {
  date: string;
  inputTokens: number;
  outputTokens: number;
  requests: number;
}

export const usageTracker = {
  async recordUsage(inputTokens: number, outputTokens: number): Promise<void> {
    const today = new Date().toISOString().split('T')[0];
    const result = await chrome.storage.local.get(['totalInputTokens', 'totalOutputTokens', 'usageHistory']);

    const history: UsageRecord[] = result.usageHistory || [];
    const todayRecord = history.find((r) => r.date === today);

    if (todayRecord) {
      todayRecord.inputTokens += inputTokens;
      todayRecord.outputTokens += outputTokens;
      todayRecord.requests++;
    } else {
      history.push({ date: today, inputTokens, outputTokens, requests: 1 });
    }

    // Keep only last 30 days
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 30);
    const filtered = history.filter((r) => new Date(r.date) >= cutoff);

    await chrome.storage.local.set({
      totalInputTokens: (result.totalInputTokens || 0) + inputTokens,
      totalOutputTokens: (result.totalOutputTokens || 0) + outputTokens,
      usageHistory: filtered,
    });
  },

  async getTotals(): Promise<{ inputTokens: number; outputTokens: number; estimatedCost: number }> {
    const result = await chrome.storage.local.get(['totalInputTokens', 'totalOutputTokens', 'model']);
    const inputTokens = result.totalInputTokens || 0;
    const outputTokens = result.totalOutputTokens || 0;

    const model = ANTHROPIC_MODELS.find((m) => m.id === result.model) || ANTHROPIC_MODELS[0];
    const estimatedCost = (inputTokens * model.costPer1kInput + outputTokens * model.costPer1kOutput) / 1000;

    return { inputTokens, outputTokens, estimatedCost };
  },

  async getHistory(): Promise<UsageRecord[]> {
    const result = await chrome.storage.local.get('usageHistory');
    return result.usageHistory || [];
  },

  async reset(): Promise<void> {
    await chrome.storage.local.remove(['totalInputTokens', 'totalOutputTokens', 'usageHistory']);
  },
};
