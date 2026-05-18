import type { Session, User } from '@supabase/supabase-js';
import * as AppleAuthentication from 'expo-apple-authentication';
import { makeRedirectUri } from 'expo-auth-session';
import * as Crypto from 'expo-crypto';
import * as WebBrowser from 'expo-web-browser';
import { Platform } from 'react-native';

import type {
  HebrewBirthDateProfile,
  ProfileBirthTimeContext,
  ProfileNotificationPreferences,
  ProfileMaritalStatus,
  ProfileTribeStatus,
  ProfileVisibility,
} from '@/types/profile';
import {
  APPLE_SIGN_IN_GENERIC_MESSAGE,
  APPLE_SIGN_IN_MISSING_TOKEN_MESSAGE,
  APPLE_SIGN_IN_UNAVAILABLE_MESSAGE,
  GOOGLE_OAUTH_GENERIC_MESSAGE,
  GOOGLE_OAUTH_NOT_CONFIGURED_MESSAGE,
  GOOGLE_OAUTH_SESSION_FAILED_MESSAGE,
  getAppleSignInErrorMessage,
  getGoogleOAuthErrorMessage,
} from './authErrorMessages';
import { supabase } from './supabaseClient';

if (Platform.OS === 'web') {
  WebBrowser.maybeCompleteAuthSession();
}

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
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  needsEmailConfirmation: boolean;
};

export type AppleSignInResult = {
  session: Session;
  appleProfile?: {
    email?: string | null;
    fullName?: string | null;
    givenName?: string | null;
    familyName?: string | null;
  };
};

const PROFILE_FIELDS = `
  id,
  community_id,
  full_name,
  hebrew_name,
  city,
  created_at,
  display_name,
  first_name,
  last_name,
  phone,
  email,
  avatar_url,
  birth_date,
  birth_time_context,
  hebrew_birth_date,
  tribe_status,
  marital_status,
  about,
  profile_visibility,
  birthday_visibility,
  phone_visibility,
  notification_preferences,
  nusach,
  onboarding_completed,
  updated_at
`;

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function cleanPayload<T extends Record<string, unknown>>(payload: T): T {
  return Object.fromEntries(
    Object.entries(payload).filter(([, value]) => value !== undefined),
  ) as T;
}

