import { requireSupabaseClient } from "./supabaseClient";
import { listEventRegistrations } from "./adminEventsService";
import type {
  AdminRegistrationCapacityAnalytics,
  AdminRegistrationCapacityAnalyticsRpcRow,
  AdminRegistrationCapacityBucket,
  AdminRegistrationCapacityBucketAggregate,
  AdminRegistrationCapacityBucketOptionBreakdown,
  AdminRegistrationCapacityOptionStat,
  AdminRegistrationCapacityReservation,
  AdminRegistrationCapacityReservationRow,
  AdminRegistrationCapacityStatusCounts,
  AdminRegistrationCapacityTotals,
  GetAdminRegistrationCapacityGuestPoolParams,
  ListAdminRegistrationCapacityBucketsParams,
  ListAdminRegistrationCapacityReservationsParams,
} from "../types/registrationCapacity";
import type {
  AdminEventRegistrationRow,
  AdminRegistrationStatus,
} from "../types/registrations";
import type { SeatingGuestPoolItem } from "../types/seating";

type SupabaseSelectError = {
  message?: string;
  details?: string | null;
  hint?: string | null;
};

type JsonRecord = Record<string, unknown>;

type OptionCapacityUnitMappingRowForGuestPool = {
  option_id: string | null;
  capacity_unit_id: string | null;
  seats_per_quantity: number | string | null;
};

type RegistrationSeatObligation = {
  optionTitles: string[];
  seatsCount: number;
};

const REGISTRATION_CAPACITY_RESERVATION_FIELDS = `
  id,
  registration_id,
  event_id,
  occurrence_id,
  capacity_unit_id,
  option_id,
  capacity_unit_key_snapshot,
  capacity_unit_title_snapshot,
  option_title_snapshot,
  quantity,
  seats_per_quantity,
  seats_count,
  created_at
`;

const OPTION_CAPACITY_UNIT_MAPPING_FIELDS_FOR_GUEST_POOL = `
  option_id,
  capacity_unit_id,
  seats_per_quantity
`;

const REGISTRATION_GUEST_POOL_PAGE_SIZE = 200;
const SEATING_GUEST_POOL_STATUSES = [
  "confirmed",
  "pending",
  "attended",
] as const satisfies readonly AdminRegistrationStatus[];

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

