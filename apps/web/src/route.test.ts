import { describe, expect, it, vi } from "vitest";
import {
  isCanonicalPublicPath,
  parseRoute,
  replaceCanonicalEventPath,
} from "./route";
import {
  EVENT_ID,
  OCCURRENCE_ONE_ID,
  OCCURRENCE_TWO_ID,
} from "./test/fixtures";

describe("public event route", () => {
  it("distinguishes canonical, alias-format, and legacy UUID routes", () => {
    expect(parseRoute("/events/shabbat-dlya-druzey", "")).toEqual({
      kind: "slug",
      value: "shabbat-dlya-druzey",
      requestedOccurrenceId: null,
    });
    expect(parseRoute("/events/staryy-adres", "")).toMatchObject({
      kind: "slug",
      value: "staryy-adres",
    });
    expect(parseRoute(`/events/${EVENT_ID}`, "")).toEqual({
      kind: "uuid",
      value: EVENT_ID,
      requestedOccurrenceId: null,
    });
  });

  it.each([
    "/events/Shabbat",
    "/events/Шабат",
    "/events/bad--slug",
    "/events/a",
    `/events/${"a".repeat(81)}`,
    "/events/shabbat/register",
    "/events",
  ])("rejects an unsupported route: %s", (path) => {
    expect(parseRoute(path, "")).toEqual({ kind: "invalid" });
  });

  it("preserves only a valid UUID occurrence candidate", () => {
    expect(parseRoute(`/events/${EVENT_ID}`, `?occurrence=${OCCURRENCE_ONE_ID}`)).toMatchObject({
      requestedOccurrenceId: OCCURRENCE_ONE_ID,
    });
    expect(parseRoute("/events/shabbat", "?occurrence=not-a-uuid")).toMatchObject({
      requestedOccurrenceId: null,
    });
  });

  it.each([
    "/events/shabbat",
    "/events/tsikl-lektsiy-po-istorii",
  ])("accepts a safe canonical response path: %s", (path) => {
    expect(isCanonicalPublicPath(path)).toBe(true);
  });

  it.each([
    "https://example.invalid/events/shabbat",
    "//example.invalid/events/shabbat",
    "/events/shabbat?occurrence=x",
    "/events/shabbat#details",
    "/events/shabbat/extra",
    "/events/Shabbat",
    "/events/admin",
    "/events/123e4567-e89b-12d3-a456-426614174000",
    "/events/shabbat\\extra",
  ])("rejects an unsafe canonical response path: %s", (path) => {
    expect(isCanonicalPublicPath(path)).toBe(false);
  });

  it("canonicalizes once, keeps a returned occurrence, drops unknown query, and preserves hash", () => {
    window.history.replaceState(null, "", `/events/old-alias?source=invite&occurrence=${OCCURRENCE_ONE_ID}#details`);
    const replaceSpy = vi.spyOn(window.history, "replaceState");
    replaceCanonicalEventPath(
      "/events/shabbat",
      OCCURRENCE_ONE_ID,
      "user_select",
      [OCCURRENCE_ONE_ID, OCCURRENCE_TWO_ID],
    );
    expect(`${window.location.pathname}${window.location.search}${window.location.hash}`).toBe(
      `/events/shabbat?occurrence=${OCCURRENCE_ONE_ID}#details`,
    );
    expect(replaceSpy).toHaveBeenCalledOnce();
    replaceCanonicalEventPath(
      "/events/shabbat",
      OCCURRENCE_ONE_ID,
      "user_select",
      [OCCURRENCE_ONE_ID],
    );
    expect(replaceSpy).toHaveBeenCalledOnce();
  });

  it("removes a missing or foreign occurrence during canonicalization", () => {
    window.history.replaceState(null, "", `/events/old?occurrence=${OCCURRENCE_TWO_ID}`);
    replaceCanonicalEventPath(
      "/events/shabbat",
      OCCURRENCE_TWO_ID,
      "user_select",
      [OCCURRENCE_ONE_ID],
    );
    expect(window.location.pathname).toBe("/events/shabbat");
    expect(window.location.search).toBe("");
  });

  it.each(["nearest", "none"] as const)(
    "removes an occurrence query for %s canonicalization and keeps the fragment",
    (mode) => {
      window.history.replaceState(
        null,
        "",
        `/events/old?occurrence=${OCCURRENCE_ONE_ID}#details`,
      );
      replaceCanonicalEventPath(
        "/events/shabbat",
        OCCURRENCE_ONE_ID,
        mode,
        [OCCURRENCE_ONE_ID],
      );
      expect(window.location.pathname).toBe("/events/shabbat");
      expect(window.location.search).toBe("");
      expect(window.location.hash).toBe("#details");
    },
  );
});
