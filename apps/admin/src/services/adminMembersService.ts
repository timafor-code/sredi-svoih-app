import { requireSupabaseClient } from "./supabaseClient";
import type {
  AdminMemberListFilters,
  AdminMemberListRow,
  AdminMemberMembershipRole,
  AdminMemberMembershipStatus,
  AdminMemberProfile,
  AdminMemberRegistrationRow,
  AdminSetUserMembershipInput,
} from "../types/members";
import type { AdminRegistrationOptionSelectionSummary } from "../types/registrations";

const ADMIN_MEMBERS_RPC_NOT_FOUND_MESSAGE =
  "Admin members RPC not found. Apply admin members migration first.";

const ADMIN_MEMBERS_ACCESS_DENIED_MESSAGE =
  "Недостаточно прав: управление участниками доступно только администратору общины.";

type SupabaseRpcError = {
  code?: string;
  message?: string;
  details?: string | null;
  hint?: string | null;
};

type AdminMemberListRpcRow = {
  user_id?: unknown;
  display_name?: unknown;
  first_name?: unknown;
  last_name?: unknown;
  email?: unknown;
  phone?: unknown;
  avatar_url?: unknown;
  city?: unknown;
  birth_date?: unknown;
  hebrew_birth_date?: unknown;
  nusach?: unknown;
  onboarding_completed?: unknown;
  profile_created_at?: unknown;
  profile_updated_at?: unknown;
  membership_id?: unknown;
  community_id?: unknown;
  membership_role?: unknown;
  membership_status?: unknown;
  joined_at?: unknown;
  invited_by?: unknown;
  registrations_total?: unknown;
  registrations_upcoming?: unknown;
  registrations_past?: unknown;
  registrations_cancelled?: unknown;
  last_registration_at?: unknown;
};

type AdminMemberProfileRpcRow = AdminMemberListRpcRow & {
  profile_community_id?: unknown;
  full_name?: unknown;
  hebrew_name?: unknown;
  birth_time_context?: unknown;
  tribe_status?: unknown;
  marital_status?: unknown;
  about?: unknown;
  profile_visibility?: unknown;
  birthday_visibility?: unknown;
  phone_visibility?: unknown;
  notification_preferences?: unknown;
  membership_community_id?: unknown;
  membership_created_at?: unknown;
};

type AdminMemberRegistrationRpcRow = {
  registration_id?: unknown;
  event_id?: unknown;
  event_title?: unknown;
  occurrence_id?: unknown;
  occurrence_title?: unknown;
  occurrence_starts_at?: unknown;
  occurrence_ends_at?: unknown;
  registration_status?: unknown;
  seats_count?: unknown;
  payment_status?: unknown;
  registered_at?: unknown;
  confirmed_at?: unknown;
  cancelled_at?: unknown;
  selected_options?: unknown;
};

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

function displayNameFallback(row: AdminMemberListRpcRow): string {
  const fullName = [nullableString(row.first_name), nullableString(row.last_name)]
    .filter((entry): entry is string => Boolean(entry && entry.trim().length > 0))
    .join(" ");

  return fullName || "Participant";
}

function normalizeSelectionValue(
  value: unknown,
): AdminRegistrationOptionSelectionSummary | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const row = value as Record<string, unknown>;

  return {
    id: requiredString(row.id, ""),
    optionId: nullableString(row.optionId ?? row.option_id),
    title: requiredString(row.title, ""),
    description: nullableString(row.description),
    optionType: requiredString(row.optionType ?? row.option_type, "participation"),
    quantity: safeNumber(row.quantity, 1),
    unitPriceAmount: safeNumber(row.unitPriceAmount ?? row.unit_price_amount, 0),
    totalAmount: safeNumber(row.totalAmount ?? row.total_amount, 0),
    currency: requiredString(row.currency, "RUB"),
    countsTowardCapacity: (row.countsTowardCapacity ?? row.counts_toward_capacity) !== false,
    seatsCount: safeNumber(row.seatsCount ?? row.seats_count, 0),
    isDonation: (row.isDonation ?? row.is_donation) === true,
    createdAt: requiredString(row.createdAt ?? row.created_at, ""),
  };
}

function normalizeSelectedOptions(value: unknown): AdminRegistrationOptionSelectionSummary[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map(normalizeSelectionValue)
    .filter((entry): entry is AdminRegistrationOptionSelectionSummary => Boolean(entry));
}

