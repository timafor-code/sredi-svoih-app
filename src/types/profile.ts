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

export const DEFAULT_PROFILE_VISIBILITY: ProfileVisibility = 'members';
export const DEFAULT_BIRTHDAY_VISIBILITY: ProfileVisibility = 'members';
export const DEFAULT_PHONE_VISIBILITY: ProfileVisibility = 'rabbi_only';

export function isProfileTribeStatus(value: unknown): value is ProfileTribeStatus {
  return PROFILE_TRIBE_STATUSES.includes(value as ProfileTribeStatus);
}

export function isProfileMaritalStatus(value: unknown): value is ProfileMaritalStatus {
  return PROFILE_MARITAL_STATUSES.includes(value as ProfileMaritalStatus);
}

export function isProfileVisibility(value: unknown): value is ProfileVisibility {
  return PROFILE_VISIBILITIES.includes(value as ProfileVisibility);
}
