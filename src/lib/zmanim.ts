import { CandleLightingEvent, HavdalahEvent, HebrewCalendar, Location, Zmanim } from '@hebcal/core';

import { addDays, daysUntil, formatDurationRu, progressBetween } from './dates';
import { getHebrewDateLabel } from './hebcal';

export interface ZmanimRequest {
  city?: string;
  date?: Date;
  source?: 'manual' | 'gps';
  useElevation?: boolean;
}

export interface ZmanTime {
  at: Date;
  time: string;
}

export interface ZmanimItem extends ZmanTime {
  highlight?: boolean;
  icon: string;
  id: string;
  name: string;
}

export interface DailyZmanim {
  city: string;
  hebcalCity: string;
  items: ZmanimItem[];
  location: Location;
  timeZone: string;
  times: {
    alot: ZmanTime;
    chatzot: ZmanTime;
    misheyakir: ZmanTime;
    minchaGedola: ZmanTime;
    minchaKetana: ZmanTime;
    plagHaMincha: ZmanTime;
    shemaGra: ZmanTime;
    shemaMga: ZmanTime;
    sofZmanTfilla: ZmanTime;
    sunrise: ZmanTime;
    sunset: ZmanTime;
    tzeit: ZmanTime;
    tzeitHakochavimAngle: ZmanTime;
  };
}

export interface CandleLightingInfo {
  date: Date;
  daysUntil: number;
  hebrewDateRu: string;
  time: string;
}

export interface HavdalahInfo {
  date: Date;
  daysUntil: number;
  hebrewDateRu: string;
  time: string;
}

export interface PrayerWindow {
  accent: string;
  active: boolean;
  end: Date;
  hebrew: string;
  icon: string;
  id: 'shacharit' | 'mincha' | 'maariv';
  progress: number;
  start: Date;
  subtitle: string;
  title: string;
}

export const SUPPORTED_ZMANIM_CITIES = [
  'Москва',
  'Иерусалим',
  'Нью-Йорк',
  'Санкт-Петербург',
  'Тель-Авив',
] as const;

export type SupportedZmanimCity = (typeof SUPPORTED_ZMANIM_CITIES)[number];

export const FALLBACK_ZMANIM_CITY: SupportedZmanimCity = 'Москва';

const CITY_TO_HEBCAL: Record<SupportedZmanimCity, string> = {
  'Иерусалим': 'Jerusalem',
  'Москва': 'Moscow',
  'Нью-Йорк': 'New York',
  'Санкт-Петербург': 'Saint Petersburg',
  'Тель-Авив': 'Tel Aviv',
};

const CITY_NORMALIZATION: Record<string, SupportedZmanimCity> = {
  'jerusalem': 'Иерусалим',
  'yerushalayim': 'Иерусалим',
  'ירושלים': 'Иерусалим',
  'иерусалим': 'Иерусалим',
  'moscow': 'Москва',
  'moskva': 'Москва',
  'москва': 'Москва',
  'new york': 'Нью-Йорк',
  'new york city': 'Нью-Йорк',
  'nyc': 'Нью-Йорк',
  'нью йорк': 'Нью-Йорк',
  'нью-йорк': 'Нью-Йорк',
  'saint petersburg': 'Санкт-Петербург',
  'sankt peterburg': 'Санкт-Петербург',
  'sankt-peterburg': 'Санкт-Петербург',
  'st petersburg': 'Санкт-Петербург',
  'st. petersburg': 'Санкт-Петербург',
  'санкт петербург': 'Санкт-Петербург',
  'санкт-петербург': 'Санкт-Петербург',
  'tel aviv': 'Тель-Авив',
  'tel-aviv': 'Тель-Авив',
  'tel aviv yafo': 'Тель-Авив',
  'tel aviv-yafo': 'Тель-Авив',
  'תל אביב': 'Тель-Авив',
  'תל אביב יפו': 'Тель-Авив',
  'תל אביב-יפו': 'Тель-Авив',
  'тель авив': 'Тель-Авив',
  'тель-авив': 'Тель-Авив',
};

const FALLBACK_LOCATION = new Location(55.75222, 37.61556, false, 'Europe/Moscow', 'Moscow', 'RU', undefined, 144);
const ALOT_HASHACHAR_DEGREES = 16.1;
const ALOT_HASHACHAR_MIN_FALLBACK_DEGREES = 6;
const TZEIT_HAKOCHAVIM_ANGLE_DEGREES = 8.5;

function makeCityKey(value: string) {
  return value
    .trim()
    .replace(/[‐‑‒–—]/g, '-')
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase('ru-RU');
}

export function normalizeZmanimCityName(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return trimmed;

  return CITY_NORMALIZATION[makeCityKey(trimmed)] ?? trimmed;
}

export function isSupportedZmanimCity(city: string) {
  return SUPPORTED_ZMANIM_CITIES.includes(normalizeZmanimCityName(city) as SupportedZmanimCity);
}

