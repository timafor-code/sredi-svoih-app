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
let summaryLoadRevision = 0;

function invalidateHistoryReads(): void {
  activityLoadRevision += 1;
  summaryLoadRevision += 1;
}

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
    const requestRevision = ++summaryLoadRevision;
    set({ summaryLoading: true });

    try {
      const summary = await loadLocalPrayerActivitySummary(params);

      if (requestRevision !== summaryLoadRevision) {
        return;
      }

      set({
        summary,
        summaryLoading: false,
      });
    } catch (error) {
      if (requestRevision !== summaryLoadRevision) {
        return;
      }

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
    let deleted = false;

    invalidateHistoryReads();
    set({
      deleting: true,
      loading: false,
      summaryLoading: false,
      error: null,
    });

    try {
      deleted = await deleteOneLocalPrayerActivity(localId);

      invalidateHistoryReads();

      if (deleted) {
        set((state) => ({
          items: state.items.filter((item) => item.id !== localId),
          loading: false,
          summaryLoading: false,
        }));
      }

      const summary = await loadLocalPrayerActivitySummary();

      invalidateHistoryReads();
      set((state) => ({
        items: deleted
          ? state.items.filter((item) => item.id !== localId)
          : state.items,
        summary,
        deleting: false,
        loading: false,
        summaryLoading: false,
        error: null,
      }));
    } catch (error) {
      invalidateHistoryReads();
      const message = friendlyError(error);

      set((state) => ({
        items: deleted
          ? state.items.filter((item) => item.id !== localId)
          : state.items,
        deleting: false,
        loading: false,
        summaryLoading: false,
        error: message,
      }));
      throw new Error(message);
    }
  },

  deleteAllLocalHistory: async () => {
    let deletionCommitted = false;

    invalidateHistoryReads();
    set({
      deleting: true,
      loading: false,
      summaryLoading: false,
      error: null,
    });

    try {
      await deleteAllLocalPrayerActivityHistory();
      deletionCommitted = true;

      invalidateHistoryReads();
      set({
        items: [],
        loading: false,
        summaryLoading: false,
      });

      const summary = await loadLocalPrayerActivitySummary();

      invalidateHistoryReads();
      set({
        items: [],
        summary,
        deleting: false,
        loading: false,
        summaryLoading: false,
        error: null,
      });
    } catch (error) {
      invalidateHistoryReads();
      const message = friendlyError(error);

      set((state) => ({
        items: deletionCommitted ? [] : state.items,
        deleting: false,
        loading: false,
        summaryLoading: false,
        error: message,
      }));
      throw new Error(message);
    }
  },

  clearError: () => set({ error: null }),

  reset: () => {
    invalidateHistoryReads();
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
