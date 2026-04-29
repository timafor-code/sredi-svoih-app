import { create } from 'zustand';

import {
  loadMyPrayerActivity,
  recordPrayerActivity,
} from '@/services/prayerTrackerService';
import type {
  LoadPrayerActivityParams,
  PrayerActivityLog,
  RecordPrayerActivityInput,
} from '@/types/prayerTracker';

type PrayerTrackerState = {
  items: PrayerActivityLog[];
  loading: boolean;
  recording: boolean;
  error: string | null;
  loadMyActivity: (params?: LoadPrayerActivityParams) => Promise<void>;
  recordActivity: (input: RecordPrayerActivityInput) => Promise<PrayerActivityLog>;
  clearError: () => void;
  reset: () => void;
};

function friendlyError(error: unknown): string {
  return error instanceof Error ? error.message : 'Не удалось обновить молитвенный трекер.';
}

function sortActivityItems(items: PrayerActivityLog[]): PrayerActivityLog[] {
  return [...items].sort((first, second) => {
    const dateCompare = second.activityDate.localeCompare(first.activityDate);

    if (dateCompare !== 0) {
      return dateCompare;
    }

    return new Date(second.createdAt).getTime() - new Date(first.createdAt).getTime();
  });
}

function upsertActivityItem(
  items: PrayerActivityLog[],
  activity: PrayerActivityLog,
): PrayerActivityLog[] {
  return sortActivityItems([
    activity,
    ...items.filter((item) => item.id !== activity.id),
  ]);
}

export const usePrayerTrackerStore = create<PrayerTrackerState>((set) => ({
  items: [],
  loading: false,
  recording: false,
  error: null,

  loadMyActivity: async (params) => {
    set({ loading: true, error: null });

    try {
      const items = await loadMyPrayerActivity(params);

      set({
        items,
        loading: false,
        error: null,
      });
    } catch (error) {
      const message = friendlyError(error);

      set({
        loading: false,
        error: message,
      });
      throw new Error(message);
    }
  },

  recordActivity: async (input) => {
    set({ recording: true, error: null });

    try {
      const activity = await recordPrayerActivity(input);

      set((state) => ({
        items: upsertActivityItem(state.items, activity),
        recording: false,
        error: null,
      }));

      return activity;
    } catch (error) {
      const message = friendlyError(error);

      set({ recording: false, error: message });
      throw new Error(message);
    }
  },

  clearError: () => set({ error: null }),

  reset: () => set({
    items: [],
    loading: false,
    recording: false,
    error: null,
  }),
}));