export function getHebcalCityName(city: string = FALLBACK_ZMANIM_CITY) {
  const normalizedCity = normalizeZmanimCityName(city);
  return CITY_TO_HEBCAL[normalizedCity as SupportedZmanimCity] ?? city;
}

export function getHebcalLocation(city: string = FALLBACK_ZMANIM_CITY) {
  return Location.lookup(getHebcalCityName(city)) ?? FALLBACK_LOCATION;
}

function isValidDate(date: Date | null | undefined): date is Date {
  return date instanceof Date && Number.isFinite(date.getTime());
}

function formatZman(date: Date | null | undefined, location: Location) {
  if (!isValidDate(date)) return '—';
  return Zmanim.formatTime(Zmanim.roundTime(date), location.getTimeFormatter());
}

function makeTime(at: Date | null | undefined, location: Location): ZmanTime {
  return { at: isValidDate(at) ? at : new Date(NaN), time: formatZman(at, location) };
}

function compareZmanItemsByTime(a: ZmanimItem, b: ZmanimItem) {
  const aTime = a.at.getTime();
  const bTime = b.at.getTime();
  const aValid = Number.isFinite(aTime);
  const bValid = Number.isFinite(bTime);
  if (aValid && bValid) return aTime - bTime;
  if (aValid) return -1;
  if (bValid) return 1;
  return 0;
}

function getNearestAvailableMorningAngleTime(zmanim: Zmanim, targetAngle: number) {
  let low = ALOT_HASHACHAR_MIN_FALLBACK_DEGREES;
  let high = targetAngle;
  let best: Date | null = null;

  for (let i = 0; i < 12; i++) {
    const angle = (low + high) / 2;
    const candidate = zmanim.timeAtAngle(angle, true);
    if (isValidDate(candidate)) {
      best = candidate;
      low = angle;
    } else {
      high = angle;
    }
  }

  return best;
}

function getAlotHaShachar(zmanim: Zmanim) {
  const alot = zmanim.alotHaShachar();
  if (isValidDate(alot)) return alot;

  // Around high-latitude white nights 16.1° can miss by a fraction of a degree.
  // Prefer the closest available angular dawn before falling back to fixed 72 minutes.
  return getNearestAvailableMorningAngleTime(zmanim, ALOT_HASHACHAR_DEGREES) ?? zmanim.alotHaShachar72();
}

function getHebcalCompatibleTzeit(zmanim: Zmanim) {
  // Hebcal's public zmanim JSON exposes dusk/tzaisBaalHatanya as the site-compatible daily tzeit value.
  return zmanim.dusk();
}

export function getDailyZmanim(req: ZmanimRequest = {}): DailyZmanim {
  const city = req.city ?? FALLBACK_ZMANIM_CITY;
  const date = req.date ?? new Date();
  const location = getHebcalLocation(city);
  const zmanim = new Zmanim(location, date, req.useElevation ?? false);
  const tzeit = makeTime(getHebcalCompatibleTzeit(zmanim), location);
  const tzeitHakochavimAngle = makeTime(zmanim.tzeit(TZEIT_HAKOCHAVIM_ANGLE_DEGREES), location);

  const times: DailyZmanim['times'] = {
    alot: makeTime(getAlotHaShachar(zmanim), location),
    chatzot: makeTime(zmanim.chatzot(), location),
    misheyakir: makeTime(zmanim.misheyakir(), location),
    minchaGedola: makeTime(zmanim.minchaGedola(), location),
    minchaKetana: makeTime(zmanim.minchaKetana(), location),
    plagHaMincha: makeTime(zmanim.plagHaMincha(), location),
    shemaGra: makeTime(zmanim.sofZmanShma(), location),
    shemaMga: makeTime(zmanim.sofZmanShmaMGA(), location),
    sofZmanTfilla: makeTime(zmanim.sofZmanTfilla(), location),
    sunrise: makeTime(zmanim.sunrise(), location),
    sunset: makeTime(zmanim.sunset(), location),
    tzeit,
    tzeitHakochavimAngle,
  };

  const items: ZmanimItem[] = [
    { ...times.alot, icon: '🌅', id: 'alot', name: 'Алот hаШахар (рассвет)' },
    { ...times.misheyakir, icon: '🌄', id: 'misheyakir', name: 'Мишейакир (время для талита и тфилин)' },
    { ...times.sunrise, icon: '☀️', id: 'sunrise', name: 'Восход солнца' },
    { ...times.shemaMga, icon: '🌤️', id: 'shema-mga', name: 'Шма (Маген Авраам)' },
    { ...times.shemaGra, icon: '🌤️', id: 'shema-gra', name: 'Шма (Гра)' },
    { ...times.sofZmanTfilla, icon: '🙏', id: 'tfilla-gra', name: 'Шахарит до (Гра)' },
    { ...times.chatzot, icon: '⚡', id: 'chatzot', name: 'Хацот (полдень)' },
    { ...times.minchaGedola, icon: '🌞', id: 'mincha-gedola', name: 'Минха Гедола' },
    { ...times.minchaKetana, icon: '🌞', id: 'mincha-ketana', name: 'Минха Ктана' },
    { ...times.plagHaMincha, icon: '🌆', id: 'plag', name: 'Плаг ха-Минха' },
    { ...times.sunset, icon: '🌇', id: 'sunset', name: 'Закат' },
    { ...times.tzeit, icon: '🌃', id: 'tzeit', name: 'Цет hаКохавим (появление звёзд)' },
    { ...times.tzeitHakochavimAngle, icon: '🌌', id: 'tzeit-angle', name: 'Цет hаКохавим (угловой расчёт 8.5°)' },
  ].sort(compareZmanItemsByTime);

  return {
    city,
    hebcalCity: getHebcalCityName(city),
    items,
    location,
    timeZone: location.getTzid(),
    times,
  };
}

