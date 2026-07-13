import type { Session, User } from '@supabase/supabase-js';
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

let avatarRefreshRevision = 0;
let profileWriteRevision = 0;

type AuthState = {
  session: Session | null;
  user: User | null;
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

function friendlyAuthError(error: unknown): string {
  return getAuthErrorMessage(error, AUTH_ERROR_MESSAGES.actionFailed);
}

async function resetEventPrivateState(): Promise<void> {
  try {
    const { useEventsStore } = await import('@/store/useEventsStore');

    useEventsStore.getState().resetPrivateState();
  } catch {
    // Auth state must still settle if the events store is unavailable during startup.
  }
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
  avatarRefreshRevision += 1;
}

function invalidateProfileWrites(): void {
  profileWriteRevision += 1;
}

function invalidateProfileAndAvatarWrites(): void {
  invalidateProfileWrites();
  invalidateAvatarRefreshes();
}

function beginAvatarRefresh(): number {
  avatarRefreshRevision += 1;
  return avatarRefreshRevision;
}

function beginProfileWrite(): number {
  profileWriteRevision += 1;
  return profileWriteRevision;
}

function isCurrentAvatarRefresh(revision: number): boolean {
  return revision === avatarRefreshRevision;
}

function isCurrentProfileWrite(revision: number): boolean {
  return revision === profileWriteRevision;
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
  currentUser: User | null,
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
    let requestRevision = beginProfileWrite();

    set({ loading: true, error: null });

    try {
      const session = await getSession();

      if (!session) {
        invalidateProfileAndAvatarWrites();
        await resetEventPrivateState();
        await clearAvatarReadUrlMemoryCache();

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
        invalidateProfileAndAvatarWrites();
        requestRevision = beginProfileWrite();
        await resetEventPrivateState();
        await clearAvatarReadUrlMemoryCache();
      }

      const [loadedProfile, membership] = await Promise.all([
        loadProfileOrCreate(),
        loadMyMembership(),
      ]);

      set((state) => {
        const shouldWriteProfile = isCurrentProfileWrite(requestRevision);
        const currentAvatarUrl = profileAvatarUrlForSameUser(
          state.user,
          session.user.id,
          state.profile,
        );

        return {
          session,
          user: session.user,
          profile: shouldWriteProfile
            ? loadedProfile
              ? applyTransientAvatarUrl(loadedProfile, currentAvatarUrl)
              : null
            : state.profile,
          membership,
          loading: false,
          error: null,
        };
      });

      void get().refreshProfileAvatar();
    } catch (error) {
      const message = friendlyAuthError(error);

      set({ loading: false, error: message });
      throw new Error(message);
    }
  },

  loadProfile: async () => {
    const requestRevision = beginProfileWrite();

    set({ loading: true, error: null });

    try {
      const loadedProfile = await loadProfileService();

      set((state) => ({
        profile: isCurrentProfileWrite(requestRevision)
          ? loadedProfile
            ? applyTransientAvatarUrl(
              loadedProfile,
              profileAvatarUrlForSameUser(state.user, loadedProfile.id, state.profile),
            )
            : null
          : state.profile,
        loading: false,
        error: null,
      }));

      void get().refreshProfileAvatar();
    } catch (error) {
      const message = friendlyAuthError(error);

      set({ loading: false, error: message });
      throw new Error(message);
    }
  },

  updateProfile: async (input: ProfileUpsert) => {
    const requestRevision = beginProfileWrite();

    set({ loading: true, error: null });

    try {
      const updatedProfile = await upsertProfile(input);
      let profile = applyTransientAvatarUrl(updatedProfile, null);

      set((state) => {
        if (!isCurrentProfileWrite(requestRevision)) {
          return {
            loading: false,
            error: null,
          };
        }

        profile = applyTransientAvatarUrl(
          updatedProfile,
          profileAvatarUrlForSameUser(state.user, updatedProfile.id, state.profile),
        );

        return { profile, loading: false, error: null };
      });

      void get().refreshProfileAvatar();

      return profile;
    } catch (error) {
      const message = friendlyAuthError(error);

      set({ loading: false, error: message });
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
    const requestRevision = beginProfileWrite();
    invalidateAvatarRefreshes();
    set({ loading: true, error: null });

    try {
      const session = await signInService(email, password);
      const [loadedProfile, membership] = await Promise.all([
        loadProfileOrCreate(),
        loadMyMembership(),
      ]);

      await resetEventPrivateState();

      set((state) => ({
        session,
        user: session.user,
        profile: isCurrentProfileWrite(requestRevision)
          ? loadedProfile
            ? applyTransientAvatarUrl(
              loadedProfile,
              profileAvatarUrlForSameUser(state.user, session.user.id, state.profile),
            )
            : null
          : state.profile,
        membership,
        loading: false,
        error: null,
      }));

      void get().refreshProfileAvatar();
    } catch (error) {
      const message = friendlyAuthError(error);

      set({ loading: false, error: message });
      throw new Error(message);
    }
  },

  signInWithApple: async () => {
    const requestRevision = beginProfileWrite();
    invalidateAvatarRefreshes();
    set({ loading: true, error: null });

    try {
      const result = await signInWithAppleService();

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
      const membership = await loadMyMembership();

      await resetEventPrivateState();

      set((state) => ({
        session: result.session,
        user: result.session.user,
        profile: isCurrentProfileWrite(requestRevision)
          ? profileWithAppleData
            ? applyTransientAvatarUrl(
              profileWithAppleData,
              profileAvatarUrlForSameUser(state.user, result.session.user.id, state.profile),
            )
            : null
          : state.profile,
        membership,
        loading: false,
        error: null,
      }));

      void get().refreshProfileAvatar();
    } catch (error) {
      const message = friendlyAuthError(error);

      set({ loading: false, error: message });
      throw new Error(message);
    }
  },

  signInWithGoogle: async () => {
    const requestRevision = beginProfileWrite();
    invalidateAvatarRefreshes();
    set({ loading: true, error: null });

    try {
      const session = await signInWithGoogleService();

      if (!session) {
        set({ loading: false, error: GOOGLE_OAUTH_CANCELLED_MESSAGE });
        throw new Error(GOOGLE_OAUTH_CANCELLED_MESSAGE);
      }

      const [loadedProfile, membership] = await Promise.all([
        loadProfileOrCreate(),
        loadMyMembership(),
      ]);

      await resetEventPrivateState();

      set((state) => ({
        session,
        user: session.user,
        profile: isCurrentProfileWrite(requestRevision)
          ? loadedProfile
            ? applyTransientAvatarUrl(
              loadedProfile,
              profileAvatarUrlForSameUser(state.user, session.user.id, state.profile),
            )
            : null
          : state.profile,
        membership,
        loading: false,
        error: null,
      }));

      void get().refreshProfileAvatar();
    } catch (error) {
      const message = friendlyAuthError(error);

      set({ loading: false, error: message });
      throw new Error(message);
    }
  },

  signUpWithEmail: async (email: string, password: string) => {
    const requestRevision = beginProfileWrite();
    invalidateAvatarRefreshes();
    set({ loading: true, error: null });

    try {
      const result = await signUpWithEmailService(email, password);

      if (!result.session) {
        invalidateProfileAndAvatarWrites();
        await resetEventPrivateState();
        await clearAvatarReadUrlMemoryCache();

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

      await resetEventPrivateState();

      set((state) => {
        profile = isCurrentProfileWrite(requestRevision)
          ? result.profile
            ? applyTransientAvatarUrl(
              result.profile,
              profileAvatarUrlForSameUser(state.user, session.user.id, state.profile),
            )
            : null
          : state.profile;

        return {
          session,
          user: session.user,
          profile,
          membership,
          loading: false,
          error: null,
        };
      });

      void get().refreshProfileAvatar();

      return {
        ...result,
        profile,
      };
    } catch (error) {
      const message = friendlyAuthError(error);

      set({ loading: false, error: message });
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
    invalidateProfileAndAvatarWrites();
    set({ loading: true, error: null });

    try {
      await signOutService();

      await resetEventPrivateState();
      await clearAvatarReadUrlMemoryCache();

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

      set({ loading: false, error: message });
      throw new Error(message);
    }
  },
}));
