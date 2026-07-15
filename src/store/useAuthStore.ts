import type { AppAuthSession, AppAuthUser } from '@/types/auth';
import { create } from 'zustand';

import {
  APPLE_SIGN_IN_CANCELLED_MESSAGE,
  AUTH_ERROR_MESSAGES,
  GOOGLE_OAUTH_CANCELLED_MESSAGE,
  getAuthErrorMessage,
} from '@/services/authErrorMessages';
import {
  getSession,
  loadProfile as loadProfileService,
  resendConfirmationEmail as resendConfirmationEmailService,
  resetPasswordForEmail as resetPasswordForEmailService,
  signIn as signInService,
  signInWithApple as signInWithAppleService,
  signInWithGoogle as signInWithGoogleService,
  signOut as signOutService,
  signUpWithEmail as signUpWithEmailService,
  upsertProfile,
  type AppleSignInResult,
  type EmailSignUpResult,
  type Profile,
  type ProfileUpsert,
} from '@/services/authService';
import {
  clearAvatarReadUrlMemoryCache,
  isApiAvatarProviderEnabled,
  resolveCurrentUserAvatarReadUrl,
} from '@/services/avatarService';
import {
  acceptInvite as acceptInviteService,
  loadMyMembership,
  type CommunityMembership,
} from '@/services/inviteService';
import { authOperationGuards } from './authOperationGuards';

type AuthState = {
  session: AppAuthSession | null;
  user: AppAuthUser | null;
  profile: Profile | null;
  membership: CommunityMembership | null;
  loading: boolean;
  error: string | null;
  loadSession: () => Promise<void>;
  loadProfile: () => Promise<void>;
  updateProfile: (input: ProfileUpsert) => Promise<Profile>;
  refreshProfileAvatar: () => Promise<void>;
  setProfileAvatarUrl: (avatarUrl: string | null) => void;
  loadMembership: () => Promise<void>;
  acceptInvite: (code: string) => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  signInWithApple: () => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  signUpWithEmail: (email: string, password: string) => Promise<EmailSignUpResult>;
  resendConfirmationEmail: (email: string) => Promise<void>;
  resetPasswordForEmail: (email: string) => Promise<void>;
  signOut: () => Promise<void>;
};

type OperationIsCurrent = () => boolean;

function friendlyAuthError(error: unknown): string {
  return getAuthErrorMessage(error, AUTH_ERROR_MESSAGES.actionFailed);
}

async function resetEventPrivateState(isCurrent: OperationIsCurrent): Promise<boolean> {
  if (!isCurrent()) {
    return false;
  }

  try {
    const { useEventsStore } = await import('@/store/useEventsStore');

    if (!isCurrent()) {
      return false;
    }

    useEventsStore.getState().resetPrivateState();
  } catch {
    // Auth state must still settle if the events store is unavailable during startup.
  }

  return isCurrent();
}

async function clearAvatarReadUrlMemoryCacheIfCurrent(
  isCurrent: OperationIsCurrent,
): Promise<boolean> {
  if (!isCurrent()) {
    return false;
  }

  await clearAvatarReadUrlMemoryCache();

  return isCurrent();
}

async function loadProfileOrCreate(): Promise<Profile | null> {
  const profile = await loadProfileService();

  if (profile) {
    return profile;
  }

  return upsertProfile();
}

async function resolveOptionalCurrentAvatarUrl(): Promise<string | null> {
  try {
    return await resolveCurrentUserAvatarReadUrl();
  } catch {
    return null;
  }
}

function invalidateAvatarRefreshes(): void {
  authOperationGuards.invalidateAvatarRefreshes();
}

function beginAvatarRefresh(): number {
  return authOperationGuards.beginAvatarRefresh();
}

function beginAuthOperation(): number {
  return authOperationGuards.beginAuthOperation();
}

function isCurrentAvatarRefresh(revision: number): boolean {
  return authOperationGuards.isCurrentAvatarRefresh(revision);
}

function isCurrentAuthOperation(revision: number): boolean {
  return authOperationGuards.isCurrentAuthOperation(revision);
}

function authOperationIsCurrent(revision: number): OperationIsCurrent {
  return () => isCurrentAuthOperation(revision);
}

