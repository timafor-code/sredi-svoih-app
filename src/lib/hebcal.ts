import { HDate, HebrewCalendar, OmerEvent, Zmanim, flags, getSedra } from '@hebcal/core';
import type { Event, Location } from '@hebcal/core';

import { addDays, daysUntil } from './dates';
import {
  formatOmerCountingRu,
  holidayNameRu,
  monthNameRu,
  parshaNameRu,
  sefirahMeaningRu,
  sefirahRu,
} from './hebcalRu';

export type HebcalLang = 'he' | 'ru' | 'en';

export function getHebrewDate(
  date: Date | HDate = new Date(),
  location?: Location,
  useElevation = false,
): HDate {
  if (date instanceof HDate) return date;
  return location ? Zmanim.makeSunsetAwareHDate(location, date, useElevation) : new HDate(date);
}

/**
 * Render the Hebrew date for a given Gregorian (or Hebrew) date.
 *
 *  - `lang='he'` → gematriya, e.g. `כ״ג בְּנִיסָן תשפ״ה`
 *  - `lang='ru'` → Russian transliteration, e.g. `23 Нисана 5785`
 *  - `lang='en'` → English transliteration, e.g. `23rd of Nisan, 5785`
 *
 * Default is `'ru'` since the rest of the UI is Russian. Pass an explicit
 * lang if you want one of the others.
 */
export function getHebrewDateLabel(
  date: Date | HDate = new Date(),
  lang: HebcalLang = 'ru',
  location?: Location,
  useElevation = false,
): string {
  const hd = getHebrewDate(date, location, useElevation);
  if (lang === 'he') return hd.renderGematriya();
  if (lang === 'en') return hd.render('en');
  return `${hd.getDate()} ${monthNameRu(hd.getMonthName())} ${hd.getFullYear()}`;
}

export interface WeeklyParsha {
  /** Hebrew with nikud, e.g. `פָּרָשַׁת אַחֲרֵי מוֹת` */
  he: string;
  /** Sephardic transliteration, e.g. `Achrei Mot` (or `Achrei Mot-Kedoshim`) */
  en: string;
  /** Russian transliteration, e.g. `Ахарей Мот` */
  ru: string;
  /** Date of the Shabbat this parsha is read */
  date: Date;
  /** True for doubled parshiot (e.g. Matot-Masei) */
  doubled: boolean;
}

/**
 * Returns Parashat HaShavua for the Shabbat on or after `date`.
 *
 * Returns `null` when the upcoming Shabbat coincides with a Yom Tov that
 * has its own special reading (the caller should display the holiday name
 * instead).
 *
 * @param il `true` for the Israeli reading schedule. Diaspora by default.
 */
export function getWeeklyParsha(
  date: Date | HDate = new Date(),
  il = false,
): WeeklyParsha | null {
  const hd = date instanceof HDate ? date : new HDate(date);
  const sedra = getSedra(hd.getFullYear(), il);
  const lookup = sedra.lookup(hd);
  if (lookup.chag || lookup.parsha.length === 0) return null;
  const en = lookup.parsha.join('-');
  return {
    he: sedra.getString(hd, 'he'),
    en,
    ru: lookup.parsha.map(parshaNameRu).join('-'),
    date: lookup.hdate.greg(),
    doubled: lookup.parsha.length > 1,
  };
}

export interface OmerInfo {
  /** Day of the Omer, 1..49 */
  day: number;
  /** Hebrew day label, e.g. `כ״ו בָּעוֹמֶר` */
  dayHe: string;
  /** Sefirah in Hebrew with nikud, e.g. `חֶֽסֶד שֶׁבִּגְבוּרָה` */
  sefirahHe: string;
  /** Sefirah transliterated, e.g. `Chesed shebiGevurah` */
  sefirahEn: string;
  /** Sefirah in Russian, e.g. `Хесед ше-бе-Гвура` */
  sefirahRu: string;
  /** Short Russian meaning, e.g. `Любовь внутри строгости` */
  meaningRu: string;
  /** Full counting sentence in Hebrew */
  countingHe: string;
  /** Full counting sentence in Russian */
  countingRu: string;
}