function hasOwnField<T extends object>(value: T, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function includesAny(message: string, phrases: string[]): boolean {
  return phrases.some((phrase) => message.includes(phrase));
}

function cleanOptionalString(value: string | null | undefined): string | null {
  const trimmedValue = value?.trim();

  return trimmedValue ? trimmedValue : null;
}

function getOAuthRedirectTo(): string {
  return makeRedirectUri({
    scheme: 'sredi-svoih',
    path: 'auth/callback',
  });
}

function isAppleSignInCancelError(error: unknown): boolean {
  const code = typeof error === 'object' && error !== null && 'code' in error
    ? String(error.code)
    : '';
  const message = error instanceof Error
    ? error.message
    : typeof error === 'string'
      ? error
      : '';
  const normalizedMessage = message.toLowerCase();

  return (
    code === 'ERR_REQUEST_CANCELED' ||
    includesAny(normalizedMessage, ['err_request_canceled', 'err_request_cancelled'])
  );
}

function getAppleProfile(
  credential: AppleAuthentication.AppleAuthenticationCredential,
): AppleSignInResult['appleProfile'] | undefined {
  const givenName = cleanOptionalString(credential.fullName?.givenName);
  const familyName = cleanOptionalString(credential.fullName?.familyName);
  const fullName = cleanOptionalString(
    [
      credential.fullName?.givenName,
      credential.fullName?.middleName,
      credential.fullName?.familyName,
    ]
      .map(cleanOptionalString)
      .filter(Boolean)
      .join(' '),
  );
  const email = cleanOptionalString(credential.email);

  if (!email && !fullName && !givenName && !familyName) {
    return undefined;
  }

  return {
    email,
    fullName,
    givenName,
    familyName,
  };
}

function readOAuthParams(url: string): URLSearchParams {
  const params = new URLSearchParams();

  try {
    const parsedUrl = new URL(url);

    parsedUrl.searchParams.forEach((value, key) => {
      params.set(key, value);
    });

    const hash = parsedUrl.hash.startsWith('#') ? parsedUrl.hash.slice(1) : parsedUrl.hash;
    const hashParams = new URLSearchParams(hash);

    hashParams.forEach((value, key) => {
      if (!params.has(key)) {
        params.set(key, value);
      }
    });
  } catch {
    const [, query = ''] = url.split('?');
    const [queryWithoutHash = '', hash = ''] = query.split('#');

    new URLSearchParams(queryWithoutHash).forEach((value, key) => {
      params.set(key, value);
    });
    new URLSearchParams(hash).forEach((value, key) => {
      if (!params.has(key)) {
        params.set(key, value);
      }
    });
  }

  return params;
}

function warnPasswordSignInError(error: { code?: string; message: string; status?: number }): void {
  if (__DEV__) {
    console.warn('Supabase password sign-in failed', {
      message: error.message,
      status: error.status,
      code: error.code,
    });
  }
}

async function getCurrentUser(): Promise<User | null> {
  const session = await getSession();

  return session?.user ?? null;
}

async function requireCurrentUser(): Promise<User> {
  const user = await getCurrentUser();

  if (!user) {
    throw new Error('Auth required');
  }

  return user;
}

export async function getSession(): Promise<Session | null> {
  const { data, error } = await supabase.auth.getSession();

  if (error) {
    throw new Error(error.message);
  }

  return data.session;
}

export async function signIn(email: string, password: string): Promise<Session> {
  const normalizedEmail = normalizeEmail(email);

  if (!normalizedEmail || !password) {
    throw new Error('Не удалось войти. Проверьте email и пароль.');
  }

  const signInResult = await supabase.auth.signInWithPassword({
    email: normalizedEmail,
    password,
  });

  if (!signInResult.error && signInResult.data.session) {
    return signInResult.data.session;
  }

  if (signInResult.error) {
    warnPasswordSignInError(signInResult.error);
  }

  throw new Error(signInResult.error?.message ?? 'Не удалось войти. Проверьте email и пароль.');
}

export async function handleOAuthCallback(url: string): Promise<Session | null> {
  const params = readOAuthParams(url);
  const callbackError = params.get('error_description')
    ?? params.get('error')
    ?? params.get('error_code');

  if (callbackError) {
    throw new Error(getGoogleOAuthErrorMessage(callbackError, GOOGLE_OAUTH_SESSION_FAILED_MESSAGE));
  }

  const code = params.get('code');

  if (code) {
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);

    if (error) {
      throw new Error(getGoogleOAuthErrorMessage(error.message, GOOGLE_OAUTH_SESSION_FAILED_MESSAGE));
    }

    return data.session ?? getSession();
  }

  const accessToken = params.get('access_token');
  const refreshToken = params.get('refresh_token');

  if (accessToken && refreshToken) {
    const { data, error } = await supabase.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken,
    });

    if (error) {
      throw new Error(getGoogleOAuthErrorMessage(error.message, GOOGLE_OAUTH_SESSION_FAILED_MESSAGE));
    }

    return data.session ?? getSession();
  }

  const session = await getSession();

  if (session) {
    return session;
  }

  throw new Error(GOOGLE_OAUTH_SESSION_FAILED_MESSAGE);
}

export async function signInWithGoogle(): Promise<Session | null> {
  const redirectTo = getOAuthRedirectTo();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo,
      skipBrowserRedirect: true,
    },
  });

  if (error) {
    throw new Error(getGoogleOAuthErrorMessage(error.message));
  }

  if (!data.url) {
    throw new Error(GOOGLE_OAUTH_NOT_CONFIGURED_MESSAGE);
  }

  const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);

  if (result.type === 'success') {
    return handleOAuthCallback(result.url);
  }

  if (result.type === 'cancel' || result.type === 'dismiss') {
    return null;
  }

  throw new Error(GOOGLE_OAUTH_GENERIC_MESSAGE);
}

