import { apiClient } from "./apiClient";
import type {
  AdminApiMemberDetailResponse,
  AdminApiMemberListItemResponse,
  AdminApiMemberMembershipResponse,
  AdminApiMemberProfileUpdateResponse,
  AdminApiMemberRegistrationResponse,
  AdminApiRegistrationSelectedOptionResponse,
} from "../types/api";
import type {
  AdminMemberListFilters,
  AdminMemberListRow,
  AdminMemberProfile,
  AdminMemberRegistrationRow,
  AdminSetUserMembershipInput,
  AdminUpdatedUserProfile,
  AdminUpdateUserProfileInput,
} from "../types/members";
import type { AdminRegistrationOptionSelectionSummary } from "../types/registrations";

const ADMIN_MEMBERS_COMMUNITY_REQUIRED_MESSAGE =
  "List admin users failed: communityId is required for the API members provider.";

function nullableString(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  return typeof value === "string" ? value : String(value);
}

function requiredString(value: unknown, fallback: string): string {
  const normalized = nullableString(value);
  return normalized && normalized.trim().length > 0 ? normalized : fallback;
}

function nullableNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function safeNumber(value: unknown, fallback: number): number {
  return nullableNumber(value) ?? fallback;
}

function nullableRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

function normalizeSelectionValue(
  row: AdminApiRegistrationSelectedOptionResponse,
): AdminRegistrationOptionSelectionSummary {
  return {
    id: requiredString(row.id, ""),
    optionId: nullableString(row.option_id),
    title: requiredString(row.title, ""),
    description: nullableString(row.description),
    optionType: requiredString(row.option_type, "participation"),
    quantity: safeNumber(row.quantity, 1),
    unitPriceAmount: safeNumber(row.unit_price_amount, 0),
    totalAmount: safeNumber(row.total_amount, 0),
    currency: requiredString(row.currency, "RUB"),
    countsTowardCapacity: row.counts_toward_capacity !== false,
    seatsCount: safeNumber(row.seats_count, 0),
    isDonation: row.is_donation === true,
    createdAt: requiredString(row.created_at, ""),
  };
}

function normalizeSelectedOptions(
  value: readonly AdminApiRegistrationSelectedOptionResponse[] | null | undefined,
): AdminRegistrationOptionSelectionSummary[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map(normalizeSelectionValue);
}

function displayNameFallback(row: AdminApiMemberListItemResponse): string {
  const fullName = [nullableString(row.first_name), nullableString(row.last_name)]
    .filter((entry): entry is string => Boolean(entry && entry.trim().length > 0))
    .join(" ");

  return fullName || "Participant";
}

function normalizeAdminMemberListRow(
  row: AdminApiMemberListItemResponse,
): AdminMemberListRow {
  return {
    userId: requiredString(row.user_id, ""),
    displayName: requiredString(row.display_name, displayNameFallback(row)),
    firstName: nullableString(row.first_name),
    lastName: nullableString(row.last_name),
    email: nullableString(row.email),
    phone: nullableString(row.phone),
    avatarUrl: nullableString(row.avatar_url),
    city: nullableString(row.city),
    birthDate: nullableString(row.birth_date),
    hebrewBirthDate: nullableRecord(row.hebrew_birth_date),
    nusach: nullableString(row.nusach),
    onboardingCompleted: row.onboarding_completed === true,
    profileCreatedAt: nullableString(row.profile_created_at),
    profileUpdatedAt: nullableString(row.profile_updated_at),
    membershipId: nullableString(row.membership_id),
    communityId: nullableString(row.community_id),
    membershipRole: nullableString(row.membership_role),
    membershipStatus: nullableString(row.membership_status),
    joinedAt: nullableString(row.joined_at),
    invitedBy: nullableString(row.invited_by),
    registrationsTotal: safeNumber(row.registrations_total, 0),
    registrationsUpcoming: safeNumber(row.registrations_upcoming, 0),
    registrationsPast: safeNumber(row.registrations_past, 0),
    registrationsCancelled: safeNumber(row.registrations_cancelled, 0),
    lastRegistrationAt: nullableString(row.last_registration_at),
  };
}

function normalizeAdminMemberProfile(
  row: AdminApiMemberDetailResponse,
): AdminMemberProfile {
  return {
    ...normalizeAdminMemberListRow(row),
    profileCommunityId: nullableString(row.profile_community_id),
    fullName: nullableString(row.full_name),
    hebrewName: nullableString(row.hebrew_name),
    birthTimeContext: nullableString(row.birth_time_context),
    tribeStatus: nullableString(row.tribe_status),
    maritalStatus: nullableString(row.marital_status),
    about: nullableString(row.about),
    profileVisibility: nullableString(row.profile_visibility),
    birthdayVisibility: nullableString(row.birthday_visibility),
    phoneVisibility: nullableString(row.phone_visibility),
    notificationPreferences: nullableRecord(row.notification_preferences),
    membershipCommunityId: nullableString(row.membership_community_id),
    membershipCreatedAt: nullableString(row.membership_created_at),
  };
}

