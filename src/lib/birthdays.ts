import type { ContactItem } from '@/types/contact';

import { daysUntil, formatRuDate } from './dates';
import { getHebrewDateLabel, getNextHebrewBirthday } from './hebcal';

const RU_MONTH_INDEX: Record<string, number> = {
  'августа': 7,
  'апреля': 3,
  'декабря': 11,
  'июля': 6,
  'июня': 5,
  'мая': 4,
  'марта': 2,
  'ноября': 10,
  'октября': 9,
  'сентября': 8,
  'февраля': 1,
  'января': 0,
};

export interface ContactBirthdayInfo {
  birthDate: Date;
  daysUntil: number;
  dobHebrew: string;
  nextBirthday: string;
  nextBirthdayDate: Date;
  nextBirthdaySub: string;
  when: string;
}

export function parseRuDate(value: string): Date | null {
  const match = value.trim().toLowerCase().match(/^(\d{1,2})\s+([а-яё]+)\s+(\d{4})$/i);
  if (!match) return null;

  const day = Number(match[1]);
  const month = RU_MONTH_INDEX[match[2]];
  const year = Number(match[3]);
  if (!Number.isInteger(day) || month === undefined || !Number.isInteger(year)) return null;

  return new Date(year, month, day);
}

export function formatBirthdayWhen(count: number) {
  if (count === 0) return 'Сегодня 🎉';
  return `через ${count} д`;
}

export function getContactBirthdayInfo(contact: ContactItem, fromDate: Date = new Date()): ContactBirthdayInfo | null {
  const birthDate = parseRuDate(contact.dobGregorian);
  if (!birthDate) return null;

  const nextBirthdayDate = getNextHebrewBirthday(birthDate, fromDate);
  if (!nextBirthdayDate) return null;

  const count = daysUntil(nextBirthdayDate, fromDate);

  return {
    birthDate,
    daysUntil: count,
    dobHebrew: getHebrewDateLabel(birthDate),
    nextBirthday: getHebrewDateLabel(nextBirthdayDate),
    nextBirthdayDate,
    nextBirthdaySub: `${formatRuDate(nextBirthdayDate)} · ${count === 0 ? 'сегодня' : `через ${count} дн`}`,
    when: formatBirthdayWhen(count),
  };
}

export function getUpcomingContactBirthdays(contacts: ContactItem[], fromDate: Date = new Date(), limit = 3) {
  return contacts
    .map((contact) => {
      const birthday = getContactBirthdayInfo(contact, fromDate);
      return birthday ? { birthday, contact } : null;
    })
    .filter((item): item is { birthday: ContactBirthdayInfo; contact: ContactItem } => Boolean(item))
    .sort((a, b) => a.birthday.daysUntil - b.birthday.daysUntil)
    .slice(0, limit);
}