function applyTransientAvatarUrl(
  profile: Profile,
  avatarUrl: string | null | undefined,
): Profile {
  if (!isApiAvatarProviderEnabled()) {
    return profile;
  }

  return {
    ...profile,
    avatar_url: avatarUrl ?? null,
  };
}

function profileAvatarUrlForSameUser(
  currentUser: AppAuthUser | null,
  targetUserId: string,
  currentProfile: Profile | null,
): string | null {
  return currentUser?.id === targetUserId ? currentProfile?.avatar_url ?? null : null;
}

function cleanProfileText(value: string | null | undefined): string | null {
  const trimmedValue = value?.trim();

  return trimmedValue ? trimmedValue : null;
}

function hasProfileText(value: string | null | undefined): boolean {
  return cleanProfileText(value) !== null;
}

function emailPrefix(email: string | null | undefined): string | null {
  const normalizedEmail = cleanProfileText(email)?.toLowerCase();

  return normalizedEmail?.split('@')[0] ?? null;
}

function emailsMatch(firstEmail: string | null | undefined, secondEmail: string | null | undefined): boolean {
  const first = cleanProfileText(firstEmail)?.toLowerCase();
  const second = cleanProfileText(secondEmail)?.toLowerCase();

  return Boolean(first && second && first === second);
}

function isGeneratedDisplayName(profile: Profile, userEmail: string | null | undefined): boolean {
  const displayName = cleanProfileText(profile.display_name)?.toLowerCase();

  if (!displayName) {
    return false;
  }

  return [emailPrefix(profile.email), emailPrefix(userEmail)]
    .filter(Boolean)
    .includes(displayName);
}

function buildAppleProfileUpsert(
  profile: Profile,
  appleProfile: AppleSignInResult['appleProfile'],
  userEmail: string | null | undefined,
): ProfileUpsert | null {
  if (!appleProfile) {
    return null;
  }

  const appleEmail = cleanProfileText(appleProfile.email);
  const appleFullName = cleanProfileText(appleProfile.fullName);
  const appleGivenName = cleanProfileText(appleProfile.givenName);
  const appleFamilyName = cleanProfileText(appleProfile.familyName);
  const appleDisplayName = appleFullName ?? appleGivenName ?? appleFamilyName;
  const hasProfileName = (
    hasProfileText(profile.full_name) ||
    hasProfileText(profile.first_name) ||
    hasProfileText(profile.last_name)
  );
  const profileUpdate: ProfileUpsert = {};
  let hasChanges = false;

  if (!hasProfileText(profile.full_name) && appleFullName) {
    profileUpdate.full_name = appleFullName;
    hasChanges = true;
  }

  if (!hasProfileText(profile.first_name) && appleGivenName) {
    profileUpdate.first_name = appleGivenName;
    hasChanges = true;
  }

  if (!hasProfileText(profile.last_name) && appleFamilyName) {
    profileUpdate.last_name = appleFamilyName;
    hasChanges = true;
  }

  if (
    appleDisplayName &&
    (
      !hasProfileText(profile.display_name) ||
      (!profile.onboarding_completed && !hasProfileName && isGeneratedDisplayName(profile, userEmail))
    )
  ) {
    profileUpdate.display_name = appleDisplayName;
    hasChanges = true;
  }

  if (
    !hasProfileText(profile.email) &&
    appleEmail &&
    (!userEmail || emailsMatch(appleEmail, userEmail))
  ) {
    profileUpdate.email = appleEmail;
    hasChanges = true;
  }

  if (!hasChanges) {
    return null;
  }

  if (!Object.prototype.hasOwnProperty.call(profileUpdate, 'display_name') && profile.display_name !== null) {
    profileUpdate.display_name = profile.display_name;
  }

  if (!Object.prototype.hasOwnProperty.call(profileUpdate, 'email') && profile.email !== null) {
    profileUpdate.email = profile.email;
  }

  return profileUpdate;
}

async function saveAppleProfileIfAvailable(
  profile: Profile | null,
  appleProfile: AppleSignInResult['appleProfile'],
  userEmail: string | null | undefined,
): Promise<Profile | null> {
  if (!profile) {
    return profile;
  }

  const profileUpdate = buildAppleProfileUpsert(profile, appleProfile, userEmail);

  if (!profileUpdate) {
    return profile;
  }

  return upsertProfile(profileUpdate);
}