function normalizeAdminUpdatedUserProfile(
  row: AdminApiMemberProfileUpdateResponse,
): AdminUpdatedUserProfile {
  return {
    userId: requiredString(row.user_id, ""),
    profileCommunityId: nullableString(row.profile_community_id),
    fullName: nullableString(row.full_name),
    firstName: nullableString(row.first_name),
    lastName: nullableString(row.last_name),
    displayName: nullableString(row.display_name),
    hebrewName: nullableString(row.hebrew_name),
    email: nullableString(row.email),
    phone: nullableString(row.phone),
    city: nullableString(row.city),
    birthDate: nullableString(row.birth_date),
    hebrewBirthDate: nullableRecord(row.hebrew_birth_date),
    birthTimeContext: nullableString(row.birth_time_context),
    nusach: nullableString(row.nusach),
    tribeStatus: nullableString(row.tribe_status),
    maritalStatus: nullableString(row.marital_status),
    about: nullableString(row.about),
    onboardingCompleted: row.onboarding_completed === true,
    profileUpdatedAt: nullableString(row.profile_updated_at),
  };
}

function normalizeAdminMemberRegistrationRow(
  row: AdminApiMemberRegistrationResponse,
): AdminMemberRegistrationRow {
  return {
    registrationId: requiredString(row.registration_id, ""),
    eventId: requiredString(row.event_id, ""),
    eventTitle: requiredString(row.event_title, "Untitled event"),
    occurrenceId: nullableString(row.occurrence_id),
    occurrenceTitle: nullableString(row.occurrence_title),
    occurrenceStartsAt: nullableString(row.occurrence_starts_at),
    occurrenceEndsAt: nullableString(row.occurrence_ends_at),
    registrationStatus: requiredString(row.registration_status, "pending"),
    seatsCount: safeNumber(row.seats_count, 1),
    paymentStatus: requiredString(row.payment_status, "not_required"),
    registeredAt: nullableString(row.registered_at),
    confirmedAt: nullableString(row.confirmed_at),
    cancelledAt: nullableString(row.cancelled_at),
    selectedOptions: normalizeSelectedOptions(row.selected_options),
  };
}

function includeProfileField(
  body: Record<string, unknown>,
  key: string,
  value: unknown,
): void {
  if (value !== undefined) {
    body[key] = value;
  }
}

function buildUpdateUserProfileBody(
  input: AdminUpdateUserProfileInput,
): Record<string, unknown> {
  const source = input.fields;
  const body: Record<string, unknown> = {
    community_id: input.communityId,
  };

  includeProfileField(body, "full_name", source.fullName);
  includeProfileField(body, "first_name", source.firstName);
  includeProfileField(body, "last_name", source.lastName);
  includeProfileField(body, "display_name", source.displayName);
  includeProfileField(body, "hebrew_name", source.hebrewName);
  includeProfileField(body, "email", source.email);
  includeProfileField(body, "phone", source.phone);
  includeProfileField(body, "city", source.city);
  includeProfileField(body, "birth_date", source.birthDate);
  includeProfileField(body, "hebrew_birth_date", source.hebrewBirthDate);
  includeProfileField(body, "birth_time_context", source.birthTimeContext);
  includeProfileField(body, "nusach", source.nusach);
  includeProfileField(body, "tribe_status", source.tribeStatus);
  includeProfileField(body, "marital_status", source.maritalStatus);
  includeProfileField(body, "about", source.about);
  includeProfileField(body, "onboarding_completed", source.onboardingCompleted);

  return body;
}

export async function listAdminUsers(
  filters: AdminMemberListFilters,
): Promise<AdminMemberListRow[]> {
  if (!filters.communityId) {
    throw new Error(ADMIN_MEMBERS_COMMUNITY_REQUIRED_MESSAGE);
  }

  const rows = await apiClient.get<AdminApiMemberListItemResponse[]>(
    "/admin/members",
    {
      query: {
        community_id: filters.communityId,
        search: filters.search?.trim() || undefined,
        role: filters.role && filters.role !== "all" ? filters.role : undefined,
        membership_status:
          filters.membershipStatus && filters.membershipStatus !== "all"
            ? filters.membershipStatus
            : undefined,
        limit: filters.limit ?? undefined,
        offset: filters.offset ?? undefined,
      },
    },
  );

  return (rows ?? []).map(normalizeAdminMemberListRow);
}

export async function getAdminUserProfile(
  userId: string,
  communityId: string,
): Promise<AdminMemberProfile> {
  const row = await apiClient.get<AdminApiMemberDetailResponse>(
    `/admin/members/${encodeURIComponent(userId)}`,
    {
      query: { community_id: communityId },
    },
  );

  return normalizeAdminMemberProfile(row);
}

export async function listAdminUserRegistrations(
  userId: string,
  communityId: string,
): Promise<AdminMemberRegistrationRow[]> {
  const rows = await apiClient.get<AdminApiMemberRegistrationResponse[]>(
    `/admin/members/${encodeURIComponent(userId)}/registrations`,
    {
      query: { community_id: communityId },
    },
  );

  return (rows ?? []).map(normalizeAdminMemberRegistrationRow);
}

export async function updateAdminUserProfile(
  input: AdminUpdateUserProfileInput,
): Promise<AdminUpdatedUserProfile> {
  const row = await apiClient.patch<AdminApiMemberProfileUpdateResponse>(
    `/admin/members/${encodeURIComponent(input.targetUserId)}/profile`,
    buildUpdateUserProfileBody(input),
  );

  return normalizeAdminUpdatedUserProfile(row);
}

export async function setAdminUserMembership(
  input: AdminSetUserMembershipInput,
): Promise<void> {
  await apiClient.patch<AdminApiMemberMembershipResponse>(
    `/admin/members/${encodeURIComponent(input.userId)}/membership`,
    {
      community_id: input.communityId,
      role: input.role,
      status: input.status,
    },
  );
}
