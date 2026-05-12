import { formatBirthdayWhen } from '@/lib/birthdays';
import { daysUntil } from '@/lib/dates';
import { getHebrewDate, getHebrewDateLabel, getNextHebrewBirthday } from '@/lib/hebcal';
import type {
  BirthdayOccurrence,
  CommunityContact,
  ContactListItem,
  ContactSource,
  ContactVisibility,
  HebrewDateJson,
  LocalIphoneContact,
} from '@/types/contact';

import { listCommunityContacts as listCommunityContactsAdapter } from './communityContactsService';
import {
  loadLocalBirthdayContacts,
  type LoadLocalBirthdayContactsResult,
} from './localContactsService';

export interface GetUpcomingBirthdaysParams {
  communityContacts?: CommunityContact[];
  fromDate?: Date;
  limit?: number;
  localContacts?: LocalIphoneContact[];
}

export interface ToContactListItemsParams {
  communityContacts?: CommunityContact[];
  fromDate?: Date;
  localContacts?: LocalIphoneContact[];
}

interface BirthdayContactInput {
  avatarBg?: string;
  birthdayVisibility?: ContactVisibility;
  birthDate?: string;
  displayName: string;
  hebrewBirthDate?: HebrewDateJson;
  id: string;
  initials: string;
  source: ContactSource;
}

function toDateOnly(value: Date) {
  const year = String(value.getFullYear()).padStart(4, '0');
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseDateOnly(value?: string): Date | null {
  if (!value) return null;

  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const day = Number(match[3]);
  const date = new Date(year, month, day);

  if (date.getFullYear() !== year || date.getMonth() !== month || date.getDate() !== day) return null;
  return date;
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

function buildBirthdayOccurrence(
  contact: BirthdayContactInput,
  fromDate: Date,
): BirthdayOccurrence | null {
  const birthDate = parseDateOnly(contact.birthDate);
  if (!birthDate) return null;

  const nextBirthday = getNextHebrewBirthday(birthDate, fromDate);
  if (!nextBirthday) return null;

  const count = daysUntil(nextBirthday, fromDate);
  return {
    avatarBg: contact.avatarBg,
    birthDateGregorian: contact.birthDate,
    contactId: contact.id,
    daysUntil: count,
    displayName: contact.displayName,
    hebrewBirthDate: contact.hebrewBirthDate ?? toHebrewDateJson(birthDate),
    id: `${contact.id}:birthday`,
    initials: contact.initials,
    nextDateGregorian: toDateOnly(nextBirthday),
    nextDateHebrew: toHebrewDateJson(nextBirthday),
    source: contact.source,
    visibility: contact.birthdayVisibility,
    when: formatBirthdayWhen(count),
  };
}

export async function listCommunityContacts(): Promise<CommunityContact[]> {
  return listCommunityContactsAdapter();
}

export async function listLocalBirthdayContacts(fromDate?: Date): Promise<LoadLocalBirthdayContactsResult> {
  return loadLocalBirthdayContacts(fromDate);
}

export function getUpcomingBirthdays({
  communityContacts = [],
  fromDate = new Date(),
  limit = 10,
  localContacts = [],
}: GetUpcomingBirthdaysParams = {}): BirthdayOccurrence[] {
  return [
    ...communityContacts.map((contact) => buildBirthdayOccurrence(contact, fromDate)),
    ...localContacts.map((contact) => buildBirthdayOccurrence(contact, fromDate)),
  ]
    .filter((birthday): birthday is BirthdayOccurrence => Boolean(birthday))
    .sort((a, b) => a.daysUntil - b.daysUntil || a.displayName.localeCompare(b.displayName))
    .slice(0, limit);
}

export function toContactListItems({
  communityContacts = [],
  fromDate = new Date(),
  localContacts = [],
}: ToContactListItemsParams = {}): ContactListItem[] {
  return [
    ...communityContacts.map((contact) => {
      const birthday = buildBirthdayOccurrence(contact, fromDate);
      return {
        avatarBg: contact.avatarBg,
        birthday: birthday ?? undefined,
        communityContact: contact,
        displayName: contact.displayName,
        id: contact.id,
        initials: contact.initials,
        phoneNumbers: contact.phoneNumbers,
        role: contact.role,
        roleColor: contact.roleColor,
        source: contact.source,
        subtitle: contact.subtitle,
      };
    }),
    ...localContacts.map((contact) => {
      const birthday = buildBirthdayOccurrence(contact, fromDate) ?? contact.nextHebrewBirthday;
      return {
        birthday,
        displayName: contact.displayName,
        id: contact.id,
        initials: contact.initials,
        localContact: contact,
        phoneNumbers: contact.phoneNumbers,
        source: contact.source,
        subtitle: birthday.nextDateHebrew.label,
      };
    }),
  ];
}

export const contactsService = {
  getUpcomingBirthdays,
  list: listCommunityContacts,
  listCommunityContacts,
  listLocalBirthdayContacts,
  toContactListItems,
};
