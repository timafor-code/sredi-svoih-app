import { describe, expect, it } from "vitest";

import { getConsistentEventKind } from "../eventKindConsistency";

describe("getConsistentEventKind", () => {
  it.each([
    ["community", "single", "single"],
    ["holiday", "single", "holiday"],
    ["shabbat", "single", "shabbat"],
    ["community", "holiday", "single"],
    ["lecture", "shabbat", "single"],
    ["community", "course", "course"],
    ["children", "sunday_school", "sunday_school"],
  ])("maps %s with %s to %s", (category, eventKind, expected) => {
    expect(getConsistentEventKind(category, eventKind)).toBe(expected);
  });

  it("provides the EventForm category-change state without clobbering non-Jewish kinds", () => {
    const newEvent = { category: "community", eventKind: "single" };
    const holidayEvent = {
      ...newEvent,
      category: "holiday",
      eventKind: getConsistentEventKind("holiday", newEvent.eventKind),
    };
    const ordinaryEvent = {
      ...holidayEvent,
      category: "community",
      eventKind: getConsistentEventKind("community", holidayEvent.eventKind),
    };
    const courseEvent = {
      category: "community",
      eventKind: getConsistentEventKind("community", "course"),
    };

    expect(newEvent).toEqual({ category: "community", eventKind: "single" });
    expect(holidayEvent).toEqual({ category: "holiday", eventKind: "holiday" });
    expect(ordinaryEvent).toEqual({ category: "community", eventKind: "single" });
    expect(courseEvent).toEqual({ category: "community", eventKind: "course" });
  });
});
