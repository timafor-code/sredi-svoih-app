import { describe, expect, it } from "vitest";

import { projectJewishProgrammeForOccurrence } from "./jewishProgrammeProjection";
import type { WebEventSchedule, WebRegistrationOccurrence } from "./types";

const OPTION_ID = "44444444-4444-4444-8444-444444444444";

function occurrence(startsAt: string): Pick<WebRegistrationOccurrence, "starts_at"> {
  return { starts_at: startsAt };
}

function scheduleFixture(): WebEventSchedule {
  return {
    version: 1,
    days: [
      {
        date: "2026-07-10",
        label: "Пятница",
        note: "Ручная заметка пятницы",
        items: [
          { time: "18:30", title: "Закат", option_id: null },
          { time: "19:00", title: "Минха", option_id: OPTION_ID },
          { time: "00:01", title: "Старое зажигание", option_id: null, system_key: "candle_lighting_moscow" },
          { time: "00:02", title: "Старый закат", option_id: null, system_key: "sunset_moscow" },
        ],
      },
      {
        date: "2026-07-11",
        label: "Шабат",
        note: "Ручная заметка субботы",
        items: [
          { time: "11:30", title: "Старое чтение", option_id: OPTION_ID, system_key: "torah_reading_parsha" },
          { time: "12:00", title: "Чтение Торы", option_id: null },
          { time: "13:00", title: "Кидуш", option_id: null },
          { time: "00:03", title: "Старый закат", option_id: null, system_key: "sunset_moscow" },
          { time: "00:04", title: "Старый исход", option_id: null, system_key: "havdalah_moscow" },
          { time: "00:05", title: "Старые звезды", option_id: null, system_key: "tzeit_moscow" },
        ],
      },
    ],
  };
}

function holidayScheduleFixture(): WebEventSchedule {
  return {
    version: 1,
    days: [
      {
        date: "2026-09-11",
        label: "Канун Рош ха-Шана",
        note: "Ручная заметка пятницы",
        items: [
          { time: "18:00", title: "Минха", option_id: OPTION_ID },
          { time: "18:20", title: "Зажигание свечей", option_id: null },
          { time: "00:01", title: "Старые свечи", option_id: null, system_key: "candle_lighting_moscow" },
        ],
      },
      {
        date: "2026-09-12",
        label: "Первый день Рош ха-Шана",
        note: "Ручная заметка субботы",
        items: [
          { time: "10:00", title: "Шахарит", option_id: null },
          { time: "19:00", title: "Выход звезд", option_id: null },
          { time: "00:02", title: "Старый закат", option_id: null, system_key: "sunset_moscow" },
        ],
      },
      {
        date: "2026-09-13",
        label: "Второй день Рош ха-Шана",
        note: "Ручная заметка воскресенья",
        items: [
          { time: "10:00", title: "Шахарит второго дня", option_id: null },
          { time: "00:03", title: "Старый исход", option_id: null, system_key: "havdalah_moscow" },
        ],
      },
    ],
  };
}

function projection(startsAt: string, schedule = scheduleFixture()) {
  return projectJewishProgrammeForOccurrence({
    eventKind: "shabbat",
    occurrence: occurrence(startsAt),
    schedule,
  });
}

function systemRows(schedule: WebEventSchedule | null) {
  return schedule?.days.flatMap((day) => day.items
    .filter((item) => item.system_key)
    .map((item) => ({ date: day.date, time: item.time, title: item.title, system_key: item.system_key }))) ?? [];
}

