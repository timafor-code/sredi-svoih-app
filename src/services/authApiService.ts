import type { Session, User } from '@supabase/supabase-js';

import type {
  ApiAuthEmailRequest,
  ApiAuthTokenResponse,
  ApiCurrentUserResponse,
  ApiLoginRequest,
  ApiLogoutRequest,
  ApiOkResponse,
  ApiProfileSummary,
  ApiProfileUpdateRequest,
  ApiRefreshRequest,
  ApiRegisterRequest,
  ApiRegisterResponse,
  ApiStoredAuthTokens,
  ApiUserSummary,
} from '@/types/api';

import type { EmailSignUpResult, Profile, ProfileUpsert } from './authService';
import { apiClient, ApiClientError } from './apiClient';
import {
  clearApiAuthTokens,
  getApiAuthTokens,
  setApiAuthTokens,
} from './apiAuthTokenStore';
import { MINIMUM_PASSWORD_LENGTH } from './authValidation';

const API_AUTH_REFRESH_SKEW_MS = 30_000;

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function isUnauthenticatedApiError(error: unknown): boolean {
  return error instanceof ApiClientError && error.status === 401;
}

function apiDateToSeconds(value: string): number {
  const timestampMs = Date.parse(value);

  if (!Number.isFinite(timestampMs)) {
    return Math.floor(Date.now() / 1000);
  }

  return Math.floor(timestampMs / 1000);
}

function secondsUntil(value: string): number {
  const timestampMs = Date.parse(value);

  if (!Number.isFinite(timestampMs)) {
    return 0;
  }

  return Math.max(0, Math.floor((timestampMs - Date.now()) / 1000));
}

function shouldRefreshTokens(tokens: ApiStoredAuthTokens): boolean {
  const expiresAtMs = Date.parse(tokens.expires_at);

  return !Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now() + API_AUTH_REFRESH_SKEW_MS;
}

function apiUserToSupabaseUser(user: ApiUserSummary): User {
  return {
    id: user.id,
    app_metadata: {
      auth_provider: 'api',
      provider: 'email',
      providers: ['email'],
    },
    user_metadata: {},
    aud: 'authenticated',
    email: user.email ?? undefined,
    phone: user.phone ?? undefined,
    created_at: user.created_at,
    confirmed_at: user.email_verified_at ?? user.phone_verified_at ?? undefined,
    email_confirmed_at: user.email_verified_at ?? undefined,
    phone_confirmed_at: user.phone_verified_at ?? undefined,
    last_sign_in_at: user.last_login_at ?? undefined,
    role: 'authenticated',
    updated_at: user.updated_at,
    is_anonymous: false,
  } as User;
}

function apiTokensToSession(
  tokens: ApiAuthTokenResponse | ApiStoredAuthTokens,
  user: ApiUserSummary,
): Session {
  return {
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    token_type: 'bearer',
    expires_in: secondsUntil(tokens.expires_at),
    expires_at: apiDateToSeconds(tokens.expires_at),
    user: apiUserToSupabaseUser(user),
  };
}

function apiProfileToProfile(profile: ApiProfileSummary): Profile {
  return {
    id: profile.user_id,
    community_id: profile.community_id,
    full_name: profile.full_name,
    hebrew_name: profile.hebrew_name,
    city: profile.city,
    created_at: profile.created_at,
    display_name: profile.display_name,
    first_name: profile.first_name,
    last_name: profile.last_name,
    phone: profile.phone,
    email: profile.email,
    avatar_url: profile.avatar_url,
    birth_date: profile.birth_date,
    birth_time_context: profile.birth_time_context,
    hebrew_birth_date: profile.hebrew_birth_date,
    tribe_status: profile.tribe_status,
    marital_status: profile.marital_status,
    about: profile.about,
    profile_visibility: profile.profile_visibility,
    birthday_visibility: profile.birthday_visibility,
    phone_visibility: profile.phone_visibility,
    notification_preferences: profile.notification_preferences,
    nusach: profile.nusach,
    onboarding_completed: profile.onboarding_completed,
    updated_at: profile.updated_at,
  };
}

