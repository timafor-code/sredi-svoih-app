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
  'Казань',
  'Уфа',
  'Самара',
  'Екатеринбург',
  'Нижний Новгород',
  'Ростов-на-Дону',
  'Краснодар',
  'Сочи',
  'Новосибирск',
  'Пермь',
  'Воронеж',
  'Волгоград',
  'Минск',
  'Баку',
  'Алматы',
  'Астана',
  'Тбилиси',
  'Ереван',
  'Кишинёв',
  'Берлин',
  'Париж',
  'Лондон',
  'Рим',
  'Вена',
  'Прага',
  'Варшава',
  'Будапешт',
  'Амстердам',
  'Мадрид',
  'Барселона',
  'Майами',
  'Лос-Анджелес',
  'Чикаго',
  'Торонто',
  'Монреаль',
  'Бостон',
  'Филадельфия',
  'Вашингтон',
  'Сан-Франциско',
  'Хайфа',
  'Беэр-Шева',
  'Нетания',
  'Ашдод',
] as const;

export type SupportedZmanimCity = (typeof SUPPORTED_ZMANIM_CITIES)[number];

export const FALLBACK_ZMANIM_CITY: SupportedZmanimCity = 'Москва';

const CITY_TO_HEBCAL: Record<SupportedZmanimCity, string> = {
  'Алматы': 'Almaty',
  'Амстердам': 'Amsterdam',
  'Астана': 'Astana',
  'Ашдод': 'Ashdod',
  'Баку': 'Baku',
  'Барселона': 'Barcelona',
  'Беэр-Шева': 'Beer Sheva',
  'Берлин': 'Berlin',
  'Бостон': 'Boston',
  'Будапешт': 'Budapest',
  'Варшава': 'Warsaw',
  'Вашингтон': 'Washington DC',
  'Вена': 'Vienna',
  'Волгоград': 'Volgograd',
  'Воронеж': 'Voronezh',
  'Екатеринбург': 'Yekaterinburg',
  'Ереван': 'Yerevan',
  'Иерусалим': 'Jerusalem',
  'Казань': 'Kazan',
  'Кишинёв': 'Chisinau',
  'Краснодар': 'Krasnodar',
  'Лондон': 'London',
  'Лос-Анджелес': 'Los Angeles',
  'Мадрид': 'Madrid',
  'Майами': 'Miami',
  'Минск': 'Minsk',
  'Москва': 'Moscow',
  'Монреаль': 'Montreal',
  'Нетания': 'Netanya',
  'Нижний Новгород': 'Nizhny Novgorod',
  'Новосибирск': 'Novosibirsk',
  'Нью-Йорк': 'New York',
  'Париж': 'Paris',
  'Пермь': 'Perm',
  'Прага': 'Prague',
  'Рим': 'Rome',
  'Ростов-на-Дону': 'Rostov-on-Don',
  'Самара': 'Samara',
  'Санкт-Петербург': 'Saint Petersburg',
  'Сан-Франциско': 'San Francisco',
  'Сочи': 'Sochi',
  'Тбилиси': 'Tbilisi',
  'Тель-Авив': 'Tel Aviv',
  'Торонто': 'Toronto',
  'Уфа': 'Ufa',
  'Филадельфия': 'Philadelphia',
  'Хайфа': 'Haifa',
  'Чикаго': 'Chicago',
};

function makeLocation(
  city: SupportedZmanimCity,
  latitude: number,
  longitude: number,
  timeZone: string,
  countryCode: string,
  inIsrael = false,
) {
  return new Location(latitude, longitude, inIsrael, timeZone, CITY_TO_HEBCAL[city], countryCode);
}

