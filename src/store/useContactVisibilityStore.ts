import { create } from 'zustand';

import {
  getMyContactVisibility,
  upsertMyContactVisibility,
} from '@/services/contactVisibilityService';
import type {
  ContactVisibilityUpdateInput,
  ProfileContactVisibility,
} from '@/types/contact';

type ContactVisibilityPatch = Partial<ContactVisibilityUpdateInput>;

interface ContactVisibilityStoreState {
  error: string | null;
  loaded: boolean;
  loading: boolean;
  saving: boolean;
  visibility: ProfileContactVisibility | null;
}

interface ContactVisibilityStoreActions {
  clearError: () => void;
  loadVisibility: () => Promise<void>;
  updateVisibility: (patch: ContactVisibilityPatch) => Promise<void>;
}

type ContactVisibilityStore = ContactVisibilityStoreState & ContactVisibilityStoreActions;

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'contact_visibility_error';
}

function toUpdateInput(visibility: ProfileContactVisibility): ContactVisibilityUpdateInput {
  return {
    birthdayRemindersEnabled: visibility.birthdayRemindersEnabled,
    shareBirthDate: visibility.shareBirthDate,
    shareCity: visibility.shareCity,
    shareEmail: visibility.shareEmail,
    shareHebrewBirthDate: visibility.shareHebrewBirthDate,
    shareHebrewName: visibility.shareHebrewName,
    sharePhone: visibility.sharePhone,
    showInCommunityDirectory: visibility.showInCommunityDirectory,
  };
}

export const useContactVisibilityStore = create<ContactVisibilityStore>((set, get) => ({
  error: null,
  loaded: false,
  loading: false,
  saving: false,
  visibility: null,

  clearError: () => set({ error: null }),

  loadVisibility: async () => {
    set({ error: null, loading: true });

    try {
      const visibility = await getMyContactVisibility();

      set({
        error: null,
        loaded: true,
        loading: false,
        visibility,
      });
    } catch (error) {
      set({
        error: toErrorMessage(error),
        loaded: true,
        loading: false,
        visibility: null,
      });
    }
  },

  updateVisibility: async (patch) => {
    const currentVisibility = get().visibility;

    if (!currentVisibility) {
      set({ error: 'contact_visibility_not_loaded' });
      return;
    }

    set({ error: null, saving: true });

    try {
      const visibility = await upsertMyContactVisibility({
        ...toUpdateInput(currentVisibility),
        ...patch,
      });

      set({
        error: null,
        loaded: true,
        saving: false,
        visibility,
      });
    } catch (error) {
      set({
        error: toErrorMessage(error),
        saving: false,
        visibility: currentVisibility,
      });
    }
  },
}));
