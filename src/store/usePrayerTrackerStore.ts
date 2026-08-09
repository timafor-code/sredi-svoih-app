import { create } from 'zustand';

import {
  deleteAllLocalPrayerActivityHistory,
  deleteOneLocalPrayerActivity,
  loadLocalPrayerActivitySummary,
  loadMyPrayerActivity,
  recordPrayerActivity,
} from '@/services/prayerTrackerService';
import type {
  LoadPrayerActivityParams,
  PrayerActivitySummary,
  PrayerTrackerActivity,
  RecordPrayerActivityInput,
} from '@/types/prayerTracker';

type PrayerTrackerState = {
  items: PrayerTrackerActivity[];
  summary: PrayerActivitySummary | null;
  loading: boolean;
  summaryLoading: boolean;
  recording: boolean;
  deleting: boolean;
  error: string | null;
  loadMyActivity: (params?: LoadPrayerActivityParams) => Promise<void>;
  loadSummary: (
    params?: Pick<LoadPrayerActivityParams, 'fromDate' | 'toDate'>,
  ) => Promise<void>;
  recordActivity: (input: RecordPrayerActivityInput) => Promise<PrayerTrackerActivity>;
  deleteActivity: (localId: string) => Promise<void>;
  deleteAllLocalHistory: () => Promise<void>;
  clearError: () => void;
  reset: () => void;
};

let activityLoadRevision = 0;

function friendlyError(error: unknown): string {
  return error instanceof Error ? error.message : 'Не удалось обновить молитвенный трекер.';
}

function sortActivityItems(items: PrayerTrackerActivity[]): PrayerTrackerActivity[] {
  return [...items].sort((first, second) => {
    const dateCompare = second.activityDate.localeCompare(first.activityDate);

    if (dateCompare !== 0) {
      return dateCompare;
    }

    return new Date(second.createdAt).getTime() - new Date(first.createdAt).getTime();
  });
}

function upsertActivityItem(
  items: PrayerTrackerActivity[],
  activity: PrayerTrackerActivity,
): PrayerTrackerActivity[] {
  return sortActivityItems([
    activity,
    ...items.filter((item) => item.id !== activity.id),
  ]);
}

export const usePrayerTrackerStore = create<PrayerTrackerState>((set) => ({
  items: [],
  summary: null,
  loading: false,
  summaryLoading: false,
  recording: false,
  deleting: false,
  error: null,

  loadMyActivity: async (params) => {
    const requestRevision = ++activityLoadRevision;
    set({ loading: true, error: null });

    try {
      const items = await loadMyPrayerActivity(params);

      if (requestRevision !== activityLoadRevision) {
        return;
      }

      set({
        items,
        loading: false,
        error: null,
      });
    } catch (error) {
      if (requestRevision !== activityLoadRevision) {
        return;
      }

      const message = friendlyError(error);

      set({
        loading: false,
        error: message,
      });
      throw new Error(message);
    }
  },

  loadSummary: async (params) => {
    set({ summaryLoading: true });

    try {
      const summary = await loadLocalPrayerActivitySummary(params);

      set({
        summary,
        summaryLoading: false,
      });
    } catch (error) {
      const message = friendlyError(error);

      set({
        summaryLoading: false,
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

  deleteActivity: async (localId) => {
    set({ deleting: true, error: null });

    try {
      const deleted = await deleteOneLocalPrayerActivity(localId);

      if (deleted) {
        set((state) => ({
          items: state.items.filter((item) => item.id !== localId),
        }));
      }

      const summary = await loadLocalPrayerActivitySummary();

      set({
        summary,
        deleting: false,
        error: null,
      });
    } catch (error) {
      const message = friendlyError(error);

      set({ deleting: false, error: message });
      throw new Error(message);
    }
  },

  deleteAllLocalHistory: async () => {
    set({ deleting: true, error: null });

    try {
      await deleteAllLocalPrayerActivityHistory();
      set({ items: [] });

      const summary = await loadLocalPrayerActivitySummary();

      set({
        summary,
        deleting: false,
        error: null,
      });
    } catch (error) {
      const message = friendlyError(error);

      set({ deleting: false, error: message });
      throw new Error(message);
    }
  },

  clearError: () => set({ error: null }),

  reset: () => {
    activityLoadRevision += 1;
    set({
      items: [],
      summary: null,
      loading: false,
      summaryLoading: false,
      recording: false,
      deleting: false,
      error: null,
    });
  },
}));
