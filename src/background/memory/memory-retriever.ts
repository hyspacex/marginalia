import type { MemoryPromptFragment, ReadingGraphEntry } from '@/shared/types';
import { MEMORY_TOKEN_BUDGET } from '@/shared/constants';
import { profileManager } from './profile-manager';
import { readingGraph } from './reading-graph';
import { sessionTracker } from './session-tracker';

// Match against the stored topic vocabulary so the query and the Dexie *topics
// index share the same tag set — free-text keyword extraction never intersects
// the LLM's hyphenated tags.
export function selectRelevantStoredTopics(text: string, vocabulary: string[]): string[] {
  const lower = text.toLowerCase();
  return vocabulary
    .filter((tag) => {
      const words = tag.split('-').filter((w) => w.length > 3);
      return words.length > 0 && words.every((w) => lower.includes(w));
    })
    .slice(0, 15);
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
    const vocabulary = await readingGraph.getAllTopics();
    const topics = selectRelevantStoredTopics(text, vocabulary);

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
