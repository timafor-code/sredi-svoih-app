import { readContactsLocalOnlyGranted, requestContactsPermission } from '@/lib/contacts';
import { formatBirthdayWhen } from '@/lib/birthdays';
import { daysUntil } from '@/lib/dates';
import { getHebrewDate, getHebrewDateLabel, getNextHebrewBirthday } from '@/lib/hebcal';
import type {
  BirthdayOccurrence,
  ContactPhoneNumber,
  HebrewDateJson,
  LocalContactsPermissionStatus,
  LocalIphoneContact,
} from '@/types/contact';

type DeviceContact = Awaited<ReturnType<typeof readContactsLocalOnlyGranted>>[number];

export interface LoadLocalBirthdayContactsResult {
  contacts: LocalIphoneContact[];
  error?: string;
  ok: boolean;
  permissionStatus: LocalContactsPermissionStatus;
}

function toDateOnly(value: Date) {
  const year = String(value.getFullYear()).padStart(4, '0');
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function toHebrewDateJson(date: Date): HebrewDateJson {
  const hebrewDate = getHebrewDate(date);
  return {
    day: hebrewDate.getDate(),
    label: getHebrewDateLabel(hebrewDate),
    month: hebrewDate.getMonth(),
    monthName: hebrewDate.getMonthName(),
    year: hebrewDate.getFullYear(),
  };
}

function normalizeBirthdayDate(birthday: DeviceContact['birthday']): Date | null {
  if (!birthday || birthday.year === undefined) return null;

  const day = birthday.day;
  const month = birthday.month;
  const year = birthday.year;
  if (!Number.isInteger(day) || !Number.isInteger(month) || !Number.isInteger(year)) return null;
  if (day < 1 || day > 31 || month < 0 || month > 11 || year < 1) return null;

  const birthDate = new Date(year, month, day);
  if (
    birthDate.getFullYear() !== year ||
    birthDate.getMonth() !== month ||
    birthDate.getDate() !== day
  ) {
    return null;
  }

  return birthDate;
}

function normalizePhoneNumbers(phoneNumbers: DeviceContact['phoneNumbers']): ContactPhoneNumber[] {
  const normalized: ContactPhoneNumber[] = [];

  for (const phone of phoneNumbers ?? []) {
    const number = phone.number?.trim();
    if (!number) continue;

    normalized.push({
      digits: phone.digits,
      id: phone.id,
      isPrimary: phone.isPrimary,
      label: phone.label,
      number,
    });
  }

  return normalized;
}

function getDisplayName(contact: DeviceContact, phoneNumbers: ContactPhoneNumber[]) {
  const name = contact.name?.trim();
  if (name) return name;

  const nameParts = [contact.firstName, contact.middleName, contact.lastName]
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part));
  if (nameParts.length > 0) return nameParts.join(' ');

  const nickname = contact.nickname?.trim();
  if (nickname) return nickname;

  const company = contact.company?.trim();
  if (company) return company;

  return phoneNumbers[0]?.number ?? contact.id;
}

function getInitials(displayName: string) {
  const parts = displayName
    .split(/\s+/)
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length === 0) return '?';
  if (parts.length === 1) return Array.from(parts[0]).slice(0, 2).join('').toUpperCase();
  return parts
    .slice(0, 2)
    .map((part) => Array.from(part)[0])
    .join('')
    .toUpperCase();
}

function toBirthdayOccurrence(
  contact: Pick<LocalIphoneContact, 'birthDate' | 'displayName' | 'hebrewBirthDate' | 'id' | 'initials'>,
  birthDate: Date,
  fromDate: Date,
): BirthdayOccurrence | null {
  const nextBirthday = getNextHebrewBirthday(birthDate, fromDate);
  if (!nextBirthday) return null;

  const count = daysUntil(nextBirthday, fromDate);
  return {
    birthDateGregorian: contact.birthDate,
    contactId: contact.id,
    daysUntil: count,
    displayName: contact.displayName,
    hebrewBirthDate: contact.hebrewBirthDate,
    id: `${contact.id}:birthday`,
    initials: contact.initials,
    nextDateGregorian: toDateOnly(nextBirthday),
    nextDateHebrew: toHebrewDateJson(nextBirthday),
    source: 'iphone',
    when: formatBirthdayWhen(count),
  };
}

function normalizeLocalBirthdayContact(contact: DeviceContact, fromDate: Date): LocalIphoneContact | null {
  const birthDate = normalizeBirthdayDate(contact.birthday);
  if (!birthDate) return null;

  const nextBirthday = getNextHebrewBirthday(birthDate, fromDate);
  if (!nextBirthday) return null;

  const phoneNumbers = normalizePhoneNumbers(contact.phoneNumbers);
  const displayName = getDisplayName(contact, phoneNumbers);
  const normalizedContact = {
    birthDate: toDateOnly(birthDate),
    deviceContactId: contact.id,
    displayName,
    hebrewBirthDate: toHebrewDateJson(birthDate),
    id: `iphone:${contact.id}`,
    initials: getInitials(displayName),
    phoneNumbers,
    source: 'iphone' as const,
  };
  const nextHebrewBirthday = toBirthdayOccurrence(normalizedContact, birthDate, fromDate);
  if (!nextHebrewBirthday) return null;

  return {
    ...normalizedContact,
    nextHebrewBirthday,
  };
}

function toErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'local_contacts_error';
}

export async function loadLocalBirthdayContacts(fromDate: Date = new Date()): Promise<LoadLocalBirthdayContactsResult> {
  try {
    const granted = await requestContactsPermission();
    if (!granted) {
      return {
        contacts: [],
        error: 'contacts_permission_denied',
        ok: false,
        permissionStatus: 'denied',
      };
    }

    const contacts = await readContactsLocalOnlyGranted();
    return {
      contacts: contacts
        .map((contact) => normalizeLocalBirthdayContact(contact, fromDate))
        .filter((contact): contact is LocalIphoneContact => Boolean(contact)),
      ok: true,
      permissionStatus: 'granted',
    };
  } catch (error) {
    return {
      contacts: [],
      error: toErrorMessage(error),
      ok: false,
      permissionStatus: 'error',
    };
  }
}
