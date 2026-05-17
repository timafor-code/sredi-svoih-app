import type { Session, User } from '@supabase/supabase-js';
import { makeRedirectUri } from 'expo-auth-session';
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

export const GOOGLE_OAUTH_CANCELLED_MESSAGE = 'Вход через Google отменён.';
export const GOOGLE_OAUTH_NOT_CONFIGURED_MESSAGE = 'Google-вход пока не настроен для этого окружения.';
export const GOOGLE_OAUTH_GENERIC_MESSAGE = 'Не удалось войти через Google. Попробуйте ещё раз.';

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

function getOAuthRedirectTo(): string {
  return makeRedirectUri({
    scheme: 'sredi-svoih',
    path: 'auth/callback',
  });
}

function getGoogleOAuthErrorMessage(message: string): string {
  const normalizedMessage = message.toLowerCase();

  if (includesAny(normalizedMessage, ['access_denied', 'cancel', 'cancelled', 'dismiss'])) {
    return GOOGLE_OAUTH_CANCELLED_MESSAGE;
  }

  if (
    includesAny(normalizedMessage, [
      'provider is not enabled',
      'provider not enabled',
      'unsupported provider',
      'invalid_client',
      'invalid client',
      'oauth client',
      'redirect_uri_mismatch',
      'redirect uri',
      'unauthorized_client',
      'client not found',
      'client_id',
      'client secret',
    ])
  ) {
    return GOOGLE_OAUTH_NOT_CONFIGURED_MESSAGE;
  }

  return GOOGLE_OAUTH_GENERIC_MESSAGE;
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
    throw new Error(getGoogleOAuthErrorMessage(callbackError));
  }

  const code = params.get('code');

  if (code) {
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);

    if (error) {
      throw new Error(getGoogleOAuthErrorMessage(error.message));
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
      throw new Error(getGoogleOAuthErrorMessage(error.message));
    }

    return data.session ?? getSession();
  }

  const session = await getSession();

  if (session) {
    return session;
  }

  throw new Error(GOOGLE_OAUTH_GENERIC_MESSAGE);
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