export const useAuthStore = create<AuthState>((set, get) => ({
  session: null,
  user: null,
  profile: null,
  membership: null,
  loading: false,
  error: null,

  loadSession: async () => {
    const requestRevision = beginAuthOperation();
    const isCurrent = authOperationIsCurrent(requestRevision);

    set({ loading: true, error: null });

    try {
      const session = await getSession();

      if (!isCurrent()) {
        return;
      }

      if (!session) {
        if (!await resetEventPrivateState(isCurrent)) {
          return;
        }

        if (!await clearAvatarReadUrlMemoryCacheIfCurrent(isCurrent)) {
          return;
        }

        if (!isCurrent()) {
          return;
        }

        set({
          session: null,
          user: null,
          profile: null,
          membership: null,
          loading: false,
          error: null,
        });
        return;
      }

      if (get().user?.id && get().user?.id !== session.user.id) {
        invalidateAvatarRefreshes();
        if (!await resetEventPrivateState(isCurrent)) {
          return;
        }

        if (!await clearAvatarReadUrlMemoryCacheIfCurrent(isCurrent)) {
          return;
        }
      }

      const [loadedProfile, membership] = await Promise.all([
        loadProfileOrCreate(),
        loadMyMembership(),
      ]);

      if (!isCurrent()) {
        return;
      }

      set((state) => {
        if (!isCurrent()) {
          return {};
        }

        const currentAvatarUrl = profileAvatarUrlForSameUser(
          state.user,
          session.user.id,
          state.profile,
        );

        return {
          session,
          user: session.user,
          profile: loadedProfile
            ? applyTransientAvatarUrl(loadedProfile, currentAvatarUrl)
            : null,
          membership,
          loading: false,
          error: null,
        };
      });

      if (isCurrent()) {
        void get().refreshProfileAvatar();
      }
    } catch (error) {
      const message = friendlyAuthError(error);

      if (isCurrent()) {
        set({ loading: false, error: message });
      }

      throw new Error(message);
    }
  },

  loadProfile: async () => {
    const requestRevision = beginAuthOperation();
    const isCurrent = authOperationIsCurrent(requestRevision);

    set({ loading: true, error: null });

    try {
      const loadedProfile = await loadProfileService();

      if (!isCurrent()) {
        return;
      }

      set((state) => {
        if (!isCurrent()) {
          return {};
        }

        return {
          profile: loadedProfile
            ? applyTransientAvatarUrl(
              loadedProfile,
              profileAvatarUrlForSameUser(state.user, loadedProfile.id, state.profile),
            )
            : null,
          loading: false,
          error: null,
        };
      });

      if (isCurrent()) {
        void get().refreshProfileAvatar();
      }
    } catch (error) {
      const message = friendlyAuthError(error);

      if (isCurrent()) {
        set({ loading: false, error: message });
      }

      throw new Error(message);
    }
  },

  updateProfile: async (input: ProfileUpsert) => {
    const requestRevision = beginAuthOperation();
    const isCurrent = authOperationIsCurrent(requestRevision);

    set({ loading: true, error: null });

    try {
      const updatedProfile = await upsertProfile(input);
      let profile = applyTransientAvatarUrl(updatedProfile, null);

      if (!isCurrent()) {
        return profile;
      }

      set((state) => {
        if (!isCurrent()) {
          return {};
        }

        profile = applyTransientAvatarUrl(
          updatedProfile,
          profileAvatarUrlForSameUser(state.user, updatedProfile.id, state.profile),
        );

        return { profile, loading: false, error: null };
      });

      if (isCurrent()) {
        void get().refreshProfileAvatar();
      }

      return profile;
    } catch (error) {
      const message = friendlyAuthError(error);

      if (isCurrent()) {
        set({ loading: false, error: message });
      }

      throw new Error(message);
    }
  },

  refreshProfileAvatar: async () => {
    if (!isApiAvatarProviderEnabled()) {
      return;
    }

    const userId = get().user?.id;

    if (!userId || !get().profile) {
      return;
    }

    const requestRevision = beginAvatarRefresh();
    const avatarUrl = await resolveOptionalCurrentAvatarUrl();

    set((state) => {
      if (
        !isCurrentAvatarRefresh(requestRevision)
        || state.user?.id !== userId
        || !state.profile
      ) {
        return {};
      }

      return {
        profile: {
          ...state.profile,
          avatar_url: avatarUrl,
        },
      };
    });
  },

  setProfileAvatarUrl: (avatarUrl: string | null) => {
    invalidateAvatarRefreshes();

    set((state) => ({
      profile: state.profile
        ? {
          ...state.profile,
          avatar_url: avatarUrl,
        }
        : null,
    }));
  },

  loadMembership: async () => {
    set({ loading: true, error: null });

    try {
      const membership = await loadMyMembership();

      set({ membership, loading: false, error: null });
    } catch (error) {
      const message = friendlyAuthError(error);

      set({ loading: false, error: message });
      throw new Error(message);
    }
  },

  acceptInvite: async (code: string) => {
    set({ loading: true, error: null });

    try {
      await acceptInviteService(code);
      const membership = await loadMyMembership();

      set({ membership, loading: false, error: null });
    } catch (error) {
      const message = friendlyAuthError(error);

      set({ loading: false, error: message });
      throw new Error(message);
    }
  },

  signIn: async (email: string, password: string) => {
    const requestRevision = beginAuthOperation();
    const isCurrent = authOperationIsCurrent(requestRevision);

    set({ loading: true, error: null });

    try {
      const session = await signInService(email, password);
      if (!isCurrent()) {
        return;
      }

      const [loadedProfile, membership] = await Promise.all([
        loadProfileOrCreate(),
        loadMyMembership(),
      ]);
      if (!isCurrent()) {
        return;
      }

      if (!await resetEventPrivateState(isCurrent)) {
        return;
      }

      set((state) => {
        if (!isCurrent()) {
          return {};
        }

        return {
          session,
          user: session.user,
          profile: loadedProfile
            ? applyTransientAvatarUrl(
              loadedProfile,
              profileAvatarUrlForSameUser(state.user, session.user.id, state.profile),
            )
            : null,
          membership,
          loading: false,
          error: null,
        };
      });

      if (isCurrent()) {
        void get().refreshProfileAvatar();
      }
    } catch (error) {
      const message = friendlyAuthError(error);

      if (isCurrent()) {
        set({ loading: false, error: message });
      }

      throw new Error(message);
    }
  },

  signInWithApple: async () => {
    const requestRevision = beginAuthOperation();
    const isCurrent = authOperationIsCurrent(requestRevision);

    set({ loading: true, error: null });

    try {
      const result = await signInWithAppleService();
      if (!isCurrent()) {
        return;
      }

      if (!result) {
        set({ loading: false, error: APPLE_SIGN_IN_CANCELLED_MESSAGE });
        throw new Error(APPLE_SIGN_IN_CANCELLED_MESSAGE);
      }

      const profile = await loadProfileOrCreate();
      const profileWithAppleData = await saveAppleProfileIfAvailable(
        profile,
        result.appleProfile,
        result.session.user.email,
      );
      if (!isCurrent()) {
        return;
      }

      const membership = await loadMyMembership();
      if (!isCurrent()) {
        return;
      }

      if (!await resetEventPrivateState(isCurrent)) {
        return;
      }

      set((state) => {
        if (!isCurrent()) {
          return {};
        }

        return {
          session: result.session,
          user: result.session.user,
          profile: profileWithAppleData
            ? applyTransientAvatarUrl(
              profileWithAppleData,
              profileAvatarUrlForSameUser(state.user, result.session.user.id, state.profile),
            )
            : null,
          membership,
          loading: false,
          error: null,
        };
      });

      if (isCurrent()) {
        void get().refreshProfileAvatar();
      }
    } catch (error) {
      const message = friendlyAuthError(error);

      if (isCurrent()) {
        set({ loading: false, error: message });
      }

      throw new Error(message);
    }
  },

  signInWithGoogle: async () => {
    const requestRevision = beginAuthOperation();
    const isCurrent = authOperationIsCurrent(requestRevision);

    set({ loading: true, error: null });

    try {
      const session = await signInWithGoogleService();
      if (!isCurrent()) {
        return;
      }

      if (!session) {
        set({ loading: false, error: GOOGLE_OAUTH_CANCELLED_MESSAGE });
        throw new Error(GOOGLE_OAUTH_CANCELLED_MESSAGE);
      }

      const [loadedProfile, membership] = await Promise.all([
        loadProfileOrCreate(),
        loadMyMembership(),
      ]);
      if (!isCurrent()) {
        return;
      }

      if (!await resetEventPrivateState(isCurrent)) {
        return;
      }

      set((state) => {
        if (!isCurrent()) {
          return {};
        }

        return {
          session,
          user: session.user,
          profile: loadedProfile
            ? applyTransientAvatarUrl(
              loadedProfile,
              profileAvatarUrlForSameUser(state.user, session.user.id, state.profile),
            )
            : null,
          membership,
          loading: false,
          error: null,
        };
      });

      if (isCurrent()) {
        void get().refreshProfileAvatar();
      }
    } catch (error) {
      const message = friendlyAuthError(error);

      if (isCurrent()) {
        set({ loading: false, error: message });
      }

      throw new Error(message);
    }
  },

  signUpWithEmail: async (email: string, password: string) => {
    const requestRevision = beginAuthOperation();
    const isCurrent = authOperationIsCurrent(requestRevision);

    set({ loading: true, error: null });

    try {
      const result = await signUpWithEmailService(email, password);
      if (!isCurrent()) {
        return result;
      }

      if (!result.session) {
        if (!await resetEventPrivateState(isCurrent)) {
          return result;
        }

        if (!await clearAvatarReadUrlMemoryCacheIfCurrent(isCurrent)) {
          return result;
        }

        if (!isCurrent()) {
          return result;
        }

        set({
          session: null,
          user: null,
          profile: null,
          membership: null,
          loading: false,
          error: null,
        });
        return result;
      }

      const session = result.session;
      const membership = await loadMyMembership();
      let profile = result.profile ? applyTransientAvatarUrl(result.profile, null) : null;
      if (!isCurrent()) {
        return {
          ...result,
          profile,
        };
      }

      if (!await resetEventPrivateState(isCurrent)) {
        return {
          ...result,
          profile,
        };
      }

      set((state) => {
        if (!isCurrent()) {
          return {};
        }

        profile = result.profile
          ? applyTransientAvatarUrl(
            result.profile,
            profileAvatarUrlForSameUser(state.user, session.user.id, state.profile),
          )
          : null;

        return {
          session,
          user: session.user,
          profile,
          membership,
          loading: false,
          error: null,
        };
      });

      if (isCurrent()) {
        void get().refreshProfileAvatar();
      }

      return {
        ...result,
        profile,
      };
    } catch (error) {
      const message = friendlyAuthError(error);

      if (isCurrent()) {
        set({ loading: false, error: message });
      }

      throw new Error(message);
    }
  },

  resendConfirmationEmail: async (email: string) => {
    set({ loading: true, error: null });

    try {
      await resendConfirmationEmailService(email);

      set({ loading: false, error: null });
    } catch (error) {
      const message = friendlyAuthError(error);

      set({ loading: false, error: message });
      throw new Error(message);
    }
  },

  resetPasswordForEmail: async (email: string) => {
    set({ loading: true, error: null });

    try {
      await resetPasswordForEmailService(email);

      set({ loading: false, error: null });
    } catch (error) {
      const message = friendlyAuthError(error);

      set({ loading: false, error: message });
      throw new Error(message);
    }
  },

  signOut: async () => {
    const requestRevision = beginAuthOperation();
    const isCurrent = authOperationIsCurrent(requestRevision);

    set({ loading: true, error: null });

    try {
      await signOutService();
      if (!isCurrent()) {
        return;
      }

      if (!await resetEventPrivateState(isCurrent)) {
        return;
      }

      if (!await clearAvatarReadUrlMemoryCacheIfCurrent(isCurrent)) {
        return;
      }

      if (!isCurrent()) {
        return;
      }

      set({
        session: null,
        user: null,
        profile: null,
        membership: null,
        loading: false,
        error: null,
      });
    } catch (error) {
      const message = friendlyAuthError(error);

      if (isCurrent()) {
        set({ loading: false, error: message });
      }

      throw new Error(message);
    }
  },
}));
