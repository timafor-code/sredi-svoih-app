import type { AppAuthSession, AppAuthUser } from '@/types/auth';
import type {
  HebrewBirthDateProfile,
  ProfileBirthTimeContext,
  ProfileNotificationPreferences,
  ProfileMaritalStatus,
  ProfileTribeStatus,
  ProfileVisibility,
} from '@/types/profile';

import {
  APPLE_SIGN_IN_NOT_CONFIGURED_MESSAGE,
  GOOGLE_OAUTH_NOT_CONFIGURED_MESSAGE,
  GOOGLE_OAUTH_SESSION_FAILED_MESSAGE,
} from './authErrorMessages';
import * as authApiService from './authApiService';

export type Profile = {
  id: string;
  community_id: string | null;
  full_name: string | null;
  hebrew_name: string | null;
  city: string | null;
  created_at: string;
  display_name: string | null;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  email: string | null;
  avatar_url: string | null;
  birth_date: string | null;
  birth_time_context: ProfileBirthTimeContext;
  hebrew_birth_date: HebrewBirthDateProfile | null;
  tribe_status: ProfileTribeStatus | null;
  marital_status: ProfileMaritalStatus | null;
  about: string | null;
  profile_visibility: ProfileVisibility;
  birthday_visibility: ProfileVisibility;
  phone_visibility: ProfileVisibility;
  notification_preferences: ProfileNotificationPreferences | null;
  nusach: string | null;
  onboarding_completed: boolean;
  updated_at: string | null;
};

export type ProfileUpsert = Partial<Omit<Profile, 'created_at' | 'updated_at'>> & {
  id?: string;
};

export type EmailSignUpResult = {
  session: AppAuthSession | null;
  user: AppAuthUser | null;
  profile: Profile | null;
  needsEmailConfirmation: boolean;
};

export type AppleSignInResult = {
  session: AppAuthSession;
  appleProfile?: {
    email?: string | null;
    fullName?: string | null;
    givenName?: string | null;
    familyName?: string | null;
  };
};

export async function getSession(): Promise<AppAuthSession | null> {
  return authApiService.getSession();
}

export async function signIn(email: string, password: string): Promise<AppAuthSession> {
  return authApiService.signIn(email, password);
}

export async function handleOAuthCallback(_url: string): Promise<AppAuthSession | null> {
  throw new Error(GOOGLE_OAUTH_SESSION_FAILED_MESSAGE);
}

export async function signInWithGoogle(): Promise<AppAuthSession | null> {
  throw new Error(GOOGLE_OAUTH_NOT_CONFIGURED_MESSAGE);
}

export async function signInWithApple(): Promise<AppleSignInResult | null> {
  throw new Error(APPLE_SIGN_IN_NOT_CONFIGURED_MESSAGE);
}

export async function signUpWithEmail(email: string, password: string): Promise<EmailSignUpResult> {
  return authApiService.signUpWithEmail(email, password);
}

export async function resendConfirmationEmail(email: string): Promise<void> {
  return authApiService.resendConfirmationEmail(email);
}

export async function resetPasswordForEmail(email: string): Promise<void> {
  return authApiService.resetPasswordForEmail(email);
}

export async function signOut(): Promise<void> {
  return authApiService.signOut();
}

export async function loadProfile(): Promise<Profile | null> {
  return authApiService.loadProfile();
}

export async function upsertProfile(profile: ProfileUpsert = {}): Promise<Profile> {
  return authApiService.upsertProfile(profile);
}
