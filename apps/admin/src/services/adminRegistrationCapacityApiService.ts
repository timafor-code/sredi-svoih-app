import { apiClient } from "./apiClient";
import type {
  AdminApiRegistrationCapacityAnalyticsResponse,
  AdminApiRegistrationCapacityBucketOptionBreakdownResponse,
  AdminApiRegistrationCapacityBucketResponse,
  AdminApiRegistrationCapacityOptionStatResponse,
} from "../types/api";
import type {
  AdminRegistrationCapacityAnalytics,
  AdminRegistrationCapacityBucket,
  AdminRegistrationCapacityBucketAggregate,
  AdminRegistrationCapacityBucketOptionBreakdown,
  AdminRegistrationCapacityOptionStat,
  AdminRegistrationCapacityStatusCounts,
  AdminRegistrationCapacityTotals,
  ListAdminRegistrationCapacityBucketsParams,
} from "../types/registrationCapacity";

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

function safeBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => (typeof entry === "string" ? entry.trim() : null))
    .filter((entry): entry is string => Boolean(entry && entry.length > 0));
}

function normalizeStatusCounts(
  value: AdminApiRegistrationCapacityAnalyticsResponse["totals"]["status_counts"],
): AdminRegistrationCapacityStatusCounts {
  return {
    attended: safeNumber(value.attended, 0),
    cancelled: safeNumber(value.cancelled, 0),
    confirmed: safeNumber(value.confirmed, 0),
    no_show: safeNumber(value.no_show, 0),
    pending: safeNumber(value.pending, 0),
    rejected: safeNumber(value.rejected, 0),
    waitlisted: safeNumber(value.waitlisted, 0),
  };
}

function normalizeTotals(
  value: AdminApiRegistrationCapacityAnalyticsResponse["totals"],
): AdminRegistrationCapacityTotals {
  const statusCounts = normalizeStatusCounts(value.status_counts);
  const totalRegistrations = safeNumber(value.total_registrations, 0);

  return {
    totalRegistrations,
    totalRegistrationsCount: safeNumber(
      value.total_registrations_count,
      totalRegistrations,
    ),
    statusCounts,
    confirmedCount: safeNumber(value.confirmed_count, statusCounts.confirmed),
    pendingCount: safeNumber(value.pending_count, statusCounts.pending),
    waitlistedCount: safeNumber(value.waitlisted_count, statusCounts.waitlisted),
    cancelledCount: safeNumber(value.cancelled_count, statusCounts.cancelled),
    rejectedCount: safeNumber(value.rejected_count, statusCounts.rejected),
    attendedCount: safeNumber(value.attended_count, statusCounts.attended),
    noShowCount: safeNumber(value.no_show_count, statusCounts.no_show),
    activeRegistrationsCount: safeNumber(value.active_registrations_count, 0),
    activeSeatsCount: safeNumber(value.active_seats_count, 0),
    uniqueRegisteredUsersCount: safeNumber(value.unique_registered_users_count, 0),
    uniqueGuestsCount: safeNumber(value.unique_guests_count, 0),
    uniquePeopleCount: safeNumber(value.unique_people_count, 0),
    multiMealGuestsCount: safeNumber(value.multi_meal_guests_count, 0),
    sponsorsDonationsCount: safeNumber(value.sponsors_donations_count, 0),
    donationsCount: safeNumber(value.donations_count, 0),
    donationQuantity: safeNumber(value.donation_quantity, 0),
    donationRegistrationsCount: safeNumber(value.donation_registrations_count, 0),
    capacity: nullableNumber(value.capacity),
    remainingSeats: nullableNumber(value.remaining_seats),
    freeSeats: nullableNumber(value.free_seats),
    fillPercent: nullableNumber(value.fill_percent),
    freePercent: nullableNumber(value.free_percent),
  };
}

function normalizeOptionStat(
  value: AdminApiRegistrationCapacityOptionStatResponse,
): AdminRegistrationCapacityOptionStat {
  return {
    optionId: nullableString(value.option_id),
    title: requiredString(value.title, "Option"),
    optionType: requiredString(value.option_type, "participation"),
    registrationsCount: safeNumber(value.registrations_count, 0),
    quantity: safeNumber(value.quantity, 0),
    seatsCount: safeNumber(value.seats_count, 0),
    isDonation: safeBoolean(value.is_donation, false),
    countsTowardCapacity: value.counts_toward_capacity !== false,
  };
}

