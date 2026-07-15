import { apiClient, ApiClientError } from "./apiClient";
import {
  clearAdminApiAuthTokens,
  getAdminApiAuthTokens,
  setAdminApiAuthTokens,
} from "./adminApiAuthTokenStore";
import type {
  AdminApiAuthTokenResponse,
  AdminApiCurrentUserResponse,
  AdminApiLoginRequest,
  AdminApiLogoutRequest,
  AdminApiMembershipSummary,
  AdminApiOkResponse,
  AdminApiProfileSummary,
  AdminApiRefreshRequest,
  AdminApiStoredAuthTokens,
  AdminApiUserSummary,
} from "../types/api";
import type {
  AdminAuthContext,
  AdminAuthSession,
  AdminMembership,
  AdminMembershipStatus,
  AdminProfile,
  AdminRole,
} from "../types/auth";

const API_AUTH_REFRESH_SKEW_MS = 30_000;

const adminRoles: AdminRole[] = ["admin", "event_manager", "member"];
const membershipStatuses: AdminMembershipStatus[] = ["pending", "active", "suspended", "left"];

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function isUnauthenticatedApiError(error: unknown): boolean {
  return error instanceof ApiClientError && error.status === 401;
}

function shouldRefreshTokens(tokens: AdminApiStoredAuthTokens): boolean {
  if (!tokens.expires_at) {
    return false;
  }

  const expiresAtMs = Date.parse(tokens.expires_at);

  return Number.isFinite(expiresAtMs) && expiresAtMs <= Date.now() + API_AUTH_REFRESH_SKEW_MS;
}

function isAdminRole(role: unknown): role is AdminRole {
  return typeof role === "string" && adminRoles.includes(role as AdminRole);
}

function isMembershipStatus(status: unknown): status is AdminMembershipStatus {
  return typeof status === "string" && membershipStatuses.includes(status as AdminMembershipStatus);
}

function toAdminProfile(
  profile: AdminApiProfileSummary | null,
  user: AdminApiUserSummary,
): AdminProfile {
  return {
    id: profile?.user_id ?? user.id,
    email: user.email,
    full_name: profile?.full_name ?? null,
    display_name: profile?.display_name ?? null,
    first_name: profile?.first_name ?? null,
    last_name: profile?.last_name ?? null,
    avatar_url: profile?.avatar_url ?? null,
    city: profile?.city ?? null,
  };
}

function toAdminMembership(
  value: AdminApiMembershipSummary,
  userId: string,
): AdminMembership | null {
  if (!isAdminRole(value.role) || !isMembershipStatus(value.status)) {
    return null;
  }

  return {
    id: value.id,
    community_id: value.community_id,
    community_name: value.community?.name ?? null,
    community: value.community
      ? {
          id: value.community.id,
          name: value.community.name,
        }
      : null,
    user_id: value.user_id ?? userId,
    role: value.role,
    status: value.status,
    joined_at: value.joined_at,
    created_at: value.created_at,
  };
}

function chooseActiveMembership(
  memberships: AdminApiMembershipSummary[],
  userId: string,
): AdminMembership | null {
  const activeMemberships = memberships
    .map((membership) => toAdminMembership(membership, userId))
    .filter((membership): membership is AdminMembership => membership !== null)
    .filter((membership) => membership.status === "active");

  return (
    activeMemberships.find((membership) => (
      membership.role === "admin" || membership.role === "event_manager"
    )) ??
    activeMemberships.find((membership) => membership.role === "member") ??
    null
  );
}

async function refreshStoredTokens(
  refreshToken: string,
): Promise<AdminApiAuthTokenResponse | null> {
  try {
    const response = await apiClient.post<AdminApiAuthTokenResponse, AdminApiRefreshRequest>(
      "/auth/refresh",
      { refresh_token: refreshToken },
      { includeAuthToken: false },
    );

    setAdminApiAuthTokens(response);

    return response;
  } catch (error) {
    if (isUnauthenticatedApiError(error)) {
      clearAdminApiAuthTokens();
      return null;
    }

    throw error;
  }
}

async function ensureFreshTokens(): Promise<
  AdminApiStoredAuthTokens | AdminApiAuthTokenResponse | null
> {
  const tokens = getAdminApiAuthTokens();

  if (!tokens?.access_token) {
    return null;
  }

  if (!shouldRefreshTokens(tokens)) {
    return tokens;
  }

  return refreshStoredTokens(tokens.refresh_token);
}

async function fetchCurrentUser(): Promise<AdminApiCurrentUserResponse | null> {
  const tokens = await ensureFreshTokens();

  if (!tokens?.access_token) {
    return null;
  }

  try {
    return await apiClient.get<AdminApiCurrentUserResponse>("/auth/me");
  } catch (error) {
    if (!isUnauthenticatedApiError(error)) {
      throw error;
    }

    const refreshedTokens = await refreshStoredTokens(tokens.refresh_token);

    if (!refreshedTokens) {
      return null;
    }

    try {
      return await apiClient.get<AdminApiCurrentUserResponse>("/auth/me");
    } catch (retryError) {
      if (isUnauthenticatedApiError(retryError)) {
        clearAdminApiAuthTokens();
        return null;
      }

      throw retryError;
    }
  }
}

export async function getCurrentSession(): Promise<AdminAuthSession | null> {
  const currentUser = await fetchCurrentUser();
  return currentUser
    ? { user: { id: currentUser.user.id, email: currentUser.user.email } }
    : null;
}

export async function signInWithPassword(
  email: string,
  password: string,
): Promise<AdminApiAuthTokenResponse> {
  const normalizedEmail = normalizeEmail(email);

  if (!normalizedEmail || !password) {
    throw new Error("Enter email and password.");
  }

  const response = await apiClient.post<AdminApiAuthTokenResponse, AdminApiLoginRequest>(
    "/auth/login",
    {
      email: normalizedEmail,
      password,
    },
    { includeAuthToken: false },
  );

  setAdminApiAuthTokens(response);

  return response;
}

export async function signOut(): Promise<void> {
  const tokens = getAdminApiAuthTokens();

  try {
    if (tokens?.refresh_token) {
      await apiClient.post<AdminApiOkResponse, AdminApiLogoutRequest>(
        "/auth/logout",
        { refresh_token: tokens.refresh_token },
        { includeAuthToken: false },
      );
    }
  } catch {
    // Local sign-out must clear API tokens even when the remote logout fails.
  } finally {
    clearAdminApiAuthTokens();
  }
}

export async function getCurrentAdminContext(): Promise<AdminAuthContext> {
  const currentUser = await fetchCurrentUser();

  if (!currentUser) {
    return emptyAdminContext();
  }

  const membership = chooseActiveMembership(currentUser.memberships, currentUser.user.id);
  const role = membership?.role ?? null;
  const isAdmin = role === "admin";
  const isEventManager = role === "event_manager";

  return {
    isAuthenticated: true,
    session: { user: { id: currentUser.user.id, email: currentUser.user.email } },
    profile: toAdminProfile(currentUser.profile, currentUser.user),
    membership,
    role,
    isAdmin,
    isEventManager,
    canAccessAdmin: membership?.status === "active" && (isAdmin || isEventManager),
  };
}

function emptyAdminContext(): AdminAuthContext {
  return {
    isAuthenticated: false,
    session: null,
    profile: null,
    membership: null,
    role: null,
    isAdmin: false,
    isEventManager: false,
    canAccessAdmin: false,
  };
}
