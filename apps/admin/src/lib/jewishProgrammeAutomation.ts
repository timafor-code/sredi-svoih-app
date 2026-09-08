import {
  getMoscowJewishProgrammeCalendar,
  type JewishProgrammeMarkerKey,
} from "../../../../src/lib/jewishProgrammeCalendar";
import type {
  AdminEventSchedule,
  AdminEventScheduleItem,
  AdminEventSystemKey,
} from "../types/events";

const CALENDAR_SYSTEM_KEYS = new Set<JewishProgrammeMarkerKey>([
  "candle_lighting_moscow",
  "sunset_moscow",
  "tzeit_moscow",
  "havdalah_moscow",
]);

const TORAH_READING_SYSTEM_KEY: AdminEventSystemKey = "torah_reading_parsha";
const TORAH_READING_TITLE = "Чтение Торы";

const SYSTEM_TITLES: Record<JewishProgrammeMarkerKey, string> = {
  candle_lighting_moscow: "Зажигание свечей · Москва",
  sunset_moscow: "Закат",
  tzeit_moscow: "Выход звезд",
  havdalah_moscow: "Исход Шабата",
};

export type JewishProgrammeAutomationInput = Readonly<{
  eventKind: string;
  referenceDate: string | null | undefined;
  schedule: AdminEventSchedule | null;
}>;

/**
 * Applies only deterministic draft changes. It neither saves nor reads browser
 * state, so editor paths can call it before their existing explicit-save flow.
 */
export function applyJewishProgrammeAutomation({
  eventKind,
  referenceDate,
  schedule,
}: JewishProgrammeAutomationInput): AdminEventSchedule | null {
  const applicableKind = eventKind === "shabbat" || eventKind === "holiday";
  const withoutCalendarRows = removeCalendarRowsAndNormalizeTorah(schedule, eventKind === "shabbat");

  if (!applicableKind) return withoutCalendarRows;

  const calendar = getMoscowJewishProgrammeCalendar({
    eventKind: eventKind === "shabbat" ? "shabbat" : "holiday",
    referenceDate,
  });
  const withTorahReading = eventKind === "shabbat"
    ? enrichTorahReading(withoutCalendarRows, calendar.parshaRu)
    : withoutCalendarRows;

  return appendCalendarRows(withTorahReading, calendar.markers);
}

function removeCalendarRowsAndNormalizeTorah(
  schedule: AdminEventSchedule | null,
  retainTorahSlot: boolean,
): AdminEventSchedule | null {
  if (schedule === null) return null;

  return {
    version: 1,
    days: schedule.days.map((day) => ({
      ...day,
      items: day.items.flatMap((item) => {
        if (isCalendarSystemItem(item)) return [];
        if (item.systemKey === TORAH_READING_SYSTEM_KEY && !retainTorahSlot) {
          return [{ ...item, systemKey: null, title: TORAH_READING_TITLE }];
        }
        return [{ ...item }];
      }),
    })),
  };
}

function enrichTorahReading(
  schedule: AdminEventSchedule | null,
  parshaRu: string | null,
): AdminEventSchedule | null {
  if (schedule === null) return null;
  const title = parshaRu ? `${TORAH_READING_TITLE} — ${parshaRu}` : TORAH_READING_TITLE;

  return {
    version: 1,
    days: schedule.days.map((day) => ({
      ...day,
      items: day.items.map((item) => (
        item.systemKey === TORAH_READING_SYSTEM_KEY || isCanonicalTorahReading(item.title)
          ? { ...item, systemKey: TORAH_READING_SYSTEM_KEY, title }
          : item
      )),
    })),
  };
}

function appendCalendarRows(
  schedule: AdminEventSchedule | null,
  markers: ReadonlyArray<{ date: string; systemKey: JewishProgrammeMarkerKey; time: string }>,
): AdminEventSchedule | null {
  if (markers.length === 0) return schedule;

  const days = schedule?.days.map((day) => ({
    ...day,
    items: day.items.map((item) => ({ ...item })),
  })) ?? [];
  const firstDayIndexByDate = new Map<string, number>();
  days.forEach((day, index) => {
    if (!firstDayIndexByDate.has(day.date)) firstDayIndexByDate.set(day.date, index);
  });

  for (const marker of markers) {
    let dayIndex = firstDayIndexByDate.get(marker.date);
    if (dayIndex === undefined) {
      dayIndex = days.length;
      firstDayIndexByDate.set(marker.date, dayIndex);
      days.push({ date: marker.date, label: null, note: null, items: [] });
    }
    days[dayIndex].items.push({
      optionId: null,
      systemKey: marker.systemKey,
      time: marker.time,
      title: SYSTEM_TITLES[marker.systemKey],
    });
  }

  return { version: 1, days };
}

function isCalendarSystemItem(item: AdminEventScheduleItem): boolean {
  return typeof item.systemKey === "string" && CALENDAR_SYSTEM_KEYS.has(item.systemKey as JewishProgrammeMarkerKey);
}

function isCanonicalTorahReading(title: string): boolean {
  return title.trim().replace(/\s+/g, " ").toLocaleLowerCase("ru-RU")
    === TORAH_READING_TITLE.toLocaleLowerCase("ru-RU");
}