function normalizeBucketOptionBreakdown(
  value: AdminApiRegistrationCapacityBucketOptionBreakdownResponse,
): AdminRegistrationCapacityBucketOptionBreakdown {
  return {
    optionId: nullableString(value.option_id),
    title: requiredString(value.title, "Option"),
    registrationsCount: safeNumber(value.registrations_count, 0),
    quantity: safeNumber(value.quantity, 0),
    seatsCount: safeNumber(value.seats_count, 0),
    isDonation: safeBoolean(value.is_donation, false),
    countsTowardCapacity: value.counts_toward_capacity !== false,
  };
}

function normalizeCapacityBucket(
  value: AdminApiRegistrationCapacityBucketResponse,
): AdminRegistrationCapacityBucket {
  const capacity = nullableNumber(value.capacity);
  const key = requiredString(value.key ?? value.code, "");

  return {
    capacityUnitId: requiredString(value.capacity_unit_id, ""),
    key,
    code: nullableString(value.code) ?? undefined,
    title: requiredString(value.title, key || "Capacity unit"),
    capacity,
    effectiveCapacity: nullableNumber(value.effective_capacity),
    occupiedSeats: safeNumber(value.occupied_seats, 0),
    remainingSeats: nullableNumber(value.remaining_seats),
    freeSeats: nullableNumber(value.free_seats),
    effectiveRemainingSeats: nullableNumber(value.effective_remaining_seats),
    fillPercent: nullableNumber(value.fill_percent),
    effectiveFillPercent: nullableNumber(value.effective_fill_percent),
    effectiveFreePercent: nullableNumber(value.effective_free_percent),
    reservationsCount: safeNumber(value.reservations_count, 0),
    optionTitles: normalizeStringArray(value.option_titles),
    optionBreakdown: value.option_breakdown.map(normalizeBucketOptionBreakdown),
    isUnlimited: safeBoolean(value.is_unlimited, capacity === null),
    usesFallbackCapacity: safeBoolean(value.uses_fallback_capacity, false),
  };
}

function normalizeBucketAggregate(
  value: AdminApiRegistrationCapacityAnalyticsResponse["bucket_aggregate"],
): AdminRegistrationCapacityBucketAggregate {
  return {
    occupiedSeats: safeNumber(value.occupied_seats, 0),
    knownCapacity: safeNumber(value.known_capacity, 0),
    remainingSeats: safeNumber(value.remaining_seats, 0),
    fillPercent: nullableNumber(value.fill_percent),
    freePercent: nullableNumber(value.free_percent),
    limitedBucketCount: safeNumber(value.limited_bucket_count, 0),
    hasUnlimitedBuckets: safeBoolean(value.has_unlimited_buckets, false),
  };
}

function normalizeAnalytics(
  value: AdminApiRegistrationCapacityAnalyticsResponse,
  params: ListAdminRegistrationCapacityBucketsParams,
): AdminRegistrationCapacityAnalytics {
  return {
    eventId: requiredString(value.event_id, params.eventId),
    occurrenceId: nullableString(value.occurrence_id) ?? params.occurrenceId,
    totals: normalizeTotals(value.totals),
    bucketAggregate: normalizeBucketAggregate(value.bucket_aggregate),
    buckets: value.buckets
      .map(normalizeCapacityBucket)
      .filter((bucket) => bucket.capacityUnitId.length > 0),
    optionStats: value.option_stats.map(normalizeOptionStat),
    donationOptions: value.donation_options.map(normalizeOptionStat),
  };
}

export async function getAdminRegistrationCapacityAnalytics(
  params: ListAdminRegistrationCapacityBucketsParams,
): Promise<AdminRegistrationCapacityAnalytics> {
  const response = await apiClient.get<AdminApiRegistrationCapacityAnalyticsResponse>(
    `/admin/events/${encodeURIComponent(params.eventId)}/registration-capacity`,
    {
      query: {
        occurrence_id: params.occurrenceId ?? undefined,
      },
    },
  );

  return normalizeAnalytics(response, params);
}
