export const ADMIN_INVITE_ROLES = [
  "member",
  "event_manager",
  "admin",
  "rabbi",
] as const;

export type AdminInviteRole = (typeof ADMIN_INVITE_ROLES)[number];

export const ADMIN_INVITE_STATUSES = [
  "active",
  "used",
  "expired",
  "revoked",
] as const;

export type AdminInviteStatus = (typeof ADMIN_INVITE_STATUSES)[number];

/**
 * Input for creating a community invite through the admin RPC.
 *
 * `communityId` and `role` are required by the service wrapper. `email`,
 * `phone`, `maxUses`, and `expiresAt` are optional. `expiresAt`, when provided,
 * must be an ISO timestamp string in the future.
 */
export interface AdminCreateInviteInput {
  communityId: string;
  role: AdminInviteRole;
  email?: string | null;
  phone?: string | null;
  maxUses?: number | null;
  expiresAt?: string | null;
}

/**
 * Result of a successful invite creation.
 *
 * `code` is the plaintext invite code. It is returned by the RPC exactly once
 * and is never stored in plaintext; only its hash lives in the database.
 */
export interface AdminCreatedInvite {
  inviteId: string;
  communityId: string;
  code: string;
  role: AdminInviteRole;
  email: string | null;
  phone: string | null;
  maxUses: number;
  usedCount: number;
  expiresAt: string | null;
  status: AdminInviteStatus;
  createdBy: string | null;
  createdAt: string | null;
}
