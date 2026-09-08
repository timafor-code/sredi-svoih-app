import {
  CandleLightingEvent,
  flags,
  HDate,
  HavdalahEvent,
  HebrewCalendar,
} from '@hebcal/core';

import { getWeeklyParsha } from './hebcal';
import { getDailyZmanim, getHebcalLocation, HEBCAL_HAVDALAH_MINUTES } from './zmanim';

export const MOSCOW_TIME_ZONE = 'Europe/Moscow';

export type JewishProgrammeMarkerKey =
  | 'candle_lighting_moscow'
  | 'sunset_moscow'
  | 'tzeit_moscow'
  | 'havdalah_moscow';

export type JewishProgrammeCalendarMarker = Readonly<{
  date: string;
  systemKey: JewishProgrammeMarkerKey;
  time: string;
  /** Present only for a deterministic Hebrew-calendar transition context. */
  title?: string;
}>;

export type MoscowJewishProgrammeCalendar = Readonly<{
  markers: JewishProgrammeCalendarMarker[];
  parshaRu: string | null;
}>;

/**
 * Parses a Programme Gregorian date as a civil calendar day, rather than as a
 * timestamp. Numeric Date construction keeps the input date stable in every
 * browser runtime zone before Hebcal converts it to a Hebrew date.
 */
export function parseProgrammeGregorianDate(value: string | null | undefined): HDate | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value ?? '');
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const civilDate = new Date(year, month - 1, day);

  if (
    !Number.isSafeInteger(year)
    || civilDate.getFullYear() !== year
    || civilDate.getMonth() !== month - 1
    || civilDate.getDate() !== day
  ) {
    return null;
  }

  return new HDate(civilDate);
}

export function getMoscowJewishProgrammeCalendar(input: {
  eventKind: 'shabbat' | 'holiday';
  referenceDate: string | null | undefined;
}): MoscowJewishProgrammeCalendar {
  const reference = parseProgrammeGregorianDate(input.referenceDate);
  if (!reference) return { markers: [], parshaRu: null };

  try {
    if (input.eventKind === 'shabbat') {
      const shabbat = addDays(reference, (6 - reference.getDay() + 7) % 7);
      const friday = addDays(shabbat, -1);
      const boundaryEvents = getBoundaryEvents(friday, shabbat);
      const markerDates = new Set([toGregorianDateKey(friday), toGregorianDateKey(shabbat)]);
      const markerMap = new Map<string, JewishProgrammeCalendarMarker>();

      for (const date of markerDates) {
        addDailyMarker(markerMap, date, 'sunset_moscow');
      }
      addDailyMarker(markerMap, toGregorianDateKey(shabbat), 'tzeit_moscow');
      addCanonicalShabbatEndMarker(markerMap, toGregorianDateKey(shabbat));
      addBoundaryMarkers(markerMap, boundaryEvents, true);

      return {
        markers: sortMarkers(markerMap.values()),
        parshaRu: getWeeklyParsha(shabbat)?.ru ?? null,
      };
    }

    const holiday = findHolidayRange(reference);
    if (!holiday) return { markers: [], parshaRu: null };

    const markerMap = new Map<string, JewishProgrammeCalendarMarker>();
    addBoundaryMarkers(markerMap, getBoundaryEvents(addDays(holiday.start, -1), holiday.end), false);

    return { markers: sortMarkers(markerMap.values()), parshaRu: null };
  } catch {
    // Programme automation must fail closed: its caller retains manual rows.
    return { markers: [], parshaRu: null };
  }
}

function findHolidayRange(reference: HDate): { start: HDate; end: HDate } | null {
  let start: HDate | null = null;

  // An event can be authored for Erev Yom Tov or for its first daytime date.
  for (let offset = 0; offset <= 1; offset += 1) {
    const candidate = addDays(reference, offset);
    if (isChagDay(candidate)) {
      start = candidate;
      break;
    }
  }
  if (!start) return null;

  while (isChagDay(addDays(start, -1))) {
    start = addDays(start, -1);
  }

  let end = start;
  while (isChagDay(addDays(end, 1))) {
    end = addDays(end, 1);
  }
  return { start, end };
}

function isChagDay(date: HDate): boolean {
  return HebrewCalendar.calendar({ end: date, start: date }).some((event) => (event.getFlags() & flags.CHAG) !== 0);
}

function getBoundaryEvents(start: HDate, end: HDate) {
  return HebrewCalendar.calendar({
    candlelighting: true,
    end,
    havdalahMins: HEBCAL_HAVDALAH_MINUTES,
    location: getHebcalLocation('Москва'),
    start,
  });
}

