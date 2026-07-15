import { DEFAULT_BIRTHDAY_VISIBILITY, DEFAULT_PHONE_VISIBILITY, DEFAULT_PROFILE_VISIBILITY } from '@/types/profile';
import type { AppAuthSession, AppAuthUser } from '@/types/auth';
import type {
  ApiAuthEmailRequest,
  ApiAuthTokenResponse,
  ApiCurrentUserResponse,
  ApiLoginRequest,
  ApiLogoutRequest,
  ApiOkResponse,
  ApiProfileSummary,
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

const API_AUTH_REFRESH_SKEW_MS = 30_000;

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function isUnauthenticatedApiError(error: unknown): boolean {
  return error instanceof ApiClientError && error.status === 401;
}

function shouldRefreshTokens(tokens: ApiStoredAuthTokens): boolean {
  const expiresAtMs = Date.parse(tokens.expires_at);

  return !Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now() + API_AUTH_REFRESH_SKEW_MS;
}

function apiUserToAppAuthUser(user: ApiUserSummary): AppAuthUser {
  return {
    id: user.id,
    email: user.email,
    phone: user.phone,
    emailVerifiedAt: user.email_verified_at,
    phoneVerifiedAt: user.phone_verified_at,
    authMethod: 'email',
    createdAt: user.created_at,
    updatedAt: user.updated_at,
  };
}

function apiTokensToSession(
  tokens: ApiAuthTokenResponse | ApiStoredAuthTokens,
  user: ApiUserSummary,
): AppAuthSession {
  return {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    tokenType: tokens.token_type,
    expiresAt: tokens.expires_at,
    user: apiUserToAppAuthUser(user),
  };
}

function profileDisplayName(profile: ApiProfileSummary | null, user: ApiUserSummary): string | null {
  if (profile?.display_name) {
    return profile.display_name;
  }

  if (profile?.full_name) {
    return profile.full_name;
  }

  return user.email?.split('@')[0] ?? null;
}

function apiProfileToProfile(profile: ApiProfileSummary | null, user: ApiUserSummary): Profile {
  const createdAt = profile?.created_at ?? user.created_at;

  return {
    id: profile?.user_id ?? user.id,
    community_id: profile?.community_id ?? null,
    full_name: profile?.full_name ?? null,
    hebrew_name: null,
    city: profile?.city ?? null,
    created_at: createdAt,
    display_name: profileDisplayName(profile, user),
    first_name: profile?.first_name ?? null,
    last_name: profile?.last_name ?? null,
    phone: user.phone,
    email: user.email,
    avatar_url: profile?.avatar_url ?? null,
    birth_date: null,
    birth_time_context: 'unknown',
    hebrew_birth_date: null,
    tribe_status: null,
    marital_status: null,
    about: null,
    profile_visibility: DEFAULT_PROFILE_VISIBILITY,
    birthday_visibility: DEFAULT_BIRTHDAY_VISIBILITY,
    phone_visibility: DEFAULT_PHONE_VISIBILITY,
    notification_preferences: null,
    nusach: null,
    onboarding_completed: profile?.onboarding_completed ?? false,
    updated_at: profile?.updated_at ?? user.updated_at ?? null,
  };
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

export async function getSession(): Promise<AppAuthSession | null> {
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

export async function signIn(email: string, password: string): Promise<AppAuthSession> {
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
      ? apiProfileToProfile(registerResponse.profile, registerResponse.user)
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

  if (!currentUser) {
    return null;
  }

  return apiProfileToProfile(currentUser.profile, currentUser.user);
}

export async function upsertProfile(profile: ProfileUpsert = {}): Promise<Profile> {
  const currentUser = await fetchCurrentUser();

  if (!currentUser) {
    throw new Error('Auth required');
  }

  if (Object.keys(profile).length > 0) {
    throw new Error('Profile updates are not available through API auth yet.');
  }

  return apiProfileToProfile(currentUser.profile, currentUser.user);
}