const CITY_LOCATION_OVERRIDES: Partial<Record<SupportedZmanimCity, Location>> = {
  'Алматы': makeLocation('Алматы', 43.222, 76.8512, 'Asia/Almaty', 'KZ'),
  'Амстердам': makeLocation('Амстердам', 52.3676, 4.9041, 'Europe/Amsterdam', 'NL'),
  'Астана': makeLocation('Астана', 51.1694, 71.4491, 'Asia/Almaty', 'KZ'),
  'Баку': makeLocation('Баку', 40.4093, 49.8671, 'Asia/Baku', 'AZ'),
  'Барселона': makeLocation('Барселона', 41.3851, 2.1734, 'Europe/Madrid', 'ES'),
  'Варшава': makeLocation('Варшава', 52.2297, 21.0122, 'Europe/Warsaw', 'PL'),
  'Вена': makeLocation('Вена', 48.2082, 16.3738, 'Europe/Vienna', 'AT'),
  'Волгоград': makeLocation('Волгоград', 48.708, 44.5133, 'Europe/Volgograd', 'RU'),
  'Воронеж': makeLocation('Воронеж', 51.6608, 39.2003, 'Europe/Moscow', 'RU'),
  'Екатеринбург': makeLocation('Екатеринбург', 56.8389, 60.6057, 'Asia/Yekaterinburg', 'RU'),
  'Ереван': makeLocation('Ереван', 40.1872, 44.5152, 'Asia/Yerevan', 'AM'),
  'Казань': makeLocation('Казань', 55.7887, 49.1221, 'Europe/Moscow', 'RU'),
  'Кишинёв': makeLocation('Кишинёв', 47.0105, 28.8638, 'Europe/Chisinau', 'MD'),
  'Краснодар': makeLocation('Краснодар', 45.0355, 38.9753, 'Europe/Moscow', 'RU'),
  'Мадрид': makeLocation('Мадрид', 40.4168, -3.7038, 'Europe/Madrid', 'ES'),
  'Минск': makeLocation('Минск', 53.9006, 27.559, 'Europe/Minsk', 'BY'),
  'Нетания': makeLocation('Нетания', 32.3215, 34.8532, 'Asia/Jerusalem', 'IL', true),
  'Нижний Новгород': makeLocation('Нижний Новгород', 56.2965, 43.9361, 'Europe/Moscow', 'RU'),
  'Новосибирск': makeLocation('Новосибирск', 55.0084, 82.9357, 'Asia/Novosibirsk', 'RU'),
  'Пермь': makeLocation('Пермь', 58.0105, 56.2502, 'Asia/Yekaterinburg', 'RU'),
  'Прага': makeLocation('Прага', 50.0755, 14.4378, 'Europe/Prague', 'CZ'),
  'Рим': makeLocation('Рим', 41.9028, 12.4964, 'Europe/Rome', 'IT'),
  'Ростов-на-Дону': makeLocation('Ростов-на-Дону', 47.2357, 39.7015, 'Europe/Moscow', 'RU'),
  'Самара': makeLocation('Самара', 53.1959, 50.1008, 'Europe/Samara', 'RU'),
  'Сочи': makeLocation('Сочи', 43.5855, 39.7231, 'Europe/Moscow', 'RU'),
  'Тбилиси': makeLocation('Тбилиси', 41.7151, 44.8271, 'Asia/Tbilisi', 'GE'),
  'Уфа': makeLocation('Уфа', 54.7388, 55.9721, 'Asia/Yekaterinburg', 'RU'),
};

