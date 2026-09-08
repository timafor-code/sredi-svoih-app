import {
  getJewishProgrammeMarkerTitle,
  getMoscowCivilDate,
  getMoscowJewishProgrammeCalendar,
  type JewishProgrammeCalendarMarker,
  type JewishProgrammeMarkerKey,
} from "../../../src/lib/jewishProgrammeCalendar";
import type {
  WebEventSchedule,
  WebEventScheduleDay,
  WebEventScheduleItem,
  WebRegistrationOccurrence,
} from "./types";

const CALENDAR_SYSTEM_KEYS = new Set<JewishProgrammeMarkerKey>([
  "candle_lighting_moscow",
  "sunset_moscow",
  "tzeit_moscow",
  "havdalah_moscow",
]);
const TORAH_READING_SYSTEM_KEY = "torah_reading_parsha";
const TORAH_READING_TITLE = "Чтение Торы";

export type JewishProgrammeProjectionInput = Readonly<{
  eventKind: string;
  eventStartsAt?: string | null;
  occurrence: Pick<WebRegistrationOccurrence, "starts_at"> | null;
  schedule: WebEventSchedule | null | undefined;
}>;

/**
 * Produces a public-only Jewish Programme view for the effective occurrence
 * or, for fixed holidays, the event's own start.
 * It never mutates the saved event template or an earlier projection.
 */
export function projectJewishProgrammeForOccurrence({
  eventKind,
  eventStartsAt,
  occurrence,
  schedule,
}: JewishProgrammeProjectionInput): WebEventSchedule | null {
  if (!schedule) return null;
  const isShabbat = eventKind === "shabbat";
  const isHoliday = eventKind === "holiday";
  if (!isShabbat && !isHoliday) return schedule;

  const failClosedSchedule = isShabbat ? removeSystemRows(schedule) : removeCalendarRows(schedule);
  const referenceDate = getMoscowCivilDate(isShabbat ? occurrence?.starts_at : occurrence?.starts_at ?? eventStartsAt);
  if (!referenceDate) return failClosedSchedule;

  const calendar = getMoscowJewishProgrammeCalendar({
    eventKind: isShabbat ? "shabbat" : "holiday",
    referenceDate,
  });
  if (calendar.markers.length === 0) return failClosedSchedule;

  const days = removeCalendarRows(schedule).days.map(cloneDay);
  if (isShabbat && !retargetShabbatDays(days, calendar.markers)) return failClosedSchedule;

  for (const marker of calendar.markers) {
    const day = days.find((candidate) => candidate.date === marker.date);
    if (day) {
      insertCalendarItem(day.items, {
        option_id: null,
        system_key: marker.systemKey,
        time: marker.time,
        title: getJewishProgrammeMarkerTitle(marker),
      });
    } else {
      days.push({
        date: marker.date,
        label: null,
        note: null,
        items: [{
          option_id: null,
          system_key: marker.systemKey,
          time: marker.time,
          title: getJewishProgrammeMarkerTitle(marker),
        }],
      });
    }
  }

  if (isHoliday) return { version: 1, days };

  const parshaTitle = calendar.parshaRu
    ? `${TORAH_READING_TITLE} — ${calendar.parshaRu}`
    : TORAH_READING_TITLE;
  return {
    version: 1,
    days: days.map((day) => ({
      ...day,
      items: day.items.map((item) => item.system_key === TORAH_READING_SYSTEM_KEY
        ? { ...item, title: parshaTitle }
        : item),
    })),
  };
}

function removeSystemRows(schedule: WebEventSchedule): WebEventSchedule {
  return {
    version: 1,
    days: schedule.days.map((day) => ({
      ...day,
      items: day.items
        .filter((item) => !isSystemItem(item))
        .map((item) => ({ ...item })),
    })),
  };
}

function removeCalendarRows(schedule: WebEventSchedule): WebEventSchedule {
  return {
    version: 1,
    days: schedule.days.map((day) => ({
      ...day,
      items: day.items
        .filter((item) => !(typeof item.system_key === "string"
          && CALENDAR_SYSTEM_KEYS.has(item.system_key as JewishProgrammeMarkerKey)))
        .map((item) => ({ ...item })),
    })),
  };
}

function isSystemItem(item: WebEventScheduleItem): boolean {
  return item.system_key === TORAH_READING_SYSTEM_KEY
    || (typeof item.system_key === "string" && CALENDAR_SYSTEM_KEYS.has(item.system_key as JewishProgrammeMarkerKey));
}

function cloneDay(day: WebEventScheduleDay): WebEventScheduleDay {
  return { ...day, items: day.items.map((item) => ({ ...item })) };
}

function retargetShabbatDays(
  days: WebEventScheduleDay[],
  markers: ReadonlyArray<JewishProgrammeCalendarMarker>,
): boolean {
  const targetDates = [...new Set(markers.map((marker) => marker.date))];
  if (targetDates.length !== 2 || targetDates.some((date) => getWeekday(date) === null)) return false;

  const resolved = new Map<string, number>();
  const usedIndexes = new Set<number>();
  for (const targetDate of targetDates) {
    const exactMatches = days.map((day, index) => ({ day, index })).filter(({ day }) => day.date === targetDate);
    if (exactMatches.length > 1) return false;
    if (exactMatches.length === 1) {
      resolved.set(targetDate, exactMatches[0].index);
      usedIndexes.add(exactMatches[0].index);
    }
  }
  for (const targetDate of targetDates) {
    if (resolved.has(targetDate)) continue;
    const weekday = getWeekday(targetDate);
    const matches = days.map((day, index) => ({ day, index }))
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
    if ((fridayDate !== fridayTarget || saturdayDate !== saturdayTarget)
      && (saturdayIndex !== fridayIndex + 1 || !areConsecutiveDates(fridayDate, saturdayDate))) return false;
  }
  for (const [targetDate, index] of resolved) days[index] = { ...days[index], date: targetDate };
  return true;
}

function insertCalendarItem(items: WebEventScheduleItem[], item: WebEventScheduleItem): void {
  const insertionIndex = items.findIndex((existing) => existing.time > item.time);
  if (insertionIndex === -1) items.push(item);
  else items.splice(insertionIndex, 0, item);
}

function getWeekday(date: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return null;
  const civilDate = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return civilDate.getUTCFullYear() === Number(match[1])
    && civilDate.getUTCMonth() === Number(match[2]) - 1
    && civilDate.getUTCDate() === Number(match[3]) ? civilDate.getUTCDay() : null;
}

function areConsecutiveDates(first: string, second: string): boolean {
  const firstWeekday = getWeekday(first);
  if (firstWeekday === null || getWeekday(second) === null) return false;
  const [year, month, day] = first.split("-").map(Number);
  const nextDate = new Date(Date.UTC(year, month - 1, day + 1));
  return `${nextDate.getUTCFullYear()}-${String(nextDate.getUTCMonth() + 1).padStart(2, "0")}-${String(nextDate.getUTCDate()).padStart(2, "0")}` === second;
}
