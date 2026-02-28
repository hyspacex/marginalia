import type { Annotation, SessionState, UserInteraction } from '@/shared/types';
import { SESSION_IDLE_TIMEOUT_MS } from '@/shared/constants';

const sessions = new Map<number, SessionState>();

export const sessionTracker = {
  startSession(tabId: number, url: string, title: string) {
    const existing = sessions.get(tabId);
    if (existing && existing.url === url) {
      existing.lastActiveAt = Date.now();
      return;
    }

    sessions.set(tabId, {
      tabId,
      url,
      title,
      annotations: [],
      interactions: [],
      startedAt: Date.now(),
      lastActiveAt: Date.now(),
    });
  },

  getSession(tabId: number): SessionState | undefined {
    return sessions.get(tabId);
  },

  addAnnotation(tabId: number, annotation: Annotation) {
    const session = sessions.get(tabId);
    if (session) {
      session.annotations.push(annotation);
      session.lastActiveAt = Date.now();
    }
  },

  recordInteraction(tabId: number, interaction: UserInteraction) {
    const session = sessions.get(tabId);
    if (session) {
      session.interactions.push(interaction);
      session.lastActiveAt = Date.now();
    }
  },

  endSession(tabId: number): SessionState | undefined {
    const session = sessions.get(tabId);
    sessions.delete(tabId);
    return session;
  },

  isIdle(tabId: number): boolean {
    const session = sessions.get(tabId);
    if (!session) return true;
    return Date.now() - session.lastActiveAt > SESSION_IDLE_TIMEOUT_MS;
  },

  getAllSessions(): SessionState[] {
    return Array.from(sessions.values());
  },
};
