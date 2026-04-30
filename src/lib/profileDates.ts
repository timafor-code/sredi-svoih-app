import { getHebrewDate } from './hebcal';
import { monthNameRu } from './hebcalRu';
import type { HebrewBirthDateProfile, ProfileBirthTimeContext } from '@/types/profile';

const INCOMPLETE_BIRTH_DATE_ERROR = 'Введите дату полностью.';
const INVALID_BIRTH_DATE_ERROR = 'Проверьте дату рождения.';

export type BirthDateParseResult = {
  date: Date | null;
  error: string | null;
  iso: string | null;
  isComplete: boolean;
};

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

function formatDatePartsToIso(year: number, month: number, day: number): string {
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

function formatDateToIso(date: Date): string {
  return formatDatePartsToIso(date.getFullYear(), date.getMonth() + 1, date.getDate());
}

function addCalendarDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

function isRealDate(year: number, month: number, day: number): boolean {
  const date = new Date(year, month - 1, day);

  return (
    date.getFullYear() === year
    && date.getMonth() === month - 1
    && date.getDate() === day
  );
}

export function formatIsoDateForUi(value: string | null | undefined): string {
  const match = value?.match(/^(\d{4})-(\d{2})-(\d{2})$/);

  if (!match) {
    return '';
  }

  return `${match[3]}.${match[2]}.${match[1]}`;
}

export function formatBirthDateInput(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 8);
  const day = digits.slice(0, 2);
  const month = digits.slice(2, 4);
  const year = digits.slice(4);

  if (digits.length <= 1) {
    return day;
  }

  if (digits.length <= 3) {
    return `${day}.${month}`;
  }

  return `${day}.${month}.${year}`;
}

export function parseBirthDateInput(value: string): BirthDateParseResult {
  const text = value.trim();

  if (!text) {
    return { date: null, error: null, iso: null, isComplete: true };
  }

  if (!/^\d{2}\.\d{2}\.\d{4}$/.test(text)) {
    return {
      date: null,
      error: INCOMPLETE_BIRTH_DATE_ERROR,
      iso: null,
      isComplete: false,
    };
  }

  const day = Number(text.slice(0, 2));
  const month = Number(text.slice(3, 5));
  const year = Number(text.slice(6, 10));

  if (
    day < 1
    || day > 31
    || month < 1
    || month > 12
    || year < 1900
    || !isRealDate(year, month, day)
  ) {
    return {
      date: null,
      error: INVALID_BIRTH_DATE_ERROR,
      iso: null,
      isComplete: true,
    };
  }

  const date = new Date(year, month - 1, day);
  const today = new Date();
  const todayDate = new Date(today.getFullYear(), today.getMonth(), today.getDate());

  if (date.getTime() > todayDate.getTime()) {
    return {
      date: null,
      error: 'Дата рождения не может быть в будущем.',
      iso: null,
      isComplete: true,
    };
  }

  return {
    date,
    error: null,
    iso: formatDatePartsToIso(year, month, day),
    isComplete: true,
  };
}

export function buildHebrewBirthDateProfile(
  date: Date,
  birthTimeContext: ProfileBirthTimeContext = 'unknown',
): HebrewBirthDateProfile {
  const effectiveDate = birthTimeContext === 'after_sunset'
    ? addCalendarDays(date, 1)
    : date;
  const hebrewDate = getHebrewDate(effectiveDate);
  const day = hebrewDate.getDate();
  const monthName = monthNameRu(hebrewDate.getMonthName());
  const year = hebrewDate.getFullYear();
  const uncertainty = birthTimeContext === 'unknown';

  return {
    labelRu: `${day} ${monthName} ${year}`,
    day,
    monthNameRu: monthName,
    year,
    source: {
      gregorianBirthDate: formatDateToIso(date),
      birthTimeContext,
      effectiveGregorianDateForHebrew: formatDateToIso(effectiveDate),
      uncertainty,
      ...(uncertainty
        ? { note: 'Если рождение было после захода солнца, еврейская дата может быть следующей.' }
        : {}),
    },
  };
}
