import { describe, expect, it } from "vitest";

import {
  getMoscowJewishProgrammeCalendar,
  parseProgrammeGregorianDate,
} from "../../../../src/lib/jewishProgrammeCalendar";
import type { AdminEventSchedule } from "../types/events";
import { applyJewishProgrammeAutomation } from "./jewishProgrammeAutomation";

const MANUAL_OPTION_ID = "11111111-1111-4111-8111-111111111111";

function scheduleFixture(): AdminEventSchedule {
  return {
    version: 1,
    days: [
      {
        date: "2026-07-10",
        label: "Пятница",
        note: null,
        items: [
          { time: "18:30", title: "Закат", optionId: null },
          { time: "19:00", title: "Минха", optionId: MANUAL_OPTION_ID },
        ],
      },
      {
        date: "2026-07-11",
        label: "Шабат",
        note: null,
        items: [
          { time: "11:30", title: "Чтение Торы", optionId: MANUAL_OPTION_ID },
          { time: "13:00", title: "Кидуш", optionId: null },
        ],
      },
    ],
  };
}

function generatedItems(schedule: AdminEventSchedule | null) {
  return schedule?.days.flatMap((day) => day.items
    .filter((item) => item.systemKey && item.systemKey !== "torah_reading_parsha")
    .map((item) => ({ date: day.date, ...item }))) ?? [];
}

describe("applyJewishProgrammeAutomation", () => {
  it("adds deterministic Moscow Shabbat rows without touching a manual title collision", () => {
    const result = applyJewishProgrammeAutomation({
      eventKind: "shabbat",
      referenceDate: "2026-07-10",
      schedule: scheduleFixture(),
    });
    const expected = getMoscowJewishProgrammeCalendar({ eventKind: "shabbat", referenceDate: "2026-07-10" });

    expect(expected.markers).toEqual([
      { date: "2026-07-10", systemKey: "candle_lighting_moscow", time: "20:52" },
      { date: "2026-07-10", systemKey: "sunset_moscow", time: "21:10" },
      { date: "2026-07-11", systemKey: "sunset_moscow", time: "21:09" },
      { date: "2026-07-11", systemKey: "tzeit_moscow", time: "22:06" },
      { date: "2026-07-11", systemKey: "havdalah_moscow", time: "21:51" },
    ]);
    expect(generatedItems(result).map(({ date, systemKey, time }) => ({ date, systemKey, time }))).toEqual(expected.markers);
    expect(result?.days[0].items).toContainEqual({ time: "18:30", title: "Закат", optionId: null });
    expect(result?.days[1].items).toContainEqual({
      time: "11:30",
      title: "Чтение Торы — Матот-Масей",
      optionId: MANUAL_OPTION_ID,
      systemKey: "torah_reading_parsha",
    });
  });

  it("is idempotent and recalculates rather than retaining stale system values after a date change", () => {
    const first = applyJewishProgrammeAutomation({
      eventKind: "shabbat",
      referenceDate: "2026-07-10",
      schedule: scheduleFixture(),
    });
    const second = applyJewishProgrammeAutomation({
      eventKind: "shabbat",
      referenceDate: "2026-07-10",
      schedule: first,
    });
    const moved = applyJewishProgrammeAutomation({
      eventKind: "shabbat",
      referenceDate: "2026-07-17",
      schedule: first,
    });

    expect(second).toEqual(first);
    expect(generatedItems(moved)).toEqual(expect.arrayContaining(
      getMoscowJewishProgrammeCalendar({ eventKind: "shabbat", referenceDate: "2026-07-17" }).markers
        .map((marker) => expect.objectContaining(marker)),
    ));
    expect(generatedItems(moved).every((item) => item.date !== "2026-07-10" && item.date !== "2026-07-11")).toBe(true);
    expect(moved?.days[1].items).toContainEqual({
      time: "11:30",
      title: "Чтение Торы — Дварим",
      optionId: MANUAL_OPTION_ID,
      systemKey: "torah_reading_parsha",
    });
  });

  it("fails closed for a Yom Tov Shabbat and retains the system-owned Torah slot without a guessed portion", () => {
    const result = applyJewishProgrammeAutomation({
      eventKind: "shabbat",
      referenceDate: "2026-09-12",
      schedule: scheduleFixture(),
    });

    expect(getMoscowJewishProgrammeCalendar({ eventKind: "shabbat", referenceDate: "2026-09-12" }).parshaRu).toBeNull();
    expect(result?.days[1].items).toContainEqual({
      time: "11:30",
      title: "Чтение Торы",
      optionId: MANUAL_OPTION_ID,
      systemKey: "torah_reading_parsha",
    });
  });

  it("removes generated rows and restores Torah reading to a manual base item when leaving Shabbat", () => {
    const shabbat = applyJewishProgrammeAutomation({
      eventKind: "shabbat",
      referenceDate: "2026-07-10",
      schedule: scheduleFixture(),
    });
    const single = applyJewishProgrammeAutomation({
      eventKind: "single",
      referenceDate: "2026-07-10",
      schedule: shabbat,
    });

    expect(generatedItems(single)).toEqual([]);
    expect(single?.days[1].items).toContainEqual({
      time: "11:30",
      title: "Чтение Торы",
      optionId: MANUAL_OPTION_ID,
      systemKey: null,
    });
    expect(single?.days[0].items).toContainEqual({ time: "18:30", title: "Закат", optionId: null });
  });

  it("uses Hebcal holiday boundaries, including a multi-day Yom Tov, without Shabbat Torah ownership", () => {
    const shabbat = applyJewishProgrammeAutomation({
      eventKind: "shabbat",
      referenceDate: "2026-07-10",
      schedule: scheduleFixture(),
    });
    const holiday = applyJewishProgrammeAutomation({
      eventKind: "holiday",
      referenceDate: "2026-09-11",
      schedule: shabbat,
    });
    const expected = getMoscowJewishProgrammeCalendar({ eventKind: "holiday", referenceDate: "2026-09-11" });

    expect(expected.markers.some((marker) => marker.systemKey === "candle_lighting_moscow")).toBe(true);
    expect(expected.markers.some((marker) => marker.systemKey === "sunset_moscow")).toBe(true);
    expect(expected.markers.some((marker) => marker.systemKey === "havdalah_moscow")).toBe(true);
    expect(generatedItems(holiday).map(({ date, systemKey, time }) => ({ date, systemKey, time }))).toEqual(expected.markers);
    expect(holiday?.days[1].items).toContainEqual({
      time: "11:30",
      title: "Чтение Торы",
      optionId: MANUAL_OPTION_ID,
      systemKey: null,
    });
  });

  it("leaves ordinary Programme data structurally unchanged for non-Jewish kinds", () => {
    const fixture = scheduleFixture();
    expect(applyJewishProgrammeAutomation({
      eventKind: "course",
      referenceDate: "2026-07-10",
      schedule: fixture,
    })).toEqual(fixture);
  });

  it("treats Programme dates as calendar days rather than timezone-sensitive ISO timestamps", () => {
    const parsed = parseProgrammeGregorianDate("2026-09-25");
    expect(parsed?.greg().getFullYear()).toBe(2026);
    expect(parsed?.greg().getMonth()).toBe(8);
    expect(parsed?.greg().getDate()).toBe(25);
    expect(getMoscowJewishProgrammeCalendar({ eventKind: "shabbat", referenceDate: "2026-07-10" }))
      .toEqual(getMoscowJewishProgrammeCalendar({ eventKind: "shabbat", referenceDate: "2026-07-10" }));
  });
});