export function getUpcomingCandleLighting(date: Date = new Date(), location = getHebcalLocation()): CandleLightingInfo | null {
  const events = HebrewCalendar.calendar({
    candlelighting: true,
    end: addDays(date, 14),
    havdalahMins: 42,
    location,
    start: date,
  });
  const event = events.find(
    (item): item is CandleLightingEvent => item instanceof CandleLightingEvent && item.eventTime.getTime() >= date.getTime() - 60_000,
  );
  if (!event) return null;

  return {
    date: event.eventTime,
    daysUntil: daysUntil(event.eventTime, date),
    hebrewDateRu: getHebrewDateLabel(event.getDate()),
    time: event.eventTimeStr,
  };
}

export function getUpcomingHavdalah(date: Date = new Date(), location = getHebcalLocation()): HavdalahInfo | null {
  const events = HebrewCalendar.calendar({
    candlelighting: true,
    end: addDays(date, 14),
    havdalahMins: 42,
    location,
    start: date,
  });
  const event = events.find(
    (item): item is HavdalahEvent => item instanceof HavdalahEvent && item.eventTime.getTime() >= date.getTime() - 60_000,
  );
  if (!event) return null;

  return {
    date: event.eventTime,
    daysUntil: daysUntil(event.eventTime, date),
    hebrewDateRu: getHebrewDateLabel(event.getDate()),
    time: event.eventTimeStr,
  };
}

function endOfCivilDay(date: Date) {
  const end = new Date(date);
  end.setHours(23, 59, 59, 999);
  return end;
}

function prayerSubtitle(start: ZmanTime, end: ZmanTime, now: Date) {
  if (now.getTime() < start.at.getTime()) {
    return `${start.time} – ${end.time} · через ${formatDurationRu(start.at.getTime() - now.getTime())}`;
  }
  if (now.getTime() <= end.at.getTime()) {
    return `${start.time} – ${end.time} · осталось ${formatDurationRu(end.at.getTime() - now.getTime())}`;
  }
  return `${start.time} – ${end.time}`;
}

export function getPrayerWindows(daily: DailyZmanim, now: Date = new Date()): PrayerWindow[] {
  const nightEnd = makeTime(endOfCivilDay(now), daily.location);
  const windows = [
    {
      accent: '#F6A400',
      end: daily.times.sofZmanTfilla,
      hebrew: 'שחרית',
      icon: '🌅',
      id: 'shacharit' as const,
      start: daily.times.sunrise,
      title: 'Шахарит',
    },
    {
      accent: '#F0642A',
      end: daily.times.sunset,
      hebrew: 'מנחה',
      icon: '☀️',
      id: 'mincha' as const,
      start: daily.times.minchaGedola,
      title: 'Минха',
    },
    {
      accent: '#6B7FD4',
      end: nightEnd,
      hebrew: 'ערבית',
      icon: '🌙',
      id: 'maariv' as const,
      start: daily.times.tzeit,
      title: 'Маарив',
    },
  ];

  return windows.map((window) => {
    const active = now.getTime() >= window.start.at.getTime() && now.getTime() <= window.end.at.getTime();
    return {
      ...window,
      active,
      progress: active ? progressBetween(window.start.at, window.end.at, now) : 0,
      start: window.start.at,
      end: window.end.at,
      subtitle: prayerSubtitle(window.start, window.end, now),
    };
  });
}

export function getZmanimMock(req: ZmanimRequest = {}) {
  const daily = getDailyZmanim(req);
  return {
    alot: daily.times.alot.time,
    shemaGra: daily.times.shemaGra.time,
    sunrise: daily.times.sunrise.time,
    sunset: daily.times.sunset.time,
    tzeit: daily.times.tzeit.time,
    tzeitHakochavimAngle: daily.times.tzeitHakochavimAngle.time,
  };
}
