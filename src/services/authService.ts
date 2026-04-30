import type { Session, User } from '@supabase/supabase-js';

import type {
  HebrewBirthDateProfile,
  ProfileNotificationPreferences,
  ProfileMaritalStatus,
  ProfileTribeStatus,
  ProfileVisibility,
} from '@/types/profile';
import { supabase } from './supabaseClient';

const DEV_AUTH_PASSWORD = 'DEV-SREDI-2026-PASSWORD';

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

export async function signInWithOtp(email: string) {
  const normalizedEmail = normalizeEmail(email);

  if (!normalizedEmail) {
    throw new Error('Введите email для входа.');
  }

  const { data, error } = await supabase.auth.signInWithOtp({
    email: normalizedEmail,
    options: {
      shouldCreateUser: true,
    },
  });

  if (error) {
    throw new Error(error.message);
  }

  return data;
}

export async function signInDev(email: string): Promise<Session> {
  const normalizedEmail = normalizeEmail(email);

  if (!normalizedEmail) {
    throw new Error('Введите email для входа.');
  }

  const signInResult = await supabase.auth.signInWithPassword({
    email: normalizedEmail,
    password: DEV_AUTH_PASSWORD,
  });

  if (!signInResult.error && signInResult.data.session) {
    return signInResult.data.session;
  }

  const signUpResult = await supabase.auth.signUp({
    email: normalizedEmail,
    password: DEV_AUTH_PASSWORD,
    options: {
      data: {
        local_mvp: true,
      },
    },
  });

  if (signUpResult.error) {
    throw new Error(signUpResult.error.message);
  }

  if (signUpResult.data.session) {
    return signUpResult.data.session;
  }

  const retryResult = await supabase.auth.signInWithPassword({
    email: normalizedEmail,
    password: DEV_AUTH_PASSWORD,
  });

  if (retryResult.error || !retryResult.data.session) {
    throw new Error(retryResult.error?.message ?? 'Не удалось войти.');
  }

  return retryResult.data.session;
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