describe("projectJewishProgrammeForOccurrence", () => {
  it("projects an immutable normal Shabbat template onto the concrete Moscow occurrence", () => {
    const template = scheduleFixture();
    const result = projection("2026-07-17T18:00:00Z", template);

    expect(result?.days.map((day) => day.date)).toEqual(["2026-07-17", "2026-07-18"]);
    expect(result?.days).toHaveLength(2);
    expect(result?.days[0]).toMatchObject({ label: "Пятница", note: "Ручная заметка пятницы" });
    expect(result?.days[1]).toMatchObject({ label: "Шабат", note: "Ручная заметка субботы" });
    expect(result?.days[0].items).toContainEqual({ time: "18:30", title: "Закат", option_id: null });
    expect(result?.days[0].items).toContainEqual({ time: "19:00", title: "Минха", option_id: OPTION_ID });
    expect(result?.days[1].items).toContainEqual({ time: "12:00", title: "Чтение Торы", option_id: null });
    expect(result?.days[1].items).toContainEqual({
      time: "11:30", title: "Чтение Торы — Дварим", option_id: OPTION_ID, system_key: "torah_reading_parsha",
    });
    expect(systemRows(result).filter((item) => item.system_key !== "torah_reading_parsha")
      .map(({ date, time, system_key }) => ({ date, time, system_key }))).toEqual([
      { date: "2026-07-17", time: "20:43", system_key: "candle_lighting_moscow" },
      { date: "2026-07-17", time: "21:02", system_key: "sunset_moscow" },
      { date: "2026-07-18", time: "21:00", system_key: "sunset_moscow" },
      { date: "2026-07-18", time: "22:25", system_key: "tzeit_moscow" },
      { date: "2026-07-18", time: "22:25", system_key: "havdalah_moscow" },
    ]);
    expect(template).toEqual(scheduleFixture());
  });

  it("keeps adjacent occurrence projections independent and recalculates their dates, times, and parsha", () => {
    const template = scheduleFixture();
    const first = projection("2026-07-10T18:00:00+03:00", template);
    const second = projection("2026-07-17T18:00:00+03:00", template);

    expect(first?.days.map((day) => day.date)).toEqual(["2026-07-10", "2026-07-11"]);
    expect(second?.days.map((day) => day.date)).toEqual(["2026-07-17", "2026-07-18"]);
    expect(systemRows(first)).toContainEqual(expect.objectContaining({ title: "Чтение Торы — Матот-Масей" }));
    expect(systemRows(second)).toContainEqual(expect.objectContaining({ title: "Чтение Торы — Дварим" }));
    expect(systemRows(first)).not.toEqual(systemRows(second));
    expect(first?.days.map((day) => day.date)).toEqual(["2026-07-10", "2026-07-11"]);
    expect(template).toEqual(scheduleFixture());
  });

  it("orders generated calendar rows chronologically without changing manual item order", () => {
    const result = projection("2026-07-17T18:00:00+03:00");
    const saturday = result?.days[1];
    expect(saturday?.items.filter((item) => item.system_key && item.system_key !== "torah_reading_parsha")
      .map((item) => [item.system_key, item.time])).toEqual([
        ["sunset_moscow", "21:00"],
        ["tzeit_moscow", "22:25"],
        ["havdalah_moscow", "22:25"],
      ]);
    expect(saturday?.items.filter((item) => !item.system_key).map((item) => item.title))
      .toEqual(["Чтение Торы", "Кидуш"]);
  });

  it("uses the base Torah title for a special-reading Shabbat", () => {
    const result = projection("2026-09-12T12:00:00+03:00");
    expect(systemRows(result)).toContainEqual(expect.objectContaining({
      system_key: "torah_reading_parsha", title: "Чтение Торы",
    }));
  });

  it("projects the Saturday Yom Tov candle boundary and canonical Shabbat end without touching manual Авдала", () => {
    const template = scheduleFixture();
    template.days[1].items.push({ time: "20:15", title: "Авдала", option_id: null });
    const result = projection("2026-09-12T12:00:00+03:00", template);
    const saturdayCalendarRows = systemRows(result)
      .filter((item) => item.date === "2026-09-12" && item.system_key !== "torah_reading_parsha");

    expect(saturdayCalendarRows).toEqual([
      { date: "2026-09-12", time: "18:55", title: "Закат", system_key: "sunset_moscow" },
      {
        date: "2026-09-12",
        time: "19:37",
        title: "Зажигание свечей на праздник · Москва",
        system_key: "candle_lighting_moscow",
      },
      { date: "2026-09-12", time: "19:52", title: "Выход звезд", system_key: "tzeit_moscow" },
      { date: "2026-09-12", time: "19:52", title: "Исход Шабата", system_key: "havdalah_moscow" },
    ]);
    expect(result?.days.find((day) => day.date === "2026-09-12")?.items)
      .toContainEqual({ time: "20:15", title: "Авдала", option_id: null });
    expect(saturdayCalendarRows.filter((item) => item.system_key === "havdalah_moscow")).toHaveLength(1);
    expect(template.days[1].items).toContainEqual({ time: "20:15", title: "Авдала", option_id: null });
  });

  it("projects a fixed Rosh Hashana Programme from the event start without retargeting manual days", () => {
    const template = holidayScheduleFixture();
    const input = {
      eventKind: "holiday",
      eventStartsAt: "2026-09-11T18:00:00+03:00",
      occurrence: null,
      schedule: template,
    } as const;
    const first = projectJewishProgrammeForOccurrence(input);
    const second = projectJewishProgrammeForOccurrence({ ...input, schedule: first });

    expect(first?.days.map((day) => day.date)).toEqual(["2026-09-11", "2026-09-12", "2026-09-13"]);
    expect(first?.days.map(({ label, note }) => ({ label, note }))).toEqual(template.days.map(({ label, note }) => ({ label, note })));
    expect(systemRows(first).filter((item) => item.system_key !== "torah_reading_parsha")).toEqual([
      { date: "2026-09-11", time: "18:39", title: "Зажигание свечей · Москва", system_key: "candle_lighting_moscow" },
      { date: "2026-09-11", time: "18:58", title: "Закат", system_key: "sunset_moscow" },
      { date: "2026-09-12", time: "18:55", title: "Закат", system_key: "sunset_moscow" },
      { date: "2026-09-12", time: "19:37", title: "Зажигание свечей на праздник · Москва", system_key: "candle_lighting_moscow" },
      { date: "2026-09-13", time: "18:53", title: "Закат", system_key: "sunset_moscow" },
      { date: "2026-09-13", time: "19:49", title: "Выход звезд", system_key: "tzeit_moscow" },
      { date: "2026-09-13", time: "19:49", title: "Исход праздника", system_key: "havdalah_moscow" },
    ]);
    expect(first?.days[0].items).toContainEqual({ time: "18:00", title: "Минха", option_id: OPTION_ID });
    expect(first?.days[1].items).toContainEqual({ time: "19:00", title: "Выход звезд", option_id: null });
    expect(template).toEqual(holidayScheduleFixture());
    expect(second).toEqual(first);
  });

  it("prefers the effective Holiday occurrence over the event start", () => {
    const result = projectJewishProgrammeForOccurrence({
      eventKind: "holiday",
      eventStartsAt: "2026-08-01T18:00:00+03:00",
      occurrence: occurrence("2026-09-11T18:00:00+03:00"),
      schedule: holidayScheduleFixture(),
    });

    expect(systemRows(result)).toContainEqual(expect.objectContaining({
      date: "2026-09-12", system_key: "candle_lighting_moscow", title: "Зажигание свечей на праздник · Москва",
    }));
  });

  it("leaves non-Shabbat schedules unchanged and fails closed without an occurrence", () => {
    const template = scheduleFixture();
    expect(projectJewishProgrammeForOccurrence({ eventKind: "course", occurrence: null, schedule: template })).toBe(template);
    const unavailable = projectJewishProgrammeForOccurrence({ eventKind: "shabbat", occurrence: null, schedule: template });
    expect(systemRows(unavailable)).toEqual([]);
    expect(unavailable?.days[0].items).toContainEqual({ time: "18:30", title: "Закат", option_id: null });
    expect(unavailable?.days[1].items).toContainEqual({ time: "12:00", title: "Чтение Торы", option_id: null });
  });
});
