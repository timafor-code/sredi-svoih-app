import { mockContacts } from '@/data/mockContacts';
import { parseRuDate } from '@/lib/birthdays';
import { getHebrewDate, getHebrewDateLabel } from '@/lib/hebcal';
import type { CommunityContact, ContactPhoneNumber, HebrewDateJson } from '@/types/contact';

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

function toPhoneNumbers(phone?: string): ContactPhoneNumber[] {
  return phone ? [{ label: 'primary', number: phone }] : [];
}

function toCommunityContact(contact: (typeof mockContacts)[number]): CommunityContact {
  const birthDate = parseRuDate(contact.dobGregorian);

  return {
    avatarBg: contact.avatarBg,
    birthdayVisibility: 'members',
    birthDate: birthDate ? toDateOnly(birthDate) : undefined,
    city: contact.city,
    displayName: contact.name,
    email: contact.email,
    emailVisibility: 'members',
    hebrewBirthDate: birthDate ? toHebrewDateJson(birthDate) : undefined,
    hebrewName: contact.hebrewName,
    id: contact.id,
    initials: contact.initials,
    phone: contact.phone,
    phoneNumbers: toPhoneNumbers(contact.phone),
    phoneVisibility: 'members',
    role: contact.role,
    roleColor: contact.roleColor,
    source: 'community',
    subtitle: contact.subtitle,
    visibility: 'members',
  };
}

export async function listCommunityContacts(): Promise<CommunityContact[]> {
  // TODO: Replace this adapter with the list_community_contacts RPC in the next backend PR.
  return mockContacts.map(toCommunityContact);
}
