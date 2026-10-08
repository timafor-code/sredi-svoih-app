import { describe, expect, it } from "vitest";

import { canAddParticipantForEvent } from "./RegistrationMainActions";
import type { AdminMembership } from "../../types/auth";

function membership(
  communityId: string,
  role: AdminMembership["role"] | "rabbi",
  status: AdminMembership["status"] = "active",
): AdminMembership {
  return {
    id: `${communityId}-${role}-${status}`,
    community_id: communityId,
    community_name: null,
    community: null,
    user_id: "operator",
    role: role as AdminMembership["role"],
    status,
    joined_at: null,
    created_at: "2026-01-01T00:00:00Z",
  };
}

function event(communityId: string, registrationMode: string) {
  return { communityId, registrationMode };
}

describe("Add Participant event-community permission", () => {
  it("allows active Admins for internal free and paid events in their community", () => {
    const memberships = [membership("community-a", "admin")];

    expect(canAddParticipantForEvent(event("community-a", "internal_free"), memberships)).toBe(true);
    expect(canAddParticipantForEvent(event("community-a", "internal_paid"), memberships)).toBe(true);
  });

  it("allows active Event Managers in the selected community", () => {
    expect(canAddParticipantForEvent(
      event("community-a", "internal_free"),
      [membership("community-a", "event_manager")],
    )).toBe(true);
  });

  it("uses the selected event community instead of a global Admin role", () => {
    expect(canAddParticipantForEvent(
      event("community-b", "internal_free"),
      [membership("community-a", "admin"), membership("community-b", "event_manager")],
    )).toBe(true);
    expect(canAddParticipantForEvent(
      event("community-b", "internal_paid"),
      [membership("community-a", "event_manager"), membership("community-b", "admin")],
    )).toBe(true);
  });

  it("rejects inactive operator memberships and unsupported registration modes", () => {
    for (const status of ["pending", "suspended", "left"] as const) {
      expect(canAddParticipantForEvent(
        event("community-a", "internal_free"),
        [membership("community-a", "admin", status)],
      )).toBe(false);
      expect(canAddParticipantForEvent(
        event("community-a", "internal_free"),
        [membership("community-a", "event_manager", status)],
      )).toBe(false);
    }
    const memberships = [membership("community-a", "admin")];
    expect(canAddParticipantForEvent(event("community-a", "none"), memberships)).toBe(false);
    expect(canAddParticipantForEvent(event("community-a", "external_link"), memberships)).toBe(false);
  });

  it("does not allow member or Rabbi memberships", () => {
    expect(canAddParticipantForEvent(
      event("community-a", "internal_free"),
      [membership("community-a", "member")],
    )).toBe(false);
    expect(canAddParticipantForEvent(
      event("community-a", "internal_free"),
      [membership("community-a", "rabbi")],
    )).toBe(false);
  });
});
