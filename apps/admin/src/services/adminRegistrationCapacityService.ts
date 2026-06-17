import { requireSupabaseClient } from "./supabaseClient";
import type {
  AdminRegistrationCapacityAnalytics,
  AdminRegistrationCapacityAnalyticsRpcRow,
  AdminRegistrationCapacityBucket,
  AdminRegistrationCapacityBucketAggregate,
  AdminRegistrationCapacityBucketOptionBreakdown,
  AdminRegistrationCapacityOptionStat,
  AdminRegistrationCapacityStatusCounts,
  AdminRegistrationCapacityTotals,
  ListAdminRegistrationCapacityBucketsParams,
} from "../types/registrationCapacity";

type SupabaseSelectError = {
  message?: string;
  details?: string | null;
  hint?: string | null;
};

type JsonRecord = Record<string, unknown>;

function formatSupabaseError(action: string, error: SupabaseSelectError): string {
  const details = [error.message, error.details, error.hint].filter(Boolean).join(" ");
  return `${action} failed: ${details || "Unknown Supabase error"}`;
}

function parseJsonish(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }

  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function toRecord(value: unknown): JsonRecord {
  const parsed = parseJsonish(value);
  return isRecord(parsed) ? parsed : {};
}

function toRecordArray(value: unknown): JsonRecord[] {
  const parsed = parseJsonish(value);

  if (!Array.isArray(parsed)) {
    return [];
  }

  return parsed.filter(isRecord);
}

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
  const parsed = parseJsonish(value);

  if (!Array.isArray(parsed)) {
    return [];
  }

  return Array.from(
    new Set(
      parsed
        .map((entry) => (typeof entry === "string" ? entry.trim() : null))
        .filter((entry): entry is string => Boolean(entry && entry.length > 0)),
    ),
  );
}

function normalizeStatusCounts(
  totals: JsonRecord,
): AdminRegistrationCapacityStatusCounts {
  const statusCounts = toRecord(totals.statusCounts ?? totals.status_counts);

  return {
    confirmed: safeNumber(statusCounts.confirmed ?? totals.confirmedCount, 0),
    pending: safeNumber(statusCounts.pending ?? totals.pendingCount, 0),
    waitlisted: safeNumber(statusCounts.waitlisted ?? totals.waitlistedCount, 0),
    cancelled: safeNumber(statusCounts.cancelled ?? totals.cancelledCount, 0),
    rejected: safeNumber(statusCounts.rejected ?? totals.rejectedCount, 0),
    attended: safeNumber(statusCounts.attended ?? totals.attendedCount, 0),
    no_show: safeNumber(statusCounts.no_show ?? totals.noShowCount, 0),
  };
}

function normalizeTotals(value: unknown): AdminRegistrationCapacityTotals {
  const totals = toRecord(value);
  const statusCounts = normalizeStatusCounts(totals);
  const totalRegistrations = safeNumber(
    totals.totalRegistrations ?? totals.totalRegistrationsCount,
    0,
  );

  return {
    totalRegistrations,
    totalRegistrationsCount: safeNumber(totals.totalRegistrationsCount, totalRegistrations),
    statusCounts,
    confirmedCount: safeNumber(totals.confirmedCount, statusCounts.confirmed),
    pendingCount: safeNumber(totals.pendingCount, statusCounts.pending),
    waitlistedCount: safeNumber(totals.waitlistedCount, statusCounts.waitlisted),
    cancelledCount: safeNumber(totals.cancelledCount, statusCounts.cancelled),
    rejectedCount: safeNumber(totals.rejectedCount, statusCounts.rejected),
    attendedCount: safeNumber(totals.attendedCount, statusCounts.attended),
    noShowCount: safeNumber(totals.noShowCount, statusCounts.no_show),
    activeRegistrationsCount: safeNumber(totals.activeRegistrationsCount, 0),
    activeSeatsCount: safeNumber(totals.activeSeatsCount, 0),
    uniqueRegisteredUsersCount: safeNumber(totals.uniqueRegisteredUsersCount, 0),
    uniqueGuestsCount: safeNumber(totals.uniqueGuestsCount, 0),
    uniquePeopleCount: safeNumber(totals.uniquePeopleCount, 0),
    multiMealGuestsCount: safeNumber(totals.multiMealGuestsCount, 0),
    sponsorsDonationsCount: safeNumber(totals.sponsorsDonationsCount, 0),
    donationsCount: safeNumber(totals.donationsCount, 0),
    donationQuantity: safeNumber(totals.donationQuantity, 0),
    donationRegistrationsCount: safeNumber(totals.donationRegistrationsCount, 0),
    capacity: nullableNumber(totals.capacity),
    remainingSeats: nullableNumber(totals.remainingSeats),
    freeSeats: nullableNumber(totals.freeSeats),
    fillPercent: nullableNumber(totals.fillPercent),
    freePercent: nullableNumber(totals.freePercent),
  };
}

function normalizeOptionStat(value: JsonRecord): AdminRegistrationCapacityOptionStat {
  return {
    optionId: nullableString(value.optionId ?? value.option_id),
    title: requiredString(value.title, "Option"),
    optionType: requiredString(value.optionType ?? value.option_type, "participation"),
    registrationsCount: safeNumber(value.registrationsCount ?? value.registrations_count, 0),
    quantity: safeNumber(value.quantity, 0),
    seatsCount: safeNumber(value.seatsCount ?? value.seats_count, 0),
    isDonation: safeBoolean(value.isDonation ?? value.is_donation, false),
    countsTowardCapacity: (value.countsTowardCapacity ?? value.counts_toward_capacity) !== false,
  };
}

function normalizeOptionStats(value: unknown): AdminRegistrationCapacityOptionStat[] {
  return toRecordArray(value).map(normalizeOptionStat);
}

