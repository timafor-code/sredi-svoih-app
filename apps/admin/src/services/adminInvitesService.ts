import { requireSupabaseClient } from "./supabaseClient";
import {
  ADMIN_INVITE_ROLES,
  ADMIN_INVITE_STATUSES,
  type AdminCreatedInvite,
  type AdminCreateInviteInput,
  type AdminInviteRole,
  type AdminInviteStatus,
} from "../types/invites";

const ADMIN_INVITES_RPC_NOT_FOUND_MESSAGE =
  "Admin invite RPC not found. Apply admin invite migration first.";

const ADMIN_INVITES_ACCESS_DENIED_MESSAGE =
  "Недостаточно прав: создание приглашений доступно только администратору общины.";

type SupabaseRpcError = {
  code?: string;
  message?: string;
  details?: string | null;
  hint?: string | null;
};

type AdminCreatedInviteRpcRow = {
  invite_id?: unknown;
  community_id?: unknown;
  code?: unknown;
  role?: unknown;
  email?: unknown;
  phone?: unknown;
  max_uses?: unknown;
  used_count?: unknown;
  expires_at?: unknown;
  status?: unknown;
  created_by?: unknown;
  created_at?: unknown;
};

function nullableString(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  return typeof value === "string" ? value : String(value);
}

function requiredString(value: unknown, fallback: string): string {
  const normalized = nullableString(value);
  return normalized && normalized.trim().length > 0 ? normalized : fallback;
}

function safeNumber(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  return fallback;
}

function normalizeInviteRole(value: unknown): AdminInviteRole {
  const normalized = requiredString(value, "member");
  return (ADMIN_INVITE_ROLES as readonly string[]).includes(normalized)
    ? (normalized as AdminInviteRole)
    : "member";
}

function normalizeInviteStatus(value: unknown): AdminInviteStatus {
  const normalized = requiredString(value, "active");
  return (ADMIN_INVITE_STATUSES as readonly string[]).includes(normalized)
    ? (normalized as AdminInviteStatus)
    : "active";
}

function normalizeAdminCreatedInvite(row: AdminCreatedInviteRpcRow): AdminCreatedInvite {
  return {
    inviteId: requiredString(row.invite_id, ""),
    communityId: requiredString(row.community_id, ""),
    code: requiredString(row.code, ""),
    role: normalizeInviteRole(row.role),
    email: nullableString(row.email),
    phone: nullableString(row.phone),
    maxUses: safeNumber(row.max_uses, 1),
    usedCount: safeNumber(row.used_count, 0),
    expiresAt: nullableString(row.expires_at),
    status: normalizeInviteStatus(row.status),
    createdBy: nullableString(row.created_by),
    createdAt: nullableString(row.created_at),
  };
}

function normalizeSingleAdminCreatedInvite(
  data: AdminCreatedInviteRpcRow | AdminCreatedInviteRpcRow[] | null,
): AdminCreatedInvite {
  const row = Array.isArray(data) ? data[0] : data;

  if (!row) {
    throw new Error("Admin create invite RPC returned an empty result.");
  }

  return normalizeAdminCreatedInvite(row);
}

function errorText(error: SupabaseRpcError): string {
  return [error.message, error.details, error.hint].filter(Boolean).join(" ");
}

function isRpcNotFoundError(error: SupabaseRpcError): boolean {
  const text = errorText(error).toLowerCase();

  return (
    error.code === "PGRST202" ||
    error.code === "42883" ||
    text.includes("could not find the function") ||
    (text.includes("schema cache") && text.includes("admin_"))
  );
}

function isAccessDeniedError(error: SupabaseRpcError): boolean {
  const text = errorText(error).toLowerCase();

  return (
    error.code === "42501" ||
    text.includes("access denied") ||
    text.includes("permission denied") ||
    text.includes("insufficient privilege")
  );
}

function formatSupabaseError(action: string, error: SupabaseRpcError): string {
  if (isRpcNotFoundError(error)) {
    return ADMIN_INVITES_RPC_NOT_FOUND_MESSAGE;
  }

  if (isAccessDeniedError(error)) {
    return ADMIN_INVITES_ACCESS_DENIED_MESSAGE;
  }

  const details = errorText(error);
  return `${action} failed: ${details || "Unknown Supabase error"}`;
}

type AdminCreateInvitePayload = {
  communityId: string;
  role: AdminInviteRole;
  email?: string;
  phone?: string;
  maxUses?: number;
  expiresAt?: string;
};

function buildCreateInvitePayload(input: AdminCreateInviteInput): AdminCreateInvitePayload {
  const payload: AdminCreateInvitePayload = {
    communityId: input.communityId,
    role: input.role,
  };

  const email = input.email?.trim();
  if (email) {
    payload.email = email;
  }

  const phone = input.phone?.trim();
  if (phone) {
    payload.phone = phone;
  }

  if (typeof input.maxUses === "number" && Number.isFinite(input.maxUses)) {
    payload.maxUses = input.maxUses;
  }

  const expiresAt = input.expiresAt?.trim();
  if (expiresAt) {
    payload.expiresAt = expiresAt;
  }

  return payload;
}

/**
 * Creates a community invite through `admin_create_invite`.
 *
 * The acting admin is derived server-side from the authenticated session; the
 * payload never carries an admin identity. The returned `code` is the plaintext
 * invite code, surfaced exactly once. Only its hash is persisted, so callers
 * must capture it from this result.
 */
export async function createAdminInvite(
  input: AdminCreateInviteInput,
): Promise<AdminCreatedInvite> {
  const supabase = requireSupabaseClient();
  const payload = buildCreateInvitePayload(input);
  const { data, error } = await supabase.rpc("admin_create_invite", { payload });

  if (error) {
    throw new Error(formatSupabaseError("Create admin invite", error));
  }

  return normalizeSingleAdminCreatedInvite(
    data as AdminCreatedInviteRpcRow | AdminCreatedInviteRpcRow[] | null,
  );
}
