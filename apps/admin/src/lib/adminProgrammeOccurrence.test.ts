import { describe, expect, it } from "vitest";

import type { AdminEventOccurrence } from "../types/eventOccurrences";
import { selectAdminProgrammeOccurrence } from "./adminProgrammeOccurrence";

const SERVER_NOW = "2026-10-15T12:00:00.000Z";

function occurrence(overrides: Partial<AdminEventOccurrence>): AdminEventOccurrence {
  return {
    id: "occurrence-a",
    eventId: "event-a",
    title: null,
    startsAt: "2026-10-16T15:00:00.000Z",
    endsAt: "2026-10-17T20:00:00.000Z",
    timezone: "Europe/Moscow",
    registrationOpensAt: null,
    registrationClosesAt: null,
    capacity: null,
    waitlistEnabled: null,
    requiresApproval: null,
    status: "active",
    sortOrder: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    serverNow: SERVER_NOW,
    isRegistrationAlwaysOpen: false,
    registrationState: "open",
    registrationStateReason: null,
    ...overrides,
  };
}

describe("selectAdminProgrammeOccurrence", () => {
  it("selects the earliest active occurrence that has not reached its terminal boundary", () => {
    const result = selectAdminProgrammeOccurrence([
      occurrence({ id: "later", startsAt: "2026-10-23T15:00:00.000Z" }),
      occurrence({ id: "earlier", startsAt: "2026-10-16T15:00:00.000Z" }),
      occurrence({ id: "ended", startsAt: "2026-10-10T15:00:00.000Z", endsAt: "2026-10-11T20:00:00.000Z" }),
    ]);

    expect(result).toMatchObject({ kind: "selected", occurrence: { id: "earlier" } });
  });

  it("excludes non-active and ended rows regardless of API ordering", () => {
    const rows = [
      occurrence({ id: "hidden", status: "hidden" }),
      occurrence({ id: "cancelled", status: "cancelled" }),
      occurrence({ id: "archived", status: "archived" }),
      occurrence({ id: "ended", startsAt: "2026-10-01T15:00:00.000Z", endsAt: null }),
      occurrence({ id: "b", startsAt: "2026-10-16T15:00:00.000Z" }),
      occurrence({ id: "a", startsAt: "2026-10-16T15:00:00.000Z" }),
    ];

    expect(selectAdminProgrammeOccurrence(rows)).toMatchObject({ kind: "selected", occurrence: { id: "a" } });
    expect(selectAdminProgrammeOccurrence([...rows].reverse())).toMatchObject({ kind: "selected", occurrence: { id: "a" } });
  });

  it("does not skip a still-relevant occurrence whose registration is closed", () => {
    const result = selectAdminProgrammeOccurrence([
      occurrence({ id: "closed", registrationState: "closed" }),
      occurrence({ id: "open-later", startsAt: "2026-10-23T15:00:00.000Z", registrationState: "open" }),
    ]);

    expect(result).toMatchObject({ kind: "selected", occurrence: { id: "closed" } });
  });

  it("fails safely when occurrence data does not contain one valid server timestamp", () => {
    expect(selectAdminProgrammeOccurrence(null)).toEqual({ kind: "invalid" });
    expect(selectAdminProgrammeOccurrence([occurrence({ serverNow: null })])).toEqual({ kind: "invalid" });
    expect(selectAdminProgrammeOccurrence([occurrence({ startsAt: "not-a-date" })])).toEqual({ kind: "invalid" });
  });
});
