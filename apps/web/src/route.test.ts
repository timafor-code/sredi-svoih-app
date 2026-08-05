import { describe, expect, it, vi } from "vitest";
import { parseRoute, replaceOccurrenceQuery } from "./route";
import { EVENT_ID, OCCURRENCE_ONE_ID } from "./test/fixtures";

describe("public event route", () => {
  it("accepts only an exact UUID event route", () => {
    expect(parseRoute(`/events/${EVENT_ID}`, "")).toEqual({
      kind: "event",
      eventId: EVENT_ID,
      requestedOccurrenceId: null,
    });
    expect(parseRoute(`/events/${EVENT_ID}/register`, "")).toEqual({ kind: "invalid" });
    expect(parseRoute("/events", "")).toEqual({ kind: "invalid" });
  });

  it("accepts only a UUID occurrence query", () => {
    expect(parseRoute(`/events/${EVENT_ID}`, `?occurrence=${OCCURRENCE_ONE_ID}`)).toMatchObject({
      requestedOccurrenceId: OCCURRENCE_ONE_ID,
    });
    expect(parseRoute(`/events/${EVENT_ID}`, "?occurrence=not-a-uuid")).toMatchObject({
      requestedOccurrenceId: null,
    });
  });

  it("changes only the occurrence query parameter", () => {
    window.history.replaceState(null, "", `/events/${EVENT_ID}?source=invite&occurrence=old#details`);
    const replaceSpy = vi.spyOn(window.history, "replaceState");
    replaceOccurrenceQuery(OCCURRENCE_ONE_ID);
    expect(window.location.pathname).toBe(`/events/${EVENT_ID}`);
    expect(window.location.search).toBe(`?source=invite&occurrence=${OCCURRENCE_ONE_ID}`);
    expect(window.location.hash).toBe("#details");
    expect(replaceSpy).toHaveBeenCalledOnce();
  });
});
