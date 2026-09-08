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

  return appendCalendarRows(withTorahReading, calendar.markers, eventKind === "shabbat");
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
  isShabbat: boolean,
): AdminEventSchedule | null {
  if (markers.length === 0) return schedule;

  const days = schedule?.days.map((day) => ({
    ...day,
    items: day.items.map((item) => ({ ...item })),
  })) ?? [];
  if (isShabbat && !retargetShabbatDays(days, markers)) {
    // Several existing Friday/Saturday pairs are not enough evidence to move
    // manual content. Leave the draft intact rather than choosing arbitrarily.
    return schedule;
  }

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
    insertCalendarItem(days[dayIndex].items, {
      optionId: null,
      systemKey: marker.systemKey,
      time: marker.time,
      title: SYSTEM_TITLES[marker.systemKey],
    });
  }

  return { version: 1, days };
}

function retargetShabbatDays(
  days: AdminEventSchedule["days"],
  markers: ReadonlyArray<{ date: string; systemKey: JewishProgrammeMarkerKey; time: string }>,
): boolean {
  const targetDates = [...new Set(markers.map((marker) => marker.date))];
  if (targetDates.length !== 2 || targetDates.some((date) => getWeekday(date) === null)) return false;

  const resolved = new Map<string, number>();
  const usedIndexes = new Set<number>();

  for (const targetDate of targetDates) {
    const exactMatches = days
      .map((day, index) => ({ day, index }))
      .filter(({ day }) => day.date === targetDate);
    if (exactMatches.length > 1) return false;
    if (exactMatches.length === 1) {
      resolved.set(targetDate, exactMatches[0].index);
      usedIndexes.add(exactMatches[0].index);
    }
  }

  for (const targetDate of targetDates) {
    if (resolved.has(targetDate)) continue;
    const weekday = getWeekday(targetDate);
    const matches = days
      .map((day, index) => ({ day, index }))
      .filter(({ day, index }) => !usedIndexes.has(index) && getWeekday(day.date) === weekday);
    if (matches.length > 1) return false;
    if (matches.length === 1) {
      resolved.set(targetDate, matches[0].index);
      usedIndexes.add(matches[0].index);
    }
  }

  const fridayTarget = targetDates.find((date) => getWeekday(date) === 5);
  const saturdayTarget = targetDates.find((date) => getWeekday(date) === 6);
  if (!fridayTarget || !saturdayTarget) return false;
  const fridayIndex = resolved.get(fridayTarget);
  const saturdayIndex = resolved.get(saturdayTarget);

  if (fridayIndex !== undefined && saturdayIndex !== undefined) {
    const fridayDate = days[fridayIndex].date;
    const saturdayDate = days[saturdayIndex].date;
    const usesOldLogicalPair = fridayDate !== fridayTarget || saturdayDate !== saturdayTarget;
    if (usesOldLogicalPair && (saturdayIndex !== fridayIndex + 1 || !areConsecutiveDates(fridayDate, saturdayDate))) {
      return false;
    }
  }

  for (const [targetDate, index] of resolved) {
    days[index] = { ...days[index], date: targetDate };
  }
  return true;
}

function insertCalendarItem(
  items: AdminEventScheduleItem[],
  item: AdminEventScheduleItem,
): void {
  const insertionIndex = items.findIndex((existing) => isProgrammeTime(existing.time) && existing.time > item.time);
  if (insertionIndex === -1) {
    items.push(item);
  } else {
    items.splice(insertionIndex, 0, item);
  }
}

function getWeekday(date: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return null;
  const civilDate = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (
    civilDate.getUTCFullYear() !== Number(match[1])
    || civilDate.getUTCMonth() !== Number(match[2]) - 1
    || civilDate.getUTCDate() !== Number(match[3])
  ) {
    return null;
  }
  return civilDate.getUTCDay();
}

function areConsecutiveDates(first: string, second: string): boolean {
  const firstWeekday = getWeekday(first);
  if (firstWeekday === null || getWeekday(second) === null) return false;
  const [firstYear, firstMonth, firstDay] = first.split("-").map(Number);
  const nextDate = new Date(Date.UTC(firstYear, firstMonth - 1, firstDay + 1));
  return `${nextDate.getUTCFullYear()}-${String(nextDate.getUTCMonth() + 1).padStart(2, "0")}-${String(nextDate.getUTCDate()).padStart(2, "0")}` === second;
}

function isProgrammeTime(value: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function isCalendarSystemItem(item: AdminEventScheduleItem): boolean {
  return typeof item.systemKey === "string" && CALENDAR_SYSTEM_KEYS.has(item.systemKey as JewishProgrammeMarkerKey);
}

function isCanonicalTorahReading(title: string): boolean {
  return title.trim().replace(/\s+/g, " ").toLocaleLowerCase("ru-RU")
    === TORAH_READING_TITLE.toLocaleLowerCase("ru-RU");
}