export async function signInWithApple(): Promise<AppleSignInResult | null> {
  let isAvailable = false;

  try {
    isAvailable = Platform.OS === 'ios' && await AppleAuthentication.isAvailableAsync();
  } catch {
    isAvailable = false;
  }

  if (!isAvailable) {
    throw new Error(APPLE_SIGN_IN_UNAVAILABLE_MESSAGE);
  }

  const nonce = Crypto.randomUUID();
  let credential: AppleAuthentication.AppleAuthenticationCredential;

  try {
    credential = await AppleAuthentication.signInAsync({
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
      nonce,
    });
  } catch (error) {
    if (isAppleSignInCancelError(error)) {
      return null;
    }

    throw new Error(getAppleSignInErrorMessage(error instanceof Error ? error.message : String(error)));
  }

  if (!credential.identityToken) {
    throw new Error(APPLE_SIGN_IN_MISSING_TOKEN_MESSAGE);
  }

  const { data, error } = await supabase.auth.signInWithIdToken({
    provider: 'apple',
    token: credential.identityToken,
    nonce,
  });

  if (error) {
    throw new Error(getAppleSignInErrorMessage(error.message));
  }

  if (!data.session) {
    throw new Error(APPLE_SIGN_IN_GENERIC_MESSAGE);
  }

  return {
    session: data.session,
    appleProfile: getAppleProfile(credential),
  };
}

export async function signUpWithEmail(email: string, password: string): Promise<EmailSignUpResult> {
  const normalizedEmail = normalizeEmail(email);

  if (!normalizedEmail || !password.trim()) {
    throw new Error('Введите email и пароль для регистрации.');
  }

  const { data, error } = await supabase.auth.signUp({
    email: normalizedEmail,
    password,
  });

  if (error) {
    throw new Error(error.message);
  }

  const session = data.session ?? null;
  let profile: Profile | null = null;

  if (session) {
    profile = await upsertProfile({ email: normalizedEmail });
  }

  return {
    session,
    user: data.user ?? session?.user ?? null,
    profile,
    needsEmailConfirmation: !session,
  };
}

export async function resendConfirmationEmail(email: string): Promise<void> {
  const normalizedEmail = normalizeEmail(email);

  if (!normalizedEmail) {
    throw new Error('Введите email для повторной отправки письма.');
  }

  const { error } = await supabase.auth.resend({
    type: 'signup',
    email: normalizedEmail,
  });

  if (error) {
    throw new Error(error.message);
  }
}

export async function resetPasswordForEmail(email: string): Promise<void> {
  const normalizedEmail = normalizeEmail(email);

  if (!normalizedEmail) {
    throw new Error('Введите email для восстановления пароля.');
  }

  const { error } = await supabase.auth.resetPasswordForEmail(normalizedEmail);

  if (error) {
    throw new Error(error.message);
  }
}

export async function signOut(): Promise<void> {
  const { error } = await supabase.auth.signOut();

  if (error) {
    throw new Error(error.message);
  }
}

export async function loadProfile(): Promise<Profile | null> {
  const user = await getCurrentUser();

  if (!user) {
    return null;
  }

  const { data, error } = await supabase
    .from('profiles')
    .select(PROFILE_FIELDS)
    .eq('id', user.id)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return data as Profile | null;
}

export async function upsertProfile(profile: ProfileUpsert = {}): Promise<Profile> {
  const user = await requireCurrentUser();
  const email = hasOwnField(profile, 'email') ? profile.email ?? null : user.email ?? null;
  const displayName = hasOwnField(profile, 'display_name')
    ? profile.display_name
    : profile.full_name ?? email?.split('@')[0] ?? null;
  const payload = cleanPayload({
    ...profile,
    id: user.id,
    email,
    display_name: displayName,
  });

  const { data, error } = await supabase
    .from('profiles')
    .upsert(payload, { onConflict: 'id' })
    .select(PROFILE_FIELDS)
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return data as Profile;
}
