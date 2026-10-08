import { describe, expect, it } from "vitest";
import type { AdminRegistrationEventSummary } from "../types/registrations";
import {
  getRegistrationEventList,
  getRegistrationEventListEntry,
  readRegistrationEventListPreferences,
  validateRegistrationEventListPreferences,
} from "./registrationEventList";

const NOW = Date.parse("2026-10-08T12:00:00.000Z");

function event(
  eventId: string,
  overrides: Partial<AdminRegistrationEventSummary> = {},
): AdminRegistrationEventSummary {
  return {
    eventId,
    communityId: "community",
    title: eventId,
    startsAt: "2026-10-01T12:00:00.000Z",
    endsAt: null,
    status: "published",
    isPermanent: false,
    eventKind: "single",
    registrationMode: "internal_free",
    capacity: null,
    occurrenceCount: 0,
    occurrences: [],
    confirmedCount: 0,
    pendingCount: 0,
    waitlistedCount: 0,
    cancelledCount: 0,
    rejectedCount: 0,
    attendedCount: 0,
    noShowCount: 0,
    ...overrides,
  };
}

function ids(events: readonly { event: AdminRegistrationEventSummary }[]): string[] {
  return events.map((entry) => entry.event.eventId);
}

describe("registration event list", () => {
  it("separates past, future, and ongoing single events", () => {
    const events = [
      event("past"),
      event("future", { startsAt: "2026-10-10T12:00:00.000Z" }),
      event("ongoing", {
        startsAt: "2026-10-08T10:00:00.000Z",
        endsAt: "2026-10-08T14:00:00.000Z",
      }),
    ];

    expect(ids(getRegistrationEventList(events, { tab: "current", sort: "nearest", query: "", now: NOW })))
      .toEqual(["ongoing", "future"]);
    expect(ids(getRegistrationEventList(events, { tab: "archive", sort: "nearest", query: "", now: NOW })))
      .toEqual(["past"]);
  });

  it("uses concrete occurrence dates instead of a historical recurring parent", () => {
    const recurring = event("recurring", {
      startsAt: "2020-01-01T10:00:00.000Z",
      occurrenceCount: 2,
      occurrences: [
        { startsAt: "2026-10-01T10:00:00.000Z", endsAt: null, status: "active" },
        { startsAt: "2026-10-12T10:00:00.000Z", endsAt: null, status: "active" },
      ],
    });

    const entry = getRegistrationEventListEntry(recurring, "current", NOW);
    expect(entry?.effectiveDate).toBe("2026-10-12T10:00:00.000Z");
    expect(getRegistrationEventListEntry(recurring, "archive", NOW)).toBeNull();
  });

  it("archives recurring and permanent parents when their concrete occurrences have ended", () => {
    const endedSeries = event("permanent", {
      isPermanent: true,
      startsAt: "2020-01-01T10:00:00.000Z",
      occurrenceCount: 2,
      occurrences: [
        { startsAt: "2026-09-20T10:00:00.000Z", endsAt: null, status: "active" },
        { startsAt: "2026-10-01T10:00:00.000Z", endsAt: null, status: "hidden" },
      ],
    });

    expect(getRegistrationEventListEntry(endedSeries, "current", NOW)).toBeNull();
    expect(getRegistrationEventListEntry(endedSeries, "archive", NOW)?.effectiveDate)
      .toBe("2026-10-01T10:00:00.000Z");
  });

  it("honors event archive/cancellation and excludes archived occurrences from current sessions", () => {
    const cancelledEvent = event("cancelled-event", {
      status: "cancelled",
      startsAt: "2026-10-12T10:00:00.000Z",
    });
    const cancelledOccurrence = event("cancelled-occurrence", {
      occurrenceCount: 1,
      occurrences: [{ startsAt: "2026-10-12T10:00:00.000Z", endsAt: null, status: "cancelled" }],
    });
    const liveOccurrence = event("live-occurrence", {
      occurrenceCount: 2,
      occurrences: [
        { startsAt: "2026-10-12T10:00:00.000Z", endsAt: null, status: "cancelled" },
        { startsAt: "2026-10-13T10:00:00.000Z", endsAt: null, status: "active" },
      ],
    });

    expect(getRegistrationEventListEntry(cancelledEvent, "current", NOW)).toBeNull();
    expect(getRegistrationEventListEntry(cancelledEvent, "archive", NOW)).not.toBeNull();
    expect(getRegistrationEventListEntry(cancelledOccurrence, "current", NOW)).toBeNull();
    expect(getRegistrationEventListEntry(cancelledOccurrence, "archive", NOW)).not.toBeNull();
    expect(getRegistrationEventListEntry(liveOccurrence, "current", NOW)?.effectiveDate)
      .toBe("2026-10-13T10:00:00.000Z");
  });

  it("orders every mode with deterministic date and id tie-breakers", () => {
    const events = [
      event("b", { title: "Яблоко", startsAt: "2026-10-11T10:00:00.000Z", pendingCount: 1 }),
      event("a", { title: "Арбуз", startsAt: "2026-10-10T10:00:00.000Z", confirmedCount: 3 }),
      event("c", { title: "Борщ", startsAt: "2026-10-10T10:00:00.000Z", confirmedCount: 3, cancelledCount: 8 }),
      event("d", { title: "Вишня", startsAt: "2026-10-12T10:00:00.000Z", pendingCount: 5 }),
      event("e", { title: "Ежевика", startsAt: "2026-10-10T10:00:00.000Z", confirmedCount: 3 }),
    ];
    const base = { tab: "current" as const, query: "", now: NOW };

    expect(ids(getRegistrationEventList(events, { ...base, sort: "nearest" }))).toEqual(["a", "c", "e", "b", "d"]);
    expect(ids(getRegistrationEventList(events, { ...base, sort: "latest" }))).toEqual(["d", "b", "a", "c", "e"]);
    expect(ids(getRegistrationEventList(events, { ...base, sort: "registrations" }))).toEqual(["c", "d", "a", "e", "b"]);
    expect(ids(getRegistrationEventList(events, { ...base, sort: "new" }))).toEqual(["d", "a", "c", "e", "b"]);
    expect(ids(getRegistrationEventList(events, { ...base, sort: "title" }))).toEqual(["a", "c", "d", "e", "b"]);
  });

  it("combines search with the selected tab and sorting without mutating the source", () => {
    const events = [
      event("archive", { title: "Встреча", startsAt: "2026-09-01T10:00:00.000Z" }),
      event("current-b", { title: "Встреча Б", startsAt: "2026-10-12T10:00:00.000Z" }),
      event("current-a", { title: "Встреча А", startsAt: "2026-10-11T10:00:00.000Z" }),
    ];

    expect(ids(getRegistrationEventList(events, {
      tab: "current", sort: "title", query: "встреча", now: NOW,
    }))).toEqual(["current-a", "current-b"]);
    expect(events.map((item) => item.eventId)).toEqual(["archive", "current-b", "current-a"]);
  });

  it("handles empty lists and invalid timestamps safely", () => {
    expect(getRegistrationEventList([], { tab: "current", sort: "nearest", query: "", now: NOW })).toEqual([]);
    expect(getRegistrationEventListEntry(event("invalid", { startsAt: "not-a-date" }), "current", NOW)).toBeNull();
    expect(getRegistrationEventListEntry(event("invalid", { startsAt: "not-a-date" }), "archive", NOW)).not.toBeNull();
  });

  it("validates restored preferences and falls back safely when storage is unavailable", () => {
    expect(validateRegistrationEventListPreferences({ tab: "archive", sort: "title" }))
      .toEqual({ tab: "archive", sort: "title" });
    expect(validateRegistrationEventListPreferences({ tab: "bad", sort: "bad" }))
      .toEqual({ tab: "current", sort: "nearest" });
    expect(readRegistrationEventListPreferences({ getItem: () => "{" }))
      .toEqual({ tab: "current", sort: "nearest" });
    expect(readRegistrationEventListPreferences(null))
      .toEqual({ tab: "current", sort: "nearest" });
  });
});
