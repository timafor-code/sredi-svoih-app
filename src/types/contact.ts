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

export interface ProfileContactVisibilityRow {
  birthday_reminders_enabled: boolean;
  created_at: string;
  share_birth_date: boolean;
  share_city: boolean;
  share_email: boolean;
  share_hebrew_birth_date: boolean;
  share_hebrew_name: boolean;
  share_phone: boolean;
  show_in_community_directory: boolean;
  updated_at: string;
  user_id: string;
}

export interface ProfileContactVisibility {
  birthdayRemindersEnabled: boolean;
  createdAt: string;
  shareBirthDate: boolean;
  shareCity: boolean;
  shareEmail: boolean;
  shareHebrewBirthDate: boolean;
  shareHebrewName: boolean;
  sharePhone: boolean;
  showInCommunityDirectory: boolean;
  updatedAt: string;
  userId: string;
}

export type ContactVisibilityUpdateInput = Pick<
  ProfileContactVisibility,
  | 'birthdayRemindersEnabled'
  | 'shareBirthDate'
  | 'shareCity'
  | 'shareEmail'
  | 'shareHebrewBirthDate'
  | 'shareHebrewName'
  | 'sharePhone'
  | 'showInCommunityDirectory'
>;

export interface CommunityContactRpcRow {
  avatar_id?: string | null;
  avatar_url: string | null;
  birth_date: string | null;
  city: string | null;
  community_id: string;
  display_name: string | null;
  email: string | null;
  first_name: string | null;
  hebrew_birth_date: HebrewDateJson | null;
  hebrew_name: string | null;
  id: string;
  joined_at: string | null;
  last_name: string | null;
  membership_status: string | null;
  phone: string | null;
  role: string | null;
  share_birth_date: boolean;
  share_city: boolean;
  share_email: boolean;
  share_hebrew_birth_date: boolean;
  share_hebrew_name: boolean;
  share_phone: boolean;
  show_in_community_directory: boolean;
  user_id: string;
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
  avatarUrl?: string;
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