function normalizeCapacityReservation(
  row: Partial<AdminRegistrationCapacityReservationRow>,
): AdminRegistrationCapacityReservation {
  return {
    id: requiredString(row.id, ""),
    registrationId: requiredString(row.registration_id, ""),
    eventId: requiredString(row.event_id, ""),
    occurrenceId: nullableString(row.occurrence_id),
    capacityUnitId: requiredString(row.capacity_unit_id, ""),
    optionId: nullableString(row.option_id),
    capacityUnitKeySnapshot: requiredString(row.capacity_unit_key_snapshot, ""),
    capacityUnitTitleSnapshot: requiredString(row.capacity_unit_title_snapshot, ""),
    optionTitleSnapshot: nullableString(row.option_title_snapshot),
    quantity: safeNumber(row.quantity, 0),
    seatsPerQuantity: safeNumber(row.seats_per_quantity, 1),
    seatsCount: safeNumber(row.seats_count, 0),
    createdAt: requiredString(row.created_at, ""),
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

export async function listAdminRegistrationCapacityReservations(
  params: ListAdminRegistrationCapacityReservationsParams,
): Promise<AdminRegistrationCapacityReservation[]> {
  const supabase = requireSupabaseClient();
  let query = supabase
    .from("event_registration_capacity_reservations")
    .select(REGISTRATION_CAPACITY_RESERVATION_FIELDS)
    .eq("event_id", params.eventId)
    .eq("capacity_unit_id", params.capacityUnitId);

  query = params.occurrenceId
    ? query.eq("occurrence_id", params.occurrenceId)
    : query.is("occurrence_id", null);

  const { data, error } = await query.order("created_at", { ascending: true });

  if (error) {
    throw new Error(formatSupabaseError("List registration capacity reservations", error));
  }

  return ((data ?? []) as AdminRegistrationCapacityReservationRow[])
    .map(normalizeCapacityReservation)
    .filter(
      (reservation) =>
        reservation.registrationId.length > 0 &&
        reservation.capacityUnitId === params.capacityUnitId,
    );
}

export async function getAdminRegistrationCapacityGuestPool(
  params: GetAdminRegistrationCapacityGuestPoolParams,
): Promise<SeatingGuestPoolItem[]> {
  const [registrations, reservations, optionMappings] = await Promise.all([
    listActiveRegistrationsForGuestPool(params),
    listAdminRegistrationCapacityReservations(params),
    listOptionCapacityUnitMappingsForGuestPool(params),
  ]);
  const obligations = buildRegistrationSeatObligations({
    capacityUnitId: params.capacityUnitId,
    optionMappings,
    registrations,
    reservations,
  });

  return buildSeatingGuestPool({
    obligations,
    params,
    registrations,
  });
}

async function listActiveRegistrationsForGuestPool(
  params: ListAdminRegistrationCapacityBucketsParams,
): Promise<AdminEventRegistrationRow[]> {
  const pagesByStatus = await Promise.all(
    SEATING_GUEST_POOL_STATUSES.map((status) =>
      listRegistrationsForGuestPoolStatus(params, status),
    ),
  );
  const byId = new Map<string, AdminEventRegistrationRow>();

  pagesByStatus.flat().forEach((registration) => {
    if (registration.id) {
      byId.set(registration.id, registration);
    }
  });

  return Array.from(byId.values()).sort(compareRegistrationsForGuestPool);
}

async function listRegistrationsForGuestPoolStatus(
  params: ListAdminRegistrationCapacityBucketsParams,
  status: AdminRegistrationStatus,
): Promise<AdminEventRegistrationRow[]> {
  const registrations: AdminEventRegistrationRow[] = [];
  let offset = 0;

  while (true) {
    const page = await listEventRegistrations({
      eventId: params.eventId,
      limit: REGISTRATION_GUEST_POOL_PAGE_SIZE,
      occurrenceId: params.occurrenceId,
      offset,
      search: null,
      status,
    });

    registrations.push(...page);

    if (page.length < REGISTRATION_GUEST_POOL_PAGE_SIZE) {
      break;
    }

    offset += page.length;
  }

  return registrations;
}

async function listOptionCapacityUnitMappingsForGuestPool(
  params: GetAdminRegistrationCapacityGuestPoolParams,
): Promise<OptionCapacityUnitMappingRowForGuestPool[]> {
  const supabase = requireSupabaseClient();
  const { data, error } = await supabase
    .from("event_participation_option_capacity_units")
    .select(OPTION_CAPACITY_UNIT_MAPPING_FIELDS_FOR_GUEST_POOL)
    .eq("event_id", params.eventId)
    .eq("capacity_unit_id", params.capacityUnitId);

  if (error) {
    throw new Error(formatSupabaseError("List option capacity unit mappings", error));
  }

  return ((data ?? []) as OptionCapacityUnitMappingRowForGuestPool[]).filter(
    (row) => Boolean(row.option_id && row.capacity_unit_id === params.capacityUnitId),
  );
}

function buildRegistrationSeatObligations({
  capacityUnitId,
  optionMappings,
  registrations,
  reservations,
}: {
  capacityUnitId: string;
  optionMappings: OptionCapacityUnitMappingRowForGuestPool[];
  registrations: AdminEventRegistrationRow[];
  reservations: AdminRegistrationCapacityReservation[];
}): Map<string, RegistrationSeatObligation> {
  const obligations = new Map<string, RegistrationSeatObligation>();
  const realReservationKeys = new Set<string>();
  const mappingByOptionId = new Map(
    optionMappings
      .map((mapping) => {
        const optionId = nullableString(mapping.option_id);
        return optionId ? [optionId, mapping] as const : null;
      })
      .filter((entry): entry is readonly [string, OptionCapacityUnitMappingRowForGuestPool] =>
        Boolean(entry),
      ),
  );

  reservations.forEach((reservation) => {
    if (reservation.capacityUnitId !== capacityUnitId) {
      return;
    }

    addSeatObligation(
      obligations,
      reservation.registrationId,
      reservation.seatsCount,
      reservation.optionTitleSnapshot,
    );
    realReservationKeys.add(
      registrationOptionKey(reservation.registrationId, reservation.optionId),
    );
  });

  registrations.forEach((registration) => {
    registration.selectedOptions.forEach((option) => {
      const optionId = option.optionId;

      if (
        !optionId ||
        option.isDonation ||
        option.countsTowardCapacity === false ||
        realReservationKeys.has(registrationOptionKey(registration.id, optionId))
      ) {
        return;
      }

      const mapping = mappingByOptionId.get(optionId);

      if (!mapping) {
        return;
      }

      addSeatObligation(
        obligations,
        registration.id,
        option.quantity * Math.max(1, safeNumber(mapping.seats_per_quantity, 1)),
        option.title,
      );
    });
  });

  return obligations;
}

function buildSeatingGuestPool({
  obligations,
  params,
  registrations,
}: {
  obligations: Map<string, RegistrationSeatObligation>;
  params: GetAdminRegistrationCapacityGuestPoolParams;
  registrations: AdminEventRegistrationRow[];
}): SeatingGuestPoolItem[] {
  return registrations.flatMap((registration) => {
    const obligation = obligations.get(registration.id);
    const seatsCount = Math.max(0, Math.floor(obligation?.seatsCount ?? 0));

    if (seatsCount === 0) {
      return [];
    }

    const participantName = safeDisplayName(registration.participantDisplayName, "Участник");
    const optionTitles = obligation?.optionTitles ?? [];
    const items: SeatingGuestPoolItem[] = [
      {
        capacityUnitId: params.capacityUnitId,
        displayName: participantName,
        email: registration.email,
        guestIndex: null,
        guestName: null,
        id: seatingGuestPoolKey(registration.id, "participant", 0, params.capacityUnitId),
        initials: seatInitials(participantName),
        key: seatingGuestPoolKey(registration.id, "participant", 0, params.capacityUnitId),
        occurrenceId: params.occurrenceId,
        optionTitles,
        participantDisplayName: participantName,
        participantUserId: registration.userId || null,
        paymentStatus: registration.paymentStatus,
        phone: registration.phone,
        registrationId: registration.id,
        source: "participant",
        sourceLabel: "Участник",
        status: registration.status,
      },
    ];
    const guestNames = normalizeGuestNames(registration.guestNames);

    for (let index = 0; index < seatsCount - 1; index += 1) {
      const guestIndex = index + 1;
      const guestName = guestNames[index] ?? null;
      const displayName =
        guestName ?? `Гость ${guestIndex} · ${participantName}`;

      items.push({
        capacityUnitId: params.capacityUnitId,
        displayName,
        email: registration.email,
        guestIndex,
        guestName,
        id: seatingGuestPoolKey(registration.id, "guest", guestIndex, params.capacityUnitId),
        initials: seatInitials(guestName ?? `Гость ${guestIndex}`),
        key: seatingGuestPoolKey(registration.id, "guest", guestIndex, params.capacityUnitId),
        occurrenceId: params.occurrenceId,
        optionTitles,
        participantDisplayName: participantName,
        participantUserId: registration.userId || null,
        paymentStatus: registration.paymentStatus,
        phone: registration.phone,
        registrationId: registration.id,
        source: "guest",
        sourceLabel: "Гость",
        status: registration.status,
      });
    }

    return items;
  });
}

function addSeatObligation(
  obligations: Map<string, RegistrationSeatObligation>,
  registrationId: string,
  seatsCount: number,
  optionTitle: string | null,
) {
  if (!registrationId || seatsCount <= 0) {
    return;
  }

  const current = obligations.get(registrationId) ?? {
    optionTitles: [],
    seatsCount: 0,
  };
  const title = optionTitle?.trim();

  obligations.set(registrationId, {
    optionTitles:
      title && !current.optionTitles.includes(title)
        ? [...current.optionTitles, title]
        : current.optionTitles,
    seatsCount: current.seatsCount + Math.floor(seatsCount),
  });
}

function compareRegistrationsForGuestPool(
  left: AdminEventRegistrationRow,
  right: AdminEventRegistrationRow,
): number {
  const leftTime = new Date(left.registeredAt || left.createdAt).getTime();
  const rightTime = new Date(right.registeredAt || right.createdAt).getTime();

  if (Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime !== rightTime) {
    return rightTime - leftTime;
  }

  return left.id.localeCompare(right.id);
}

function normalizeGuestNames(guestNames: string[]): string[] {
  return guestNames
    .map((guestName) => guestName.trim())
    .filter((guestName) => guestName.length > 0);
}

function registrationOptionKey(registrationId: string, optionId: string | null): string {
  return `${registrationId}:${optionId ?? ""}`;
}

function safeDisplayName(name: string | null | undefined, fallback: string): string {
  const trimmed = name?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : fallback;
}

export function seatInitials(name: string | null | undefined): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  const initials = parts
    .slice(0, 2)
    .map((part) => Array.from(part)[0]?.toLocaleUpperCase("ru-RU") ?? "")
    .join("");

  return initials || "?";
}

function seatingGuestPoolKey(
  registrationId: string,
  source: "participant" | "guest",
  index: number,
  capacityUnitId: string,
): string {
  return `${registrationId}:${capacityUnitId}:${source}:${index}`;
}
