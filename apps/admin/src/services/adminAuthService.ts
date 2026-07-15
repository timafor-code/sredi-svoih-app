import type { Session } from "@supabase/supabase-js";

import * as adminAuthApiService from "./adminAuthApiService";
import { apiBaseUrl, getAdminApiProvider } from "./apiClient";
import { isSupabaseConfigured, requireSupabaseClient } from "./supabaseClient";
import type {
  AdminAuthContext,
  AdminMembership,
  AdminMembershipStatus,
  AdminProfile,
  AdminRole,
} from "../types/auth";
import type { ApiProviderName } from "../types/api";

const PROFILE_FIELDS = `
  id,
  email,
  full_name,
  display_name,
  first_name,
  last_name,
  avatar_url,
  city
`;

const MEMBERSHIP_FIELDS = `
  id,
  community_id,
  user_id,
  role,
  status,
  joined_at,
  created_at
`;

const adminRoles: AdminRole[] = ["admin", "event_manager", "member"];
const membershipStatuses: AdminMembershipStatus[] = ["pending", "active", "suspended", "left"];

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function isAdminRole(role: unknown): role is AdminRole {
  return typeof role === "string" && adminRoles.includes(role as AdminRole);
}

function isMembershipStatus(status: unknown): status is AdminMembershipStatus {
  return typeof status === "string" && membershipStatuses.includes(status as AdminMembershipStatus);
}

function toAdminMembership(value: Record<string, unknown>): AdminMembership | null {
  if (!isAdminRole(value.role) || !isMembershipStatus(value.status)) {
    return null;
  }

  return {
    id: String(value.id),
    community_id: String(value.community_id),
    user_id: String(value.user_id),
    role: value.role,
    status: value.status,
    joined_at: typeof value.joined_at === "string" ? value.joined_at : null,
    created_at: String(value.created_at),
  };
}

export function getAdminAuthProvider(): ApiProviderName {
  return getAdminApiProvider("auth");
}

// API is the PR 37 default; explicit VITE_AUTH_PROVIDER=supabase selects legacy/dev auth.
export function isAdminApiAuthProviderEnabled(): boolean {
  return getAdminAuthProvider() === "api";
}

export function isAdminAuthConfigured(): boolean {
  return isAdminApiAuthProviderEnabled() ? Boolean(apiBaseUrl) : isSupabaseConfigured;
}

export function getAdminAuthConfigurationError(): string | null {
  if (isAdminApiAuthProviderEnabled() && !apiBaseUrl) {
    return "VITE_API_URL is required before using VITE_AUTH_PROVIDER=api.";
  }

  return null;
}

export async function getCurrentSession(): Promise<Session | null> {
  if (isAdminApiAuthProviderEnabled()) {
    return adminAuthApiService.getCurrentSession();
  }

  return getCurrentSupabaseSession();
}

export async function signInWithPassword(
  email: string,
  password: string,
): Promise<Session | null> {
  if (isAdminApiAuthProviderEnabled()) {
    await adminAuthApiService.signInWithPassword(email, password);
    return null;
  }

  return signInWithSupabasePassword(email, password);
}

export async function signOut(): Promise<void> {
  if (isAdminApiAuthProviderEnabled()) {
    return adminAuthApiService.signOut();
  }

  return signOutSupabase();
}

export async function getCurrentAdminContext(): Promise<AdminAuthContext> {
  if (isAdminApiAuthProviderEnabled()) {
    return adminAuthApiService.getCurrentAdminContext();
  }

  return getCurrentSupabaseAdminContext();
}

async function getCurrentSupabaseSession(): Promise<Session | null> {
  const supabase = requireSupabaseClient();
  const { data, error } = await supabase.auth.getSession();

  if (error) {
    throw new Error(error.message);
  }

  return data.session;
}

async function signInWithSupabasePassword(email: string, password: string): Promise<Session> {
  const supabase = requireSupabaseClient();
  const normalizedEmail = normalizeEmail(email);

  if (!normalizedEmail || !password) {
    throw new Error("Введите email и пароль.");
  }

  const { data, error } = await supabase.auth.signInWithPassword({
    email: normalizedEmail,
    password,
  });

  if (error || !data.session) {
    throw new Error(error?.message ?? "Не удалось войти.");
  }

  return data.session;
}

async function signOutSupabase(): Promise<void> {
  const supabase = requireSupabaseClient();
  const { error } = await supabase.auth.signOut();

  if (error) {
    throw new Error(error.message);
  }
}

async function getCurrentSupabaseAdminContext(): Promise<AdminAuthContext> {
  const supabase = requireSupabaseClient();
  const session = await getCurrentSupabaseSession();

  if (!session) {
    return emptyAdminContext(null);
  }

  const { data: userData, error: userError } = await supabase.auth.getUser();

  if (userError) {
    throw new Error(userError.message);
  }

  const user = userData.user;

  if (!user) {
    return emptyAdminContext(null);
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select(PROFILE_FIELDS)
    .eq("id", user.id)
    .maybeSingle();

  if (profileError) {
    throw new Error(profileError.message);
  }

  const { data: membership, error: membershipError } = await supabase
    .from("community_memberships")
    .select(MEMBERSHIP_FIELDS)
    .eq("user_id", profile?.id ?? user.id)
    .eq("status", "active")
    .order("joined_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (membershipError) {
    throw new Error(membershipError.message);
  }

  const activeMembership = membership
    ? toAdminMembership(membership as Record<string, unknown>)
    : null;
  const role = activeMembership?.role ?? null;
  const isAdmin = role === "admin";
  const isEventManager = role === "event_manager";

  return {
    isAuthenticated: true,
    session,
    profile: (profile as AdminProfile | null) ?? null,
    membership: activeMembership,
    role,
    isAdmin,
    isEventManager,
    canAccessAdmin: activeMembership?.status === "active" && (isAdmin || isEventManager),
  };
}

function emptyAdminContext(session: Session | null): AdminAuthContext {
  return {
    isAuthenticated: Boolean(session),
    session,
    profile: null,
    membership: null,
    role: null,
    isAdmin: false,
    isEventManager: false,
    canAccessAdmin: false,
  };
}