function normalizeBucketOptionBreakdown(
  value: JsonRecord,
): AdminRegistrationCapacityBucketOptionBreakdown {
  return {
    optionId: nullableString(value.optionId ?? value.option_id),
    title: requiredString(value.title, "Option"),
    registrationsCount: safeNumber(value.registrationsCount ?? value.registrations_count, 0),
    quantity: safeNumber(value.quantity, 0),
    seatsCount: safeNumber(value.seatsCount ?? value.seats_count, 0),
    isDonation: safeBoolean(value.isDonation ?? value.is_donation, false),
    countsTowardCapacity: (value.countsTowardCapacity ?? value.counts_toward_capacity) !== false,
  };
}

function normalizeCapacityBucket(value: JsonRecord): AdminRegistrationCapacityBucket {
  const capacity = nullableNumber(value.capacity);
  const key = requiredString(value.key ?? value.code, "");
  const title = requiredString(value.title, key || "Capacity unit");

  return {
    capacityUnitId: requiredString(value.capacityUnitId ?? value.capacity_unit_id, ""),
    key,
    code: nullableString(value.code) ?? undefined,
    title,
    capacity,
    effectiveCapacity: nullableNumber(value.effectiveCapacity ?? value.effective_capacity),
    occupiedSeats: safeNumber(value.occupiedSeats ?? value.occupied_seats, 0),
    remainingSeats: nullableNumber(value.remainingSeats ?? value.remaining_seats),
    freeSeats: nullableNumber(value.freeSeats ?? value.free_seats),
    effectiveRemainingSeats: nullableNumber(
      value.effectiveRemainingSeats ?? value.effective_remaining_seats,
    ),
    fillPercent: nullableNumber(value.fillPercent ?? value.fill_percent),
    effectiveFillPercent: nullableNumber(value.effectiveFillPercent ?? value.effective_fill_percent),
    effectiveFreePercent: nullableNumber(value.effectiveFreePercent ?? value.effective_free_percent),
    reservationsCount: safeNumber(value.reservationsCount ?? value.reservations_count, 0),
    optionTitles: normalizeStringArray(value.optionTitles ?? value.option_titles),
    optionBreakdown: toRecordArray(value.optionBreakdown ?? value.option_breakdown).map(
      normalizeBucketOptionBreakdown,
    ),
    isUnlimited: safeBoolean(value.isUnlimited ?? value.is_unlimited, capacity === null),
    usesFallbackCapacity: safeBoolean(
      value.usesFallbackCapacity ?? value.uses_fallback_capacity,
      false,
    ),
  };
}

function normalizeCapacityBuckets(value: unknown): AdminRegistrationCapacityBucket[] {
  return toRecordArray(value)
    .map(normalizeCapacityBucket)
    .filter((bucket) => bucket.capacityUnitId.length > 0);
}

function normalizeBucketAggregate(
  value: unknown,
): AdminRegistrationCapacityBucketAggregate {
  const aggregate = toRecord(value);

  return {
    occupiedSeats: safeNumber(aggregate.occupiedSeats ?? aggregate.occupied_seats, 0),
    knownCapacity: safeNumber(aggregate.knownCapacity ?? aggregate.known_capacity, 0),
    remainingSeats: safeNumber(aggregate.remainingSeats ?? aggregate.remaining_seats, 0),
    fillPercent: nullableNumber(aggregate.fillPercent ?? aggregate.fill_percent),
    freePercent: nullableNumber(aggregate.freePercent ?? aggregate.free_percent),
    limitedBucketCount: safeNumber(
      aggregate.limitedBucketCount ?? aggregate.limited_bucket_count,
      0,
    ),
    hasUnlimitedBuckets: safeBoolean(
      aggregate.hasUnlimitedBuckets ?? aggregate.has_unlimited_buckets,
      false,
    ),
  };
}

function normalizeAnalyticsRow(
  row: Partial<AdminRegistrationCapacityAnalyticsRpcRow>,
  params: ListAdminRegistrationCapacityBucketsParams,
): AdminRegistrationCapacityAnalytics {
  return {
    eventId: requiredString(row.event_id, params.eventId),
    occurrenceId: nullableString(row.occurrence_id) ?? params.occurrenceId,
    totals: normalizeTotals(row.totals),
    bucketAggregate: normalizeBucketAggregate(row.bucket_aggregate),
    buckets: normalizeCapacityBuckets(row.buckets),
    optionStats: normalizeOptionStats(row.option_stats),
    donationOptions: normalizeOptionStats(row.donation_options),
  };
}

export async function getAdminRegistrationCapacityAnalytics(
  params: ListAdminRegistrationCapacityBucketsParams,
): Promise<AdminRegistrationCapacityAnalytics> {
  const supabase = requireSupabaseClient();
  const { data, error } = await supabase.rpc("admin_get_registration_capacity_analytics", {
    p_event_id: params.eventId,
    p_occurrence_id: params.occurrenceId,
  });

  if (error) {
    throw new Error(formatSupabaseError("Get registration capacity analytics", error));
  }

  const rows = Array.isArray(data) ? data : data ? [data] : [];
  const row = rows[0] as Partial<AdminRegistrationCapacityAnalyticsRpcRow> | undefined;

  if (!row) {
    throw new Error("Get registration capacity analytics failed: RPC returned no rows.");
  }

  return normalizeAnalyticsRow(row, params);
}

export async function listAdminRegistrationCapacityBuckets(
  params: ListAdminRegistrationCapacityBucketsParams,
): Promise<AdminRegistrationCapacityBucket[]> {
  const analytics = await getAdminRegistrationCapacityAnalytics(params);
  return analytics.buckets;
}
