import type {
  AdminRegistrationOptionSelectionSummary,
  AdminRegistrationStatus,
} from "./registrations";

export const ADMIN_MEMBER_MEMBERSHIP_ROLES = [
  "member",
  "rabbi",
  "event_manager",
  "admin",
] as const;

export const ADMIN_MEMBER_MEMBERSHIP_STATUSES = [
  "pending",
  "active",
  "suspended",
  "left",
] as const;

export type AdminMemberMembershipRole =
  (typeof ADMIN_MEMBER_MEMBERSHIP_ROLES)[number];

export type AdminMemberMembershipStatus =
  (typeof ADMIN_MEMBER_MEMBERSHIP_STATUSES)[number];

export type AdminMemberBirthTimeContext =
  | "before_sunset"
  | "after_sunset"
  | "unknown";

export type AdminMemberTribeStatus = "kohen" | "levi" | "israel";

export type AdminMemberMaritalStatus =
  | "single"
  | "married"
  | "divorced"
  | "widowed"
  | "other";

export type AdminMemberMembershipStatusFilter =
  | AdminMemberMembershipStatus
  | "all"
  | "no_membership";

export type AdminMemberListRow = {
  userId: string;
  displayName: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  avatarUrl: string | null;
  city: string | null;
  birthDate: string | null;
  hebrewBirthDate: Record<string, unknown> | null;
  nusach: string | null;
  onboardingCompleted: boolean;
  profileCreatedAt: string | null;
  profileUpdatedAt: string | null;
  membershipId: string | null;
  communityId: string | null;
  membershipRole: AdminMemberMembershipRole | string | null;
  membershipStatus: AdminMemberMembershipStatus | string | null;
  joinedAt: string | null;
  invitedBy: string | null;
  registrationsTotal: number;
  registrationsUpcoming: number;
  registrationsPast: number;
  registrationsCancelled: number;
  lastRegistrationAt: string | null;
};

export type AdminMemberProfile = AdminMemberListRow & {
  profileCommunityId: string | null;
  fullName: string | null;
  hebrewName: string | null;
  birthTimeContext: string | null;
  tribeStatus: string | null;
  maritalStatus: string | null;
  about: string | null;
  profileVisibility: string | null;
  birthdayVisibility: string | null;
  phoneVisibility: string | null;
  notificationPreferences: Record<string, unknown> | null;
  membershipCommunityId: string | null;
  membershipCreatedAt: string | null;
};

export type AdminMemberRegistrationRow = {
  registrationId: string;
  eventId: string;
  eventTitle: string;
  occurrenceId: string | null;
  occurrenceTitle: string | null;
  occurrenceStartsAt: string | null;
  occurrenceEndsAt: string | null;
  registrationStatus: AdminRegistrationStatus | string;
  seatsCount: number;
  paymentStatus: string;
  registeredAt: string | null;
  confirmedAt: string | null;
  cancelledAt: string | null;
  selectedOptions: AdminRegistrationOptionSelectionSummary[];
};

export type AdminMemberListFilters = {
  communityId?: string | null;
  search?: string | null;
  role?: AdminMemberMembershipRole | "all" | null;
  membershipStatus?: AdminMemberMembershipStatusFilter | null;
  limit?: number | null;
  offset?: number | null;
};

export type AdminSetUserMembershipInput = {
  userId: string;
  communityId: string;
  role: AdminMemberMembershipRole;
  status: AdminMemberMembershipStatus;
};

export type AdminUpdateUserProfileFields = {
  fullName?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  displayName?: string | null;
  hebrewName?: string | null;
  email?: string | null;
  phone?: string | null;
  city?: string | null;
  birthDate?: string | null;
  hebrewBirthDate?: Record<string, unknown> | null;
  birthTimeContext?: AdminMemberBirthTimeContext;
  nusach?: string | null;
  tribeStatus?: AdminMemberTribeStatus | null;
  maritalStatus?: AdminMemberMaritalStatus | null;
  about?: string | null;
  onboardingCompleted?: boolean;
};

export type AdminUpdateUserProfileInput = {
  targetUserId: string;
  communityId: string;
  fields: AdminUpdateUserProfileFields;
};

export type AdminUpdatedUserProfile = {
  userId: string;
  profileCommunityId: string | null;
  fullName: string | null;
  firstName: string | null;
  lastName: string | null;
  displayName: string | null;
  hebrewName: string | null;
  email: string | null;
  phone: string | null;
  city: string | null;
  birthDate: string | null;
  hebrewBirthDate: Record<string, unknown> | null;
  birthTimeContext: AdminMemberBirthTimeContext | string | null;
  nusach: string | null;
  tribeStatus: AdminMemberTribeStatus | string | null;
  maritalStatus: AdminMemberMaritalStatus | string | null;
  about: string | null;
  onboardingCompleted: boolean;
  profileUpdatedAt: string | null;
};
