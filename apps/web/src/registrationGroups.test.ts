import { describe, expect, it } from "vitest";
import { myRegistration } from "./test/fixtures";
import { groupMyRegistrations } from "./registrationGroups";

const NOW = Date.parse("2026-09-12T12:00:00+03:00");

describe("My Tickets grouping", () => {
  it("groups future and past non-recurring events by event time", () => {
    const future = myRegistration({ id: "77777777-7777-4777-8777-777777777701" });
    const past = myRegistration({
      id: "77777777-7777-4777-8777-777777777702",
      event: { starts_at: "2026-09-10T15:00:00+03:00", ends_at: "2026-09-10T18:00:00+03:00" },
    });

    const groups = groupMyRegistrations([future, past], NOW);
    expect(groups.active.map((item) => item.id)).toEqual([future.id]);
    expect(groups.past.map((item) => item.id)).toEqual([past.id]);
  });

  it("uses the selected occurrence instead of the parent event", () => {
    const futureOccurrence = myRegistration({
      id: "77777777-7777-4777-8777-777777777703",
      event: { starts_at: "2026-09-01T15:00:00+03:00", ends_at: "2026-09-01T18:00:00+03:00" },
      occurrence: { starts_at: "2026-09-14T15:00:00+03:00", ends_at: "2026-09-14T18:00:00+03:00" },
    });
    const pastOccurrence = myRegistration({
      id: "77777777-7777-4777-8777-777777777704",
      event: { starts_at: "2026-09-20T15:00:00+03:00", ends_at: "2026-09-20T18:00:00+03:00" },
      occurrence: { starts_at: "2026-09-08T15:00:00+03:00", ends_at: "2026-09-08T18:00:00+03:00" },
    });

    const groups = groupMyRegistrations([futureOccurrence, pastOccurrence], NOW);
    expect(groups.active.map((item) => item.id)).toEqual([futureOccurrence.id]);
    expect(groups.past.map((item) => item.id)).toEqual([pastOccurrence.id]);
  });

  it("never uses registration creation time to decide the period", () => {
    const futureEventCreatedLongAgo = myRegistration({
      id: "77777777-7777-4777-8777-777777777705",
      created_at: "2020-01-01T00:00:00Z",
      registered_at: "2020-01-01T00:00:00Z",
    });
    const pastEventCreatedInFuture = myRegistration({
      id: "77777777-7777-4777-8777-777777777706",
      created_at: "2030-01-01T00:00:00Z",
      registered_at: "2030-01-01T00:00:00Z",
      event: { starts_at: "2026-09-10T15:00:00+03:00", ends_at: "2026-09-10T18:00:00+03:00" },
    });

    const groups = groupMyRegistrations([futureEventCreatedLongAgo, pastEventCreatedInFuture], NOW);
    expect(groups.active.map((item) => item.id)).toContain(futureEventCreatedLongAgo.id);
    expect(groups.past.map((item) => item.id)).toContain(pastEventCreatedInFuture.id);
  });

  it("keeps mobile semantics for cancelled registrations by grouping on event time", () => {
    const futureCancelled = myRegistration({
      id: "77777777-7777-4777-8777-777777777707",
      status: "cancelled",
    });

    expect(groupMyRegistrations([futureCancelled], NOW).active).toEqual([futureCancelled]);
  });
});