function normalizeAdminMemberListRow(row: AdminMemberListRpcRow): AdminMemberListRow {
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

function normalizeAdminMemberProfileRow(
  row: AdminMemberProfileRpcRow,
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

function normalizeAdminMemberRegistrationRow(
  row: AdminMemberRegistrationRpcRow,
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

function normalizeSingleAdminMemberProfile(
  data: AdminMemberProfileRpcRow | AdminMemberProfileRpcRow[] | null,
): AdminMemberProfile {
  const row = Array.isArray(data) ? data[0] : data;

  if (!row) {
    throw new Error("Admin member profile RPC returned an empty result.");
  }

  return normalizeAdminMemberProfileRow(row);
}

function errorText(error: SupabaseRpcError): string {
  return [error.message, error.details, error.hint].filter(Boolean).join(" ");
}

function isRpcNotFoundError(error: SupabaseRpcError): boolean {
  const text = errorText(error).toLowerCase();

  return (
    error.code === "PGRST202" ||
    error.code === "42883" ||
    text.includes("could not find the function") ||
    (text.includes("schema cache") && text.includes("admin_"))
  );
}

function isAccessDeniedError(error: SupabaseRpcError): boolean {
  const text = errorText(error).toLowerCase();

  return (
    error.code === "42501" ||
    text.includes("access denied") ||
    text.includes("permission denied") ||
    text.includes("insufficient privilege")
  );
}

function formatSupabaseError(action: string, error: SupabaseRpcError): string {
  if (isRpcNotFoundError(error)) {
    return ADMIN_MEMBERS_RPC_NOT_FOUND_MESSAGE;
  }

  if (isAccessDeniedError(error)) {
    return ADMIN_MEMBERS_ACCESS_DENIED_MESSAGE;
  }

  const details = errorText(error);
  return `${action} failed: ${details || "Unknown Supabase error"}`;
}

type AdminMemberListPayload = Record<string, string | number>;

function buildListAdminUsersPayload(filters: AdminMemberListFilters): AdminMemberListPayload {
  const payload = {
    communityId: filters.communityId,
    search: filters.search,
    role: filters.role === "all" ? undefined : filters.role,
    status: filters.status === "all" ? undefined : filters.status,
    limit: filters.limit,
    offset: filters.offset,
  } satisfies Record<string, string | number | null | undefined>;

  return Object.fromEntries(
    Object.entries(payload).filter(([, value]) => value !== null && value !== undefined),
  ) as AdminMemberListPayload;
}

type AdminSetUserMembershipPayload = {
  userId: string;
  communityId: string;
  role: AdminMemberMembershipRole;
  status: AdminMemberMembershipStatus;
};

function buildSetUserMembershipPayload(
  input: AdminSetUserMembershipInput,
): AdminSetUserMembershipPayload {
  return {
    userId: input.userId,
    communityId: input.communityId,
    role: input.role,
    status: input.status,
  };
}

export async function listAdminUsers(
  filters: AdminMemberListFilters,
): Promise<AdminMemberListRow[]> {
  const supabase = requireSupabaseClient();
  const payload = buildListAdminUsersPayload(filters);
  const { data, error } = await supabase.rpc("admin_list_users", { payload });

  if (error) {
    throw new Error(formatSupabaseError("List admin users", error));
  }

  return ((data ?? []) as AdminMemberListRpcRow[]).map(normalizeAdminMemberListRow);
}

export async function getAdminUserProfile(
  userId: string,
  communityId: string,
): Promise<AdminMemberProfile> {
  const supabase = requireSupabaseClient();
  const { data, error } = await supabase.rpc("admin_get_user_profile", {
    target_user_id: userId,
    community_id: communityId,
  });

  if (error) {
    throw new Error(formatSupabaseError("Get admin user profile", error));
  }

  return normalizeSingleAdminMemberProfile(
    data as AdminMemberProfileRpcRow | AdminMemberProfileRpcRow[] | null,
  );
}

export async function listAdminUserRegistrations(
  userId: string,
  communityId: string,
): Promise<AdminMemberRegistrationRow[]> {
  const supabase = requireSupabaseClient();
  const { data, error } = await supabase.rpc("admin_list_user_registrations", {
    target_user_id: userId,
    community_id: communityId,
  });

  if (error) {
    throw new Error(formatSupabaseError("List admin user registrations", error));
  }

  return ((data ?? []) as AdminMemberRegistrationRpcRow[]).map(
    normalizeAdminMemberRegistrationRow,
  );
}

export async function setAdminUserMembership(
  input: AdminSetUserMembershipInput,
): Promise<void> {
  const supabase = requireSupabaseClient();
  const payload = buildSetUserMembershipPayload(input);
  const { error } = await supabase.rpc("admin_set_user_membership", { payload });

  if (error) {
    throw new Error(formatSupabaseError("Set admin user membership", error));
  }
}
