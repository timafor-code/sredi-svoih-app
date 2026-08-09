import { create } from 'zustand';

import { appCapabilities } from '@/config/appCapabilities';
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
  resetCommunityContacts: () => void;
}

type ContactsStore = ContactsStoreState & ContactsStoreActions;
let communityRequestRevision = 0;

function beginCommunityRequest(): number {
  communityRequestRevision += 1;
  return communityRequestRevision;
}

function invalidateCommunityRequests(): void {
  communityRequestRevision += 1;
}

function isCurrentCommunityRequest(revision: number): boolean {
  return revision === communityRequestRevision;
}

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
    if (!appCapabilities.canUseAccountFeatures) {
      invalidateCommunityRequests();
      const { localContacts } = get();
      set({
        communityContacts: [],
        communityError: null,
        loadingCommunity: false,
        ...getDerivedState([], localContacts),
      });
      return;
    }

    const requestRevision = beginCommunityRequest();
    set({ communityError: null, error: null, loadingCommunity: true });

    try {
      const communityContacts = await contactsService.listCommunityContacts();

      if (!isCurrentCommunityRequest(requestRevision)) {
        return;
      }

      const { localContacts } = get();
      set({
        communityError: null,
        communityContacts,
        loadingCommunity: false,
        ...getDerivedState(communityContacts, localContacts),
      });
    } catch (error) {
      if (!isCurrentCommunityRequest(requestRevision)) {
        return;
      }

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
      const communityContacts = appCapabilities.canUseAccountFeatures
        ? get().communityContacts
        : [];
      set({
        communityContacts,
        error: result.ok ? null : result.error ?? 'local_contacts_error',
        loadingLocal: false,
        localContacts: result.contacts,
        localContactsPermission: result.permissionStatus,
        ...getDerivedState(communityContacts, result.contacts),
      });
    } catch (error) {
      const communityContacts = appCapabilities.canUseAccountFeatures
        ? get().communityContacts
        : [];
      set({
        communityContacts,
        error: toErrorMessage(error),
        loadingLocal: false,
        localContactsPermission: 'error',
        ...getDerivedState(communityContacts, get().localContacts),
      });
    }
  },

  refreshAll: async () => {
    const shouldRefreshLocal = get().localContactsPermission === 'granted';

    if (!appCapabilities.canUseAccountFeatures) {
      invalidateCommunityRequests();
      set({
        communityContacts: [],
        communityError: null,
        error: null,
        loadingCommunity: false,
        loadingLocal: shouldRefreshLocal,
        ...getDerivedState([], get().localContacts),
      });

      if (!shouldRefreshLocal) {
        return;
      }

      try {
        const result = await contactsService.listLocalBirthdayContacts();
        set({
          communityContacts: [],
          communityError: null,
          error: result.ok ? null : result.error ?? 'local_contacts_error',
          loadingCommunity: false,
          loadingLocal: false,
          localContacts: result.contacts,
          localContactsPermission: result.permissionStatus,
          ...getDerivedState([], result.contacts),
        });
      } catch (error) {
        set({
          communityContacts: [],
          communityError: null,
          error: toErrorMessage(error),
          loadingCommunity: false,
          loadingLocal: false,
          localContactsPermission: 'error',
          ...getDerivedState([], get().localContacts),
        });
      }

      return;
    }

    const requestRevision = beginCommunityRequest();
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

    const communityRequestIsCurrent = isCurrentCommunityRequest(requestRevision);
    const communityContacts =
      communityRequestIsCurrent && communityResult.status === 'fulfilled'
        ? communityResult.value
        : [];
    const localContacts =
      localResult.status === 'fulfilled' && localResult.value ? localResult.value.contacts : get().localContacts;
    const communityError =
      communityRequestIsCurrent && communityResult.status === 'rejected'
        ? toErrorMessage(communityResult.reason)
        : null;
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

  resetCommunityContacts: () => {
    invalidateCommunityRequests();
    const { localContacts } = get();
    set({
      communityContacts: [],
      communityError: null,
      loadingCommunity: false,
      ...getDerivedState([], localContacts),
    });
  },
}));
