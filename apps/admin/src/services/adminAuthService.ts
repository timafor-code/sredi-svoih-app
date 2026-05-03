import type { Session } from "@supabase/supabase-js";

import { requireSupabaseClient } from "./supabaseClient";
import type {
  AdminAuthContext,
  AdminMembership,
  AdminMembershipStatus,
  AdminProfile,
  AdminRole,
} from "../types/auth";

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

export async function getCurrentSession(): Promise<Session | null> {
  const supabase = requireSupabaseClient();
  const { data, error } = await supabase.auth.getSession();

  if (error) {
    throw new Error(error.message);
  }

  return data.session;
}

export async function signInWithPassword(email: string, password: string): Promise<Session> {
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

export async function signOut(): Promise<void> {
  const supabase = requireSupabaseClient();
  const { error } = await supabase.auth.signOut();

  if (error) {
    throw new Error(error.message);
  }
}

export async function getCurrentAdminContext(): Promise<AdminAuthContext> {
  const supabase = requireSupabaseClient();
  const session = await getCurrentSession();

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