function buildProfileUpdatePayload(profile: ProfileUpsert): ApiProfileUpdateRequest {
  const payload: ApiProfileUpdateRequest = {};

  if (profile.display_name !== undefined) payload.display_name = profile.display_name;
  if (profile.first_name !== undefined) payload.first_name = profile.first_name;
  if (profile.last_name !== undefined) payload.last_name = profile.last_name;
  if (profile.full_name !== undefined) payload.full_name = profile.full_name;
  if (profile.hebrew_name !== undefined) payload.hebrew_name = profile.hebrew_name;
  if (profile.birth_date !== undefined) payload.birth_date = profile.birth_date;
  if (profile.hebrew_birth_date !== undefined) payload.hebrew_birth_date = profile.hebrew_birth_date;
  if (profile.birth_time_context !== undefined) payload.birth_time_context = profile.birth_time_context;
  if (profile.nusach !== undefined) payload.nusach = profile.nusach;
  if (profile.tribe_status !== undefined) payload.tribe_status = profile.tribe_status;
  if (profile.marital_status !== undefined) payload.marital_status = profile.marital_status;
  if (profile.email !== undefined) payload.email = profile.email;
  if (profile.phone !== undefined) payload.phone = profile.phone;
  if (profile.city !== undefined) payload.city = profile.city;
  if (profile.about !== undefined) payload.about = profile.about;
  if (profile.profile_visibility !== undefined) payload.profile_visibility = profile.profile_visibility;
  if (profile.birthday_visibility !== undefined) payload.birthday_visibility = profile.birthday_visibility;
  if (profile.phone_visibility !== undefined) payload.phone_visibility = profile.phone_visibility;
  if (profile.notification_preferences !== undefined) {
    payload.notification_preferences = profile.notification_preferences;
  }
  if (profile.onboarding_completed !== undefined) {
    payload.onboarding_completed = profile.onboarding_completed;
  }

  return payload;
}

async function refreshStoredSession(refreshToken: string): Promise<ApiAuthTokenResponse | null> {
  try {
    const response = await apiClient.post<ApiAuthTokenResponse, ApiRefreshRequest>(
      '/auth/refresh',
      { refresh_token: refreshToken },
      { includeAuthToken: false },
    );

    await setApiAuthTokens(response);

    return response;
  } catch (error) {
    if (isUnauthenticatedApiError(error)) {
      await clearApiAuthTokens();
      return null;
    }

    throw error;
  }
}

async function ensureFreshTokens(): Promise<ApiStoredAuthTokens | ApiAuthTokenResponse | null> {
  const tokens = await getApiAuthTokens();

  if (!tokens?.access_token) {
    return null;
  }

  if (!shouldRefreshTokens(tokens)) {
    return tokens;
  }

  return refreshStoredSession(tokens.refresh_token);
}

async function fetchCurrentUser(): Promise<ApiCurrentUserResponse | null> {
  const tokens = await ensureFreshTokens();

  if (!tokens?.access_token) {
    return null;
  }

  try {
    return await apiClient.get<ApiCurrentUserResponse>('/auth/me');
  } catch (error) {
    if (!isUnauthenticatedApiError(error)) {
      throw error;
    }

    const refreshedTokens = await refreshStoredSession(tokens.refresh_token);

    if (!refreshedTokens) {
      return null;
    }

    try {
      return await apiClient.get<ApiCurrentUserResponse>('/auth/me');
    } catch (retryError) {
      if (isUnauthenticatedApiError(retryError)) {
        await clearApiAuthTokens();
        return null;
      }

      throw retryError;
    }
  }
}

export async function getSession(): Promise<Session | null> {
  const currentUser = await fetchCurrentUser();

  if (!currentUser) {
    return null;
  }

  const tokens = await getApiAuthTokens();

  if (!tokens) {
    return null;
  }

  return apiTokensToSession(tokens, currentUser.user);
}

