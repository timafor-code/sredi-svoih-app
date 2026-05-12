export type ContactSource = 'community' | 'iphone';

export type ContactVisibility = 'rabbi_only' | 'members' | 'public';

export type LocalContactsPermissionStatus = 'unknown' | 'granted' | 'denied' | 'limited' | 'unavailable' | 'error';

export interface HebrewDateJson {
  day: number;
  label: string;
  month: number;
  monthName: string;
  year: number;
}

export interface ContactPhoneNumber {
  digits?: string;
  id?: string;
  isPrimary?: boolean;
  label?: string;
  number: string;
}

export interface BirthdayOccurrence {
  avatarBg?: string;
  birthDateGregorian?: string;
  contactId: string;
  daysUntil: number;
  displayName: string;
  hebrewBirthDate: HebrewDateJson;
  id: string;
  initials: string;
  nextDateGregorian: string;
  nextDateHebrew: HebrewDateJson;
  source: ContactSource;
  visibility?: ContactVisibility;
  when: string;
}

export interface CommunityContact {
  avatarBg?: string;
  birthdayVisibility?: ContactVisibility;
  birthDate?: string;
  city?: string;
  displayName: string;
  email?: string;
  emailVisibility?: ContactVisibility;
  hebrewBirthDate?: HebrewDateJson;
  hebrewName?: string;
  id: string;
  initials: string;
  nextHebrewBirthday?: BirthdayOccurrence;
  phone?: string;
  phoneNumbers: ContactPhoneNumber[];
  phoneVisibility?: ContactVisibility;
  role?: string;
  roleColor?: string;
  source: 'community';
  subtitle?: string;
  visibility?: ContactVisibility;
}

export interface LocalIphoneContact {
  birthDate: string;
  deviceContactId: string;
  displayName: string;
  hebrewBirthDate: HebrewDateJson;
  id: string;
  initials: string;
  nextHebrewBirthday: BirthdayOccurrence;
  phoneNumbers: ContactPhoneNumber[];
  source: 'iphone';
}

export interface ContactListItem {
  avatarBg?: string;
  birthday?: BirthdayOccurrence;
  communityContact?: CommunityContact;
  displayName: string;
  id: string;
  initials: string;
  localContact?: LocalIphoneContact;
  phoneNumbers: ContactPhoneNumber[];
  role?: string;
  roleColor?: string;
  source: ContactSource;
  subtitle?: string;
}

export interface ContactActivity {
  icon: string;
  subtitle: string;
  title: string;
}

export interface ContactItem {
  activities?: ContactActivity[];
  age?: number;
  avatarBg?: string;
  bio?: string;
  city: string;
  dobGregorian: string;
  dobHebrew: string;
  email: string;
  hebrewName: string;
  id: string;
  initials: string;
  marital?: string;
  name: string;
  nextBirthday: string;
  nextBirthdaySub?: string;
  phone: string;
  role?: string;
  roleColor?: string;
  subtitle?: string;
  synced?: boolean;
  tribe: 'Коэн' | 'Леви' | 'Исраэль';
}
