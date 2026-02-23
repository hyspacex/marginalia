import Dexie, { type Table } from 'dexie';
import type { ReadingGraphEntry, Annotation } from '@/shared/types';

class ReadingGraphDB extends Dexie {
  pages!: Table<ReadingGraphEntry, number>;

  constructor() {
    super('marginalia-reading-graph');

    this.version(1).stores({
      pages: '++id, url, domain, readAt, *topics',
    });
  }
}

const db = new ReadingGraphDB();

export const readingGraph = {
  async addEntry(entry: Omit<ReadingGraphEntry, 'id'>): Promise<number> {
    return db.pages.add(entry as ReadingGraphEntry);
  },

  async getByUrl(url: string): Promise<ReadingGraphEntry | undefined> {
    return db.pages.where('url').equals(url).first();
  },

  async getByDomain(domain: string, limit = 10): Promise<ReadingGraphEntry[]> {
    return db.pages.where('domain').equals(domain).limit(limit).toArray();
  },

  async findByTopics(topics: string[], limit = 5): Promise<ReadingGraphEntry[]> {
    if (topics.length === 0) return [];

    // Use Dexie multi-entry index to find entries matching any topic
    const matches = await db.pages
      .where('topics')
      .anyOf(topics)
      .toArray();

    // Score by overlap count and sort
    const scored = new Map<number, { entry: ReadingGraphEntry; score: number }>();
    for (const entry of matches) {
      const id = entry.id!;
      const existing = scored.get(id);
      if (existing) {
        existing.score++;
      } else {
        const overlap = entry.topics.filter((t) => topics.includes(t)).length;
        scored.set(id, { entry, score: overlap });
      }
    }

    return Array.from(scored.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((s) => s.entry);
  },

  async getRecent(limit = 20): Promise<ReadingGraphEntry[]> {
    return db.pages.orderBy('readAt').reverse().limit(limit).toArray();
  },

  async getAll(): Promise<ReadingGraphEntry[]> {
    return db.pages.toArray();
  },

  async getCount(): Promise<number> {
    return db.pages.count();
  },

  async getAllTopics(): Promise<string[]> {
    const all = await db.pages.toArray();
    const topicSet = new Set<string>();
    for (const entry of all) {
      for (const t of entry.topics) topicSet.add(t);
    }
    return Array.from(topicSet).sort();
  },

  async deleteEntry(id: number): Promise<void> {
    await db.pages.delete(id);
  },

  async clear(): Promise<void> {
    await db.pages.clear();
  },
};