export async function signIn(email: string, password: string): Promise<Session> {
  const normalizedEmail = normalizeEmail(email);

  if (!normalizedEmail || !password) {
    throw new Error('Unable to sign in. Check email and password.');
  }

  const response = await apiClient.post<ApiAuthTokenResponse, ApiLoginRequest>(
    '/auth/login',
    {
      email: normalizedEmail,
      password,
    },
    { includeAuthToken: false },
  );

  await setApiAuthTokens(response);

  return apiTokensToSession(response, response.user);
}

export async function signUpWithEmail(email: string, password: string): Promise<EmailSignUpResult> {
  const normalizedEmail = normalizeEmail(email);

  if (!normalizedEmail || !password.trim()) {
    throw new Error('Enter email and password to register.');
  }

  if (password.length < MINIMUM_PASSWORD_LENGTH) {
    throw new Error('Password must be at least ' + MINIMUM_PASSWORD_LENGTH + ' characters.');
  }

  const registerResponse = await apiClient.post<ApiRegisterResponse, ApiRegisterRequest>(
    '/auth/register',
    {
      email: normalizedEmail,
      password,
    },
    { includeAuthToken: false },
  );

  const tokenResponse = await apiClient.post<ApiAuthTokenResponse, ApiLoginRequest>(
    '/auth/login',
    {
      email: normalizedEmail,
      password,
    },
    { includeAuthToken: false },
  );
  await setApiAuthTokens(tokenResponse);
  const session = apiTokensToSession(tokenResponse, tokenResponse.user);

  return {
    session,
    user: session.user,
    profile: registerResponse.profile
      ? apiProfileToProfile(registerResponse.profile)
      : null,
    needsEmailConfirmation: false,
  };
}

export async function resendConfirmationEmail(email: string): Promise<void> {
  await requestEmailVerification(email);
}

async function requestEmailVerification(email: string): Promise<void> {
  const normalizedEmail = normalizeEmail(email);

  if (!normalizedEmail) {
    throw new Error('Enter email to request verification.');
  }

  await apiClient.post<ApiOkResponse, ApiAuthEmailRequest>(
    '/auth/request-email-verification',
    { email: normalizedEmail },
    { includeAuthToken: false },
  );
}

export async function resetPasswordForEmail(email: string): Promise<void> {
  const normalizedEmail = normalizeEmail(email);

  if (!normalizedEmail) {
    throw new Error('Enter email to reset password.');
  }

  await apiClient.post<ApiOkResponse, ApiAuthEmailRequest>(
    '/auth/request-password-reset',
    { email: normalizedEmail },
    { includeAuthToken: false },
  );
}

export async function signOut(): Promise<void> {
  const tokens = await getApiAuthTokens();

  try {
    if (tokens?.refresh_token) {
      await apiClient.post<ApiOkResponse, ApiLogoutRequest>(
        '/auth/logout',
        { refresh_token: tokens.refresh_token },
        { includeAuthToken: false },
      );
    }
  } catch {
    // Local sign-out must still clear API tokens when the remote logout fails.
  } finally {
    await clearApiAuthTokens();
  }
}

export async function loadProfile(): Promise<Profile | null> {
  const currentUser = await fetchCurrentUser();

  if (!currentUser?.profile) {
    return null;
  }

  return apiProfileToProfile(currentUser.profile);
}

export async function upsertProfile(profile: ProfileUpsert = {}): Promise<Profile> {
  const currentUser = await fetchCurrentUser();

  if (!currentUser) {
    throw new Error('Auth required');
  }

  const payload = buildProfileUpdatePayload(profile);

  if (Object.keys(payload).length === 0) {
    if (!currentUser.profile) {
      throw new Error('Profile is not available for update.');
    }

    return apiProfileToProfile(currentUser.profile);
  }

  const updatedProfile = await apiClient.patch<ApiProfileSummary, ApiProfileUpdateRequest>(
    '/me/profile',
    payload,
  );

  return apiProfileToProfile(updatedProfile);
}