const CITY_NORMALIZATION: Record<string, SupportedZmanimCity> = {
  'almaty': 'Алматы',
  'alma ata': 'Алматы',
  'alma-ata': 'Алматы',
  'алматы': 'Алматы',
  'алма ата': 'Алматы',
  'алма-ата': 'Алматы',
  'amsterdam': 'Амстердам',
  'амстердам': 'Амстердам',
  'ashdod': 'Ашдод',
  'אשדוד': 'Ашдод',
  'ашдод': 'Ашдод',
  'astana': 'Астана',
  'nur sultan': 'Астана',
  'nur-sultan': 'Астана',
  'nursultan': 'Астана',
  'астана': 'Астана',
  'нур султан': 'Астана',
  'нур-султан': 'Астана',
  'baku': 'Баку',
  'баку': 'Баку',
  'barcelona': 'Барселона',
  'барселона': 'Барселона',
  'beer sheva': 'Беэр-Шева',
  'beersheba': 'Беэр-Шева',
  "be'er sheva": 'Беэр-Шева',
  'באר שבע': 'Беэр-Шева',
  'באר-שבע': 'Беэр-Шева',
  'беер шева': 'Беэр-Шева',
  'беер-шева': 'Беэр-Шева',
  'беэр шева': 'Беэр-Шева',
  'беэр-шева': 'Беэр-Шева',
  'berlin': 'Берлин',
  'берлин': 'Берлин',
  'boston': 'Бостон',
  'бостон': 'Бостон',
  'budapest': 'Будапешт',
  'будапешт': 'Будапешт',
  'chicago': 'Чикаго',
  'чикаго': 'Чикаго',
  'chisinau': 'Кишинёв',
  'kishinev': 'Кишинёв',
  'kishinyov': 'Кишинёв',
  'кишинев': 'Кишинёв',
  'кишинёв': 'Кишинёв',
  'ekaterinburg': 'Екатеринбург',
  'yekaterinburg': 'Екатеринбург',
  'екатеринбург': 'Екатеринбург',
  'erevan': 'Ереван',
  'yerevan': 'Ереван',
  'ереван': 'Ереван',
  'haifa': 'Хайфа',
  'חיפה': 'Хайфа',
  'хайфа': 'Хайфа',
  'jerusalem': 'Иерусалим',
  'yerushalayim': 'Иерусалим',
  'ירושלים': 'Иерусалим',
  'иерусалим': 'Иерусалим',
  'kazan': 'Казань',
  'казань': 'Казань',
  'krasnodar': 'Краснодар',
  'краснодар': 'Краснодар',
  'london': 'Лондон',
  'лондон': 'Лондон',
  'los angeles': 'Лос-Анджелес',
  'los-angeles': 'Лос-Анджелес',
  'la': 'Лос-Анджелес',
  'l.a.': 'Лос-Анджелес',
  'лос анджелес': 'Лос-Анджелес',
  'лос-анджелес': 'Лос-Анджелес',
  'madrid': 'Мадрид',
  'мадрид': 'Мадрид',
  'miami': 'Майами',
  'майами': 'Майами',
  'minsk': 'Минск',
  'минск': 'Минск',
  'montreal': 'Монреаль',
  'montréal': 'Монреаль',
  'монреаль': 'Монреаль',
  'moscow': 'Москва',
  'moskva': 'Москва',
  'москва': 'Москва',
  'netanya': 'Нетания',
  'נתניה': 'Нетания',
  'нетания': 'Нетания',
  'new york': 'Нью-Йорк',
  'new york city': 'Нью-Йорк',
  'nyc': 'Нью-Йорк',
  'нью йорк': 'Нью-Йорк',
  'нью-йорк': 'Нью-Йорк',
  'nizhny novgorod': 'Нижний Новгород',
  'nizhniy novgorod': 'Нижний Новгород',
  'нижний новгород': 'Нижний Новгород',
  'novosibirsk': 'Новосибирск',
  'новосибирск': 'Новосибирск',
  'paris': 'Париж',
  'париж': 'Париж',
  'perm': 'Пермь',
  'пермь': 'Пермь',
  'philadelphia': 'Филадельфия',
  'филадельфия': 'Филадельфия',
  'prague': 'Прага',
  'praha': 'Прага',
  'прага': 'Прага',
  'rome': 'Рим',
  'roma': 'Рим',
  'рим': 'Рим',
  'rostov on don': 'Ростов-на-Дону',
  'rostov-on-don': 'Ростов-на-Дону',
  'ростов на дону': 'Ростов-на-Дону',
  'ростов-на-дону': 'Ростов-на-Дону',
  'samara': 'Самара',
  'самара': 'Самара',
  'saint petersburg': 'Санкт-Петербург',
  'sankt peterburg': 'Санкт-Петербург',
  'sankt-peterburg': 'Санкт-Петербург',
  'st petersburg': 'Санкт-Петербург',
  'st. petersburg': 'Санкт-Петербург',
  'санкт петербург': 'Санкт-Петербург',
  'санкт-петербург': 'Санкт-Петербург',
  'san francisco': 'Сан-Франциско',
  'san-francisco': 'Сан-Франциско',
  'сан франциско': 'Сан-Франциско',
  'сан-франциско': 'Сан-Франциско',
  'sochi': 'Сочи',
  'сочи': 'Сочи',
  'tbilisi': 'Тбилиси',
  'тбилиси': 'Тбилиси',
  'tel aviv': 'Тель-Авив',
  'tel-aviv': 'Тель-Авив',
  'tel aviv yafo': 'Тель-Авив',
  'tel aviv-yafo': 'Тель-Авив',
  'תל אביב': 'Тель-Авив',
  'תל אביב יפו': 'Тель-Авив',
  'תל אביב-יפו': 'Тель-Авив',
  'тель авив': 'Тель-Авив',
  'тель-авив': 'Тель-Авив',
  'toronto': 'Торонто',
  'торонто': 'Торонто',
  'ufa': 'Уфа',
  'уфа': 'Уфа',
  'vienna': 'Вена',
  'wien': 'Вена',
  'вена': 'Вена',
  'volgograd': 'Волгоград',
  'волгоград': 'Волгоград',
  'voronezh': 'Воронеж',
  'воронеж': 'Воронеж',
  'warsaw': 'Варшава',
  'warszawa': 'Варшава',
  'варшава': 'Варшава',
  'washington': 'Вашингтон',
  'washington dc': 'Вашингтон',
  'washington d.c.': 'Вашингтон',
  'вашингтон': 'Вашингтон',
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
  const normalizedCity = normalizeZmanimCityName(city) as SupportedZmanimCity;
  return CITY_LOCATION_OVERRIDES[normalizedCity] ?? Location.lookup(getHebcalCityName(city)) ?? FALLBACK_LOCATION;
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