function addBoundaryMarkers(
  markers: Map<string, JewishProgrammeCalendarMarker>,
  events: ReturnType<typeof getBoundaryEvents>,
  isShabbatProgramme: boolean,
) {
  for (const event of events) {
    if (event instanceof CandleLightingEvent) {
      const date = dateKeyInMoscow(event.eventTime);
      addDailyMarker(markers, date, 'sunset_moscow');
      addMarker(
        markers,
        date,
        'candle_lighting_moscow',
        event.eventTimeStr,
        isSaturdayYomTovCandleLighting(event, date) ? 'Зажигание свечей на праздник · Москва' : undefined,
      );
    }
    if (event instanceof HavdalahEvent) {
      const date = dateKeyInMoscow(event.eventTime);
      addDailyMarker(markers, date, 'sunset_moscow');
      addDailyMarker(markers, date, 'tzeit_moscow');
      if (isShabbatProgramme) addCanonicalShabbatEndMarker(markers, date);
      else addMarker(markers, date, 'havdalah_moscow', event.eventTimeStr);
    }
  }
}

function isSaturdayYomTovCandleLighting(event: CandleLightingEvent, date: string): boolean {
  return getWeekday(date) === 6
    && ((event.linkedEvent?.getFlags() ?? 0) & flags.LIGHT_CANDLES_TZEIS) !== 0;
}

function addDailyMarker(
  markers: Map<string, JewishProgrammeCalendarMarker>,
  date: string,
  systemKey: Extract<JewishProgrammeMarkerKey, 'sunset_moscow' | 'tzeit_moscow'>,
) {
  const hdate = parseProgrammeGregorianDate(date);
  if (!hdate) return;
  const daily = getDailyZmanim({ city: 'Москва', date: hdate });
  const time = systemKey === 'sunset_moscow'
    ? daily.times.sunset.time
    : daily.times.tzeitHakochavimAngle.time;
  addMarker(markers, date, systemKey, time);
}

function addCanonicalShabbatEndMarker(
  markers: Map<string, JewishProgrammeCalendarMarker>,
  date: string,
) {
  const hdate = parseProgrammeGregorianDate(date);
  if (!hdate) return;
  const daily = getDailyZmanim({ city: 'Москва', date: hdate });
  addMarker(markers, date, 'havdalah_moscow', daily.times.tzeitHakochavimAngle.time);
}

function addMarker(
  markers: Map<string, JewishProgrammeCalendarMarker>,
  date: string,
  systemKey: JewishProgrammeMarkerKey,
  time: string,
  title?: string,
) {
  if (!isProgrammeTime(time)) return;
  markers.set(`${date}:${systemKey}`, title
    ? { date, systemKey, time, title }
    : { date, systemKey, time });
}

function addDays(date: HDate, offset: number): HDate {
  return new HDate(date.abs() + offset);
}

function toGregorianDateKey(date: HDate): string {
  const civilDate = date.greg();
  return `${civilDate.getFullYear()}-${String(civilDate.getMonth() + 1).padStart(2, '0')}-${String(civilDate.getDate()).padStart(2, '0')}`;
}

function dateKeyInMoscow(date: Date): string {
  return dateKeyInTimeZone(date, MOSCOW_TIME_ZONE) ?? '';
}

/**
 * Resolves an ISO instant to its Moscow civil day. Programme projection uses
 * this for concrete occurrences so it never depends on the browser timezone.
 */
export function getMoscowCivilDate(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const instant = new Date(value);
  if (Number.isNaN(instant.getTime())) return null;
  return dateKeyInTimeZone(instant, MOSCOW_TIME_ZONE);
}

function dateKeyInTimeZone(date: Date, timeZone: string): string | null {
  const parts = new Intl.DateTimeFormat('en-CA', {
    day: '2-digit',
    month: '2-digit',
    timeZone,
    year: 'numeric',
  }).formatToParts(date);
  const values = new Map(parts.map((part) => [part.type, part.value]));
  const year = values.get('year');
  const month = values.get('month');
  const day = values.get('day');
  return year && month && day ? `${year}-${month}-${day}` : null;
}

function isProgrammeTime(value: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function getWeekday(date: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return null;
  const civilDate = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return civilDate.getUTCFullYear() === Number(match[1])
    && civilDate.getUTCMonth() === Number(match[2]) - 1
    && civilDate.getUTCDate() === Number(match[3]) ? civilDate.getUTCDay() : null;
}

export function getJewishProgrammeMarkerTitle(marker: Pick<JewishProgrammeCalendarMarker, 'systemKey' | 'title'>): string {
  if (marker.title) return marker.title;
  return {
    candle_lighting_moscow: 'Зажигание свечей · Москва',
    sunset_moscow: 'Закат',
    tzeit_moscow: 'Выход звезд',
    havdalah_moscow: 'Исход Шабата',
  }[marker.systemKey];
}

function sortMarkers(markers: Iterable<JewishProgrammeCalendarMarker>): JewishProgrammeCalendarMarker[] {
  const keyOrder: Record<JewishProgrammeMarkerKey, number> = {
    candle_lighting_moscow: 0,
    sunset_moscow: 1,
    tzeit_moscow: 2,
    havdalah_moscow: 3,
  };
  return [...markers].sort((left, right) => (
    left.date.localeCompare(right.date)
    || left.time.localeCompare(right.time)
    || keyOrder[left.systemKey] - keyOrder[right.systemKey]
  ));
}
