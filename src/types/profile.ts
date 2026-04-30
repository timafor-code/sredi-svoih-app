export const PROFILE_TRIBE_STATUSES = ['kohen', 'levi', 'israel'] as const;
export const PROFILE_MARITAL_STATUSES = ['single', 'married', 'divorced', 'widowed', 'other'] as const;
export const PROFILE_VISIBILITIES = ['rabbi_only', 'members', 'public'] as const;

export type ProfileTribeStatus = (typeof PROFILE_TRIBE_STATUSES)[number];
export type ProfileMaritalStatus = (typeof PROFILE_MARITAL_STATUSES)[number];
export type ProfileVisibility = (typeof PROFILE_VISIBILITIES)[number];

export type HebrewBirthDateProfile = {
  labelRu: string;
  day: number;
  monthNameRu: string;
  year: number;
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
