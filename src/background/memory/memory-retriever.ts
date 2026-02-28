import type { MemoryPromptFragment, ReadingGraphEntry } from '@/shared/types';
import { MEMORY_TOKEN_BUDGET } from '@/shared/constants';
import { profileManager } from './profile-manager';
import { readingGraph } from './reading-graph';
import { sessionTracker } from './session-tracker';

function extractTopicsFromText(text: string): string[] {
  // Simple keyword extraction: find common topic-like words
  const words = text.toLowerCase().split(/\W+/).filter((w) => w.length > 4);
  const freq = new Map<string, number>();
  for (const w of words) {
    freq.set(w, (freq.get(w) || 0) + 1);
  }
  return Array.from(freq.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([word]) => word);
}

function formatReadingHistory(entries: ReadingGraphEntry[]): string {
  if (entries.length === 0) return '';

  return entries
    .map((e) => {
      let text = `- "${e.title}" (${e.domain}, ${new Date(e.readAt).toLocaleDateString()})`;
      if (e.summary) text += `\n  Summary: ${e.summary}`;
      if (e.keyClaims.length > 0) text += `\n  Key claims: ${e.keyClaims.join('; ')}`;
      return text;
    })
    .join('\n');
}

function formatSessionContext(tabId: number): string {
  const sessions = sessionTracker.getAllSessions();
  const session = sessions.find((s) => s.tabId === tabId);
  if (!session) return '';

  const parts = [`Current page: ${session.title} (${session.url})`];
  parts.push(`Annotations so far: ${session.annotations.length}`);

  if (session.interactions.length > 0) {
    const recent = session.interactions.slice(-5);
    parts.push(`Recent interactions: ${recent.map((i) => i.type).join(', ')}`);
  }

  return parts.join('\n');
}

export async function getMemoryContext(
  url: string,
  _title: string,
  text: string,
  tabId?: number,
): Promise<MemoryPromptFragment> {
  const fragment: MemoryPromptFragment = {};

  // Layer 1: Reader profile
  const profile = await profileManager.getProfile();
  if (profile && (profile.interests.length > 0 || Object.keys(profile.expertise).length > 0)) {
    fragment.profile = JSON.stringify(profile, null, 2);
  }

  // Layer 2: Reading graph — find related entries
  try {
    const domain = new URL(url).hostname;
    const topics = extractTopicsFromText(text);

    const [topicMatches, domainMatches] = await Promise.all([
      readingGraph.findByTopics(topics, 3),
      readingGraph.getByDomain(domain, 2),
    ]);

    // Merge and dedupe
    const seen = new Set<number>();
    const related: ReadingGraphEntry[] = [];
    for (const entry of [...topicMatches, ...domainMatches]) {
      if (entry.id && !seen.has(entry.id) && entry.url !== url) {
        seen.add(entry.id);
        related.push(entry);
      }
    }

    if (related.length > 0) {
      const history = formatReadingHistory(related.slice(0, 5));
      fragment.readingHistory = history;
    }
  } catch {
    // Skip reading graph if it fails
  }

  // Layer 3: Session context
  if (tabId) {
    const ctx = formatSessionContext(tabId);
    if (ctx) fragment.sessionContext = ctx;
  }

  return fragment;
}
