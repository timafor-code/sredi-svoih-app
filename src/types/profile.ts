export const PROFILE_TRIBE_STATUSES = ['kohen', 'levi', 'israel'] as const;
export const PROFILE_MARITAL_STATUSES = ['single', 'married', 'divorced', 'widowed', 'other'] as const;
export const PROFILE_VISIBILITIES = ['rabbi_only', 'members', 'public'] as const;
export const PROFILE_BIRTH_TIME_CONTEXTS = ['before_sunset', 'after_sunset', 'unknown'] as const;
export const PROFILE_NUSACH_VALUES = ['chabad', 'sephardi', 'ashkenaz', 'common'] as const;

export type ProfileTribeStatus = (typeof PROFILE_TRIBE_STATUSES)[number];
export type ProfileMaritalStatus = (typeof PROFILE_MARITAL_STATUSES)[number];
export type ProfileVisibility = (typeof PROFILE_VISIBILITIES)[number];
export type ProfileBirthTimeContext = (typeof PROFILE_BIRTH_TIME_CONTEXTS)[number];
export type ProfileNusach = (typeof PROFILE_NUSACH_VALUES)[number];

export const PROFILE_NUSACH_OPTIONS: readonly { label: string; value: ProfileNusach }[] = [
  { label: 'Хабад', value: 'chabad' },
  { label: 'Сфарди', value: 'sephardi' },
  { label: 'Ашкеназ', value: 'ashkenaz' },
  { label: 'Пока не выбрано', value: 'common' },
] as const;

export const PROFILE_BIRTH_TIME_CONTEXT_LABELS: Record<ProfileBirthTimeContext, string> = {
  before_sunset: 'До захода солнца / днём',
  after_sunset: 'После захода солнца / вечером',
  unknown: 'Не знаю',
};

export type HebrewBirthDateSource = {
  gregorianBirthDate: string;
  birthTimeContext: ProfileBirthTimeContext;
  effectiveGregorianDateForHebrew: string;
  uncertainty: boolean;
  note?: string;
};

export type HebrewBirthDateProfile = {
  labelRu: string;
  day: number;
  monthNameRu: string;
  year: number;
  source: HebrewBirthDateSource;
};

export type ProfileNotificationPreferences = {
  prayers: boolean;
  shabbat: boolean;
  holidays: boolean;
  candles: boolean;
  events: boolean;
  birthdays: boolean;
  weekly: boolean;
  news: boolean;
  candlesReminderOffsetMinutes?: number;
  shabbatReminderOffsetHours?: number;
  holidaysReminderHour?: number;
  weeklyReminderOffsetHours?: number;
  birthdaysReminderHour?: number;
  eventsPrimaryReminderOffsetHours?: number;
  eventsFallbackReminderOffsetHours?: number;
  quietHoursEnabled?: boolean;
  quietHoursStart?: string;
  quietHoursEnd?: string;
};

export const DEFAULT_PROFILE_VISIBILITY: ProfileVisibility = 'members';
export const DEFAULT_BIRTHDAY_VISIBILITY: ProfileVisibility = 'members';
export const DEFAULT_PHONE_VISIBILITY: ProfileVisibility = 'rabbi_only';
export const DEFAULT_NOTIFICATION_PREFERENCES: ProfileNotificationPreferences = {
  prayers: true,
  shabbat: true,
  holidays: true,
  candles: true,
  events: true,
  birthdays: true,
  weekly: true,
  news: false,
  candlesReminderOffsetMinutes: 60,
  shabbatReminderOffsetHours: 8,
  holidaysReminderHour: 9,
  weeklyReminderOffsetHours: 8,
  birthdaysReminderHour: 9,
  eventsPrimaryReminderOffsetHours: 24,
  eventsFallbackReminderOffsetHours: 2,
  quietHoursEnabled: false,
  quietHoursStart: '22:00',
  quietHoursEnd: '08:00',
};

export function isProfileTribeStatus(value: unknown): value is ProfileTribeStatus {
  return PROFILE_TRIBE_STATUSES.includes(value as ProfileTribeStatus);
}

export function isProfileMaritalStatus(value: unknown): value is ProfileMaritalStatus {
  return PROFILE_MARITAL_STATUSES.includes(value as ProfileMaritalStatus);
}

export function isProfileVisibility(value: unknown): value is ProfileVisibility {
  return PROFILE_VISIBILITIES.includes(value as ProfileVisibility);
}

export function isProfileBirthTimeContext(value: unknown): value is ProfileBirthTimeContext {
  return PROFILE_BIRTH_TIME_CONTEXTS.includes(value as ProfileBirthTimeContext);
}

export function isProfileNusach(value: unknown): value is ProfileNusach {
  return PROFILE_NUSACH_VALUES.includes(value as ProfileNusach);
}

export function normalizeProfileNusach(value: string | null | undefined): ProfileNusach {
  if (isProfileNusach(value)) {
    return value;
  }

  if (value === 'sephard' || value === 'beit_sefaradi') {
    return 'sephardi';
  }

  if (value === 'ashkenazi') {
    return 'ashkenaz';
  }

  return 'common';
}
