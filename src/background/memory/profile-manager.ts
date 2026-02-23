import type { ReaderProfile } from '@/shared/types';

const DEFAULT_PROFILE: ReaderProfile = {
  expertise: {},
  interests: [],
  annotationPreferences: {
    defaultModes: ['close-reading', 'context', 'devil-advocate'],
    depth: 'detailed',
    tone: 'collegial',
  },
  readingGoals: [],
  updatedAt: new Date().toISOString(),
};

export const profileManager = {
  async getProfile(): Promise<ReaderProfile> {
    const result = await chrome.storage.local.get('readerProfile');
    return result.readerProfile || { ...DEFAULT_PROFILE };
  },

  async saveProfile(profile: ReaderProfile): Promise<void> {
    profile.updatedAt = new Date().toISOString();
    await chrome.storage.local.set({ readerProfile: profile });
  },

  async resetProfile(): Promise<void> {
    await chrome.storage.local.set({ readerProfile: { ...DEFAULT_PROFILE } });
  },
};
