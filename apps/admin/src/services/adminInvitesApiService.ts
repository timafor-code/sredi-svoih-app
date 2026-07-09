import { apiClient } from "./apiClient";
import type {
  AdminApiInviteCreateRequest,
  AdminApiInviteCreateResponse,
} from "../types/api";
import {
  ADMIN_INVITE_ROLES,
  ADMIN_INVITE_STATUSES,
  type AdminCreatedInvite,
  type AdminCreateInviteInput,
  type AdminInviteRole,
  type AdminInviteStatus,
} from "../types/invites";

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

function trimmedStringOrNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function buildCreateInviteRequest(
  input: AdminCreateInviteInput,
): AdminApiInviteCreateRequest {
  return {
    community_id: input.communityId,
    role: input.role,
    email: trimmedStringOrNull(input.email),
    phone: trimmedStringOrNull(input.phone),
    max_uses:
      typeof input.maxUses === "number" && Number.isFinite(input.maxUses)
        ? input.maxUses
        : 1,
    expires_at: trimmedStringOrNull(input.expiresAt),
  };
}

function normalizeAdminCreatedInvite(
  row: AdminApiInviteCreateResponse,
): AdminCreatedInvite {
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

export async function createAdminInvite(
  input: AdminCreateInviteInput,
): Promise<AdminCreatedInvite> {
  const row = await apiClient.post<
    AdminApiInviteCreateResponse | null,
    AdminApiInviteCreateRequest
  >("/admin/invites", buildCreateInviteRequest(input));

  if (!row) {
    throw new Error("Admin create invite API returned an empty result.");
  }

  return normalizeAdminCreatedInvite(row);
}
