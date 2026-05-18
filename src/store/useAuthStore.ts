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
  acceptInvite as acceptInviteService,
  loadMyMembership,
  type CommunityMembership,
} from '@/services/inviteService';

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

async function loadProfileOrCreate(): Promise<Profile | null> {
  const profile = await loadProfileService();

  if (profile) {
    return profile;
  }

  return upsertProfile();
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

export const useAuthStore = create<AuthState>((set) => ({
  session: null,
  user: null,
  profile: null,
  membership: null,
  loading: false,
  error: null,

  loadSession: async () => {
    set({ loading: true, error: null });

    try {
      const session = await getSession();

      if (!session) {
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

      const [profile, membership] = await Promise.all([
        loadProfileOrCreate(),
        loadMyMembership(),
      ]);

      set({
        session,
        user: session.user,
        profile,
        membership,
        loading: false,
        error: null,
      });
    } catch (error) {
      const message = friendlyAuthError(error);

      set({ loading: false, error: message });
      throw new Error(message);
    }
  },

  loadProfile: async () => {
    set({ loading: true, error: null });

    try {
      const profile = await loadProfileService();

      set({ profile, loading: false, error: null });
    } catch (error) {
      const message = friendlyAuthError(error);

      set({ loading: false, error: message });
      throw new Error(message);
    }
  },

  updateProfile: async (input: ProfileUpsert) => {
    set({ loading: true, error: null });

    try {
      const profile = await upsertProfile(input);

      set({ profile, loading: false, error: null });
      return profile;
    } catch (error) {
      const message = friendlyAuthError(error);

      set({ loading: false, error: message });
      throw new Error(message);
    }
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
    set({ loading: true, error: null });

    try {
      const session = await signInService(email, password);
      const [profile, membership] = await Promise.all([
        loadProfileOrCreate(),
        loadMyMembership(),
      ]);

      set({
        session,
        user: session.user,
        profile,
        membership,
        loading: false,
        error: null,
      });
    } catch (error) {
      const message = friendlyAuthError(error);

      set({ loading: false, error: message });
      throw new Error(message);
    }
  },

  signInWithApple: async () => {
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

      set({
        session: result.session,
        user: result.session.user,
        profile: profileWithAppleData,
        membership,
        loading: false,
        error: null,
      });
    } catch (error) {
      const message = friendlyAuthError(error);

      set({ loading: false, error: message });
      throw new Error(message);
    }
  },

  signInWithGoogle: async () => {
    set({ loading: true, error: null });

    try {
      const session = await signInWithGoogleService();

      if (!session) {
        set({ loading: false, error: GOOGLE_OAUTH_CANCELLED_MESSAGE });
        throw new Error(GOOGLE_OAUTH_CANCELLED_MESSAGE);
      }

      const [profile, membership] = await Promise.all([
        loadProfileOrCreate(),
        loadMyMembership(),
      ]);

      set({
        session,
        user: session.user,
        profile,
        membership,
        loading: false,
        error: null,
      });
    } catch (error) {
      const message = friendlyAuthError(error);

      set({ loading: false, error: message });
      throw new Error(message);
    }
  },

  signUpWithEmail: async (email: string, password: string) => {
    set({ loading: true, error: null });

    try {
      const result = await signUpWithEmailService(email, password);

      if (!result.session) {
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

      const membership = await loadMyMembership();

      set({
        session: result.session,
        user: result.session.user,
        profile: result.profile,
        membership,
        loading: false,
        error: null,
      });

      return result;
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
    set({ loading: true, error: null });

    try {
      await signOutService();

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
