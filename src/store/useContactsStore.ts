import { create } from 'zustand';

import { contactsService } from '@/services/contactsService';
import type {
  BirthdayOccurrence,
  CommunityContact,
  ContactListItem,
  LocalContactsPermissionStatus,
  LocalIphoneContact,
} from '@/types/contact';

interface ContactsStoreState {
  communityError: string | null;
  communityContacts: CommunityContact[];
  contactListItems: ContactListItem[];
  error: string | null;
  loadingCommunity: boolean;
  loadingLocal: boolean;
  localContacts: LocalIphoneContact[];
  localContactsPermission: LocalContactsPermissionStatus;
  upcomingBirthdays: BirthdayOccurrence[];
}

interface ContactsStoreActions {
  clearError: () => void;
  loadCommunityContacts: () => Promise<void>;
  loadLocalContacts: () => Promise<void>;
  refreshAll: () => Promise<void>;
}

type ContactsStore = ContactsStoreState & ContactsStoreActions;

function toErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'contacts_error';
}

function getDerivedState(
  communityContacts: CommunityContact[],
  localContacts: LocalIphoneContact[],
): Pick<ContactsStoreState, 'contactListItems' | 'upcomingBirthdays'> {
  return {
    contactListItems: contactsService.toContactListItems({ communityContacts, localContacts }),
    upcomingBirthdays: contactsService.getUpcomingBirthdays({ communityContacts, localContacts }),
  };
}

export const useContactsStore = create<ContactsStore>((set, get) => ({
  communityError: null,
  communityContacts: [],
  contactListItems: [],
  error: null,
  loadingCommunity: false,
  loadingLocal: false,
  localContacts: [],
  localContactsPermission: 'unknown',
  upcomingBirthdays: [],

  clearError: () => set({ communityError: null, error: null }),

  loadCommunityContacts: async () => {
    set({ communityError: null, error: null, loadingCommunity: true });

    try {
      const communityContacts = await contactsService.listCommunityContacts();
      const { localContacts } = get();
      set({
        communityError: null,
        communityContacts,
        loadingCommunity: false,
        ...getDerivedState(communityContacts, localContacts),
      });
    } catch (error) {
      const { localContacts } = get();
      set({
        communityContacts: [],
        communityError: toErrorMessage(error),
        loadingCommunity: false,
        ...getDerivedState([], localContacts),
      });
    }
  },

  loadLocalContacts: async () => {
    set({ error: null, loadingLocal: true });

    try {
      const result = await contactsService.listLocalBirthdayContacts();
      const { communityContacts } = get();
      set({
        error: result.ok ? null : result.error ?? 'local_contacts_error',
        loadingLocal: false,
        localContacts: result.contacts,
        localContactsPermission: result.permissionStatus,
        ...getDerivedState(communityContacts, result.contacts),
      });
    } catch (error) {
      set({ error: toErrorMessage(error), loadingLocal: false, localContactsPermission: 'error' });
    }
  },

  refreshAll: async () => {
    const shouldRefreshLocal = get().localContactsPermission === 'granted';
    set({
      communityError: null,
      error: null,
      loadingCommunity: true,
      loadingLocal: shouldRefreshLocal,
    });

    const [communityResult, localResult] = await Promise.allSettled([
      contactsService.listCommunityContacts(),
      shouldRefreshLocal ? contactsService.listLocalBirthdayContacts() : Promise.resolve(null),
    ]);

    const communityContacts =
      communityResult.status === 'fulfilled' ? communityResult.value : [];
    const localContacts =
      localResult.status === 'fulfilled' && localResult.value ? localResult.value.contacts : get().localContacts;
    const communityError =
      communityResult.status === 'rejected' ? toErrorMessage(communityResult.reason) : null;
    const error =
      localResult.status === 'fulfilled' && localResult.value && !localResult.value.ok
          ? localResult.value.error ?? 'local_contacts_error'
          : localResult.status === 'rejected'
            ? toErrorMessage(localResult.reason)
            : null;

    set({
      communityError,
      communityContacts,
      error,
      loadingCommunity: false,
      loadingLocal: false,
      localContacts,
      localContactsPermission:
        localResult.status === 'fulfilled' && localResult.value
          ? localResult.value.permissionStatus
          : get().localContactsPermission,
      ...getDerivedState(communityContacts, localContacts),
    });
  },
}));