/**
 * Returns Omer info if `date` is between 16 Nisan and 5 Sivan inclusive,
 * otherwise `null` (Omer is not counted on those days).
 */
export function getOmerInfo(
  date: Date | HDate = new Date(),
  location?: Location,
  useElevation = false,
): OmerInfo | null {
  const hd = getHebrewDate(date, location, useElevation);
  const events = HebrewCalendar.calendar({
    start: hd,
    end: hd,
    omer: true,
    noHolidays: true,
  });
  const omer = events.find((e): e is OmerEvent => e instanceof OmerEvent);
  if (!omer) return null;
  return {
    day: omer.omer,
    dayHe: omer.render('he'),
    sefirahHe: omer.sefira('he'),
    sefirahEn: omer.sefira('en'),
    sefirahRu: sefirahRu(omer.omer),
    meaningRu: sefirahMeaningRu(omer.omer),
    countingHe: omer.getTodayIs('he'),
    countingRu: formatOmerCountingRu(omer.omer),
  };
}

export interface UpcomingHoliday {
  date: Date;
  daysUntil: number;
  emoji: string | null;
  hebrewDateRu: string;
  nameEn: string;
  nameHe: string;
  nameRu: string;
}

const UPCOMING_HOLIDAY_MASK =
  flags.CHAG | flags.MINOR_HOLIDAY | flags.MODERN_HOLIDAY | flags.MAJOR_FAST | flags.MINOR_FAST;
const UPCOMING_HOLIDAY_EXCLUDE_MASK = flags.EREV | flags.OMER_COUNT | flags.PARSHA_HASHAVUA | flags.SPECIAL_SHABBAT;

function isDisplayHoliday(event: Event) {
  const mask = event.getFlags();
  return (mask & UPCOMING_HOLIDAY_MASK) !== 0 && (mask & UPCOMING_HOLIDAY_EXCLUDE_MASK) === 0;
}

export function getUpcomingHoliday(
  date: Date | HDate = new Date(),
  il = false,
  maxDays = 370,
): UpcomingHoliday | null {
  const start = date instanceof HDate ? date : new HDate(date);
  const end = new HDate(addDays(start.greg(), maxDays));
  const event = HebrewCalendar.calendar({ start, end, il }).find(isDisplayHoliday);
  if (!event) return null;

  const eventDate = event.getDate();
  const gregDate = eventDate.greg();
  const nameEn = event.basename();

  return {
    date: gregDate,
    daysUntil: daysUntil(gregDate, start.greg()),
    emoji: event.getEmoji(),
    hebrewDateRu: getHebrewDateLabel(eventDate),
    nameEn,
    nameHe: event.render('he'),
    nameRu: holidayNameRu(nameEn),
  };
}

/**
 * Calculates the next Hebrew anniversary (birthday) of a person born on
 * `birthGregDate`, on or after `fromDate`. Returns the Gregorian date of
 * that anniversary, or `null` if it cannot be computed (e.g. `fromDate`
 * is earlier than the original birth).
 *
 * Uses the algorithm from "Calendrical Calculations" (Reingold &
 * Dershowitz) — handles Adar I/II in leap years and the 30 Cheshvan /
 * 30 Kislev / 30 Adar I edge cases correctly.
 */
export function getNextHebrewBirthday(
  birthGregDate: Date,
  fromDate: Date = new Date(),
): Date | null {
  const fromHd = new HDate(fromDate);
  const todayMidnight = new Date(
    fromDate.getFullYear(),
    fromDate.getMonth(),
    fromDate.getDate(),
  );
  // Try this Hebrew year, then the next — the anniversary in the current
  // year may already have passed.
  for (let y = fromHd.getFullYear(); y <= fromHd.getFullYear() + 1; y++) {
    const anniv = HebrewCalendar.getBirthdayOrAnniversary(y, birthGregDate);
    if (!anniv) continue;
    const greg = anniv.greg();
    if (greg.getTime() >= todayMidnight.getTime()) return greg;
  }
  return null;
}
