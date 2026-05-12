import { mockContacts } from '@/data/mockContacts';
import { parseRuDate } from '@/lib/birthdays';
import { getHebrewDate, getHebrewDateLabel } from '@/lib/hebcal';
import type {
  CommunityContact,
  CommunityContactRpcRow,
  ContactPhoneNumber,
  HebrewDateJson,
} from '@/types/contact';

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

function trimToUndefined(value?: string | null): string | undefined {
  const trimmed = value?.trim();

  return trimmed ? trimmed : undefined;
}

function toInitials(displayName: string): string {
  const initials = displayName
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');

  return initials || '?';
}

function isHebrewDateJson(value: unknown): value is HebrewDateJson {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Partial<HebrewDateJson>;

  return (
    typeof candidate.day === 'number' &&
    typeof candidate.label === 'string' &&
    typeof candidate.month === 'number' &&
    typeof candidate.monthName === 'string' &&
    typeof candidate.year === 'number'
  );
}

function getBackendDisplayName(row: CommunityContactRpcRow): string {
  const displayName = trimToUndefined(row.display_name);
  if (displayName) {
    return displayName;
  }

  const fullName = [row.first_name, row.last_name]
    .map((part) => trimToUndefined(part))
    .filter((part): part is string => Boolean(part))
    .join(' ');

  return fullName || 'Community member';
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

export function mapCommunityContactRpcRow(row: CommunityContactRpcRow): CommunityContact {
  const displayName = getBackendDisplayName(row);
  const phone = trimToUndefined(row.phone);
  const role = trimToUndefined(row.role);

  return {
    avatarUrl: trimToUndefined(row.avatar_url),
    birthdayVisibility: row.share_birth_date ? 'members' : 'rabbi_only',
    birthDate: trimToUndefined(row.birth_date),
    city: trimToUndefined(row.city),
    displayName,
    email: trimToUndefined(row.email),
    emailVisibility: row.share_email ? 'members' : 'rabbi_only',
    hebrewBirthDate: isHebrewDateJson(row.hebrew_birth_date) ? row.hebrew_birth_date : undefined,
    hebrewName: trimToUndefined(row.hebrew_name),
    id: row.id,
    initials: toInitials(displayName),
    phone,
    phoneNumbers: toPhoneNumbers(phone),
    phoneVisibility: row.share_phone ? 'members' : 'rabbi_only',
    role,
    source: 'community',
    subtitle: role,
    visibility: row.show_in_community_directory ? 'members' : 'rabbi_only',
  };
}

export async function listCommunityContactsFromBackend(
  communityId?: string,
): Promise<CommunityContact[]> {
  const { supabase } = await import('./supabaseClient');
  const { data, error } = await supabase.rpc('list_community_contacts', {
    p_community_id: communityId ?? null,
  });

  if (error) {
    throw new Error(error.message);
  }

  return ((data ?? []) as CommunityContactRpcRow[]).map(mapCommunityContactRpcRow);
}

export async function listCommunityContacts(): Promise<CommunityContact[]> {
  // TODO: Switch PR3/PR4 UI to listCommunityContactsFromBackend once auth/session UX is ready.
  return mockContacts.map(toCommunityContact);
}
