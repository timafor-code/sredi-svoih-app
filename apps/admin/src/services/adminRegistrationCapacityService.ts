import { requireSupabaseClient } from "./supabaseClient";
import type {
  AdminRegistrationCapacityBucket,
  AdminRegistrationCapacityBucketRow,
  AdminRegistrationCapacityRegistrationStatusRow,
  AdminRegistrationCapacityReservationRow,
  ListAdminRegistrationCapacityBucketsParams,
} from "../types/registrationCapacity";

type SupabaseSelectError = {
  message?: string;
  details?: string | null;
  hint?: string | null;
};

type CapacityUnitSummary = {
  id: string;
  key: string;
  title: string;
  capacity: number | null;
  sortOrder: number;
  createdAt: string;
};

type ReservationSummary = {
  id: string;
  registrationId: string;
  capacityUnitId: string;
  unitKeySnapshot: string;
  unitTitleSnapshot: string;
  optionTitleSnapshot: string | null;
  seatsCount: number;
  createdAt: string;
};

type MutableCapacityBucket = {
  capacityUnitId: string;
  key: string;
  title: string;
  capacity: number | null;
  occupiedSeats: number;
  reservationsCount: number;
  optionTitles: Set<string>;
  sortOrder: number;
  createdAt: string;
};

const ACTIVE_CAPACITY_REGISTRATION_STATUSES = [
  "confirmed",
  "pending",
  "attended",
  "no_show",
];

const QUERY_PAGE_SIZE = 1000;
const REGISTRATION_STATUS_CHUNK_SIZE = 400;

const CAPACITY_UNIT_FIELDS = `
  id,
  event_id,
  key,
  title,
  description,
  capacity,
  sort_order,
  is_active,
  created_at
`;

const CAPACITY_RESERVATION_FIELDS = `
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

function formatSupabaseError(action: string, error: SupabaseSelectError): string {
  const details = [error.message, error.details, error.hint].filter(Boolean).join(" ");
  return `${action} failed: ${details || "Unknown Supabase error"}`;
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

function uniqueStrings(values: Iterable<string>): string[] {
  return Array.from(new Set(Array.from(values).map((value) => value.trim()))).filter(
    (value) => value.length > 0,
  );
}

function chunkValues<T>(values: T[], size: number): T[][] {
  const chunks: T[][] = [];

  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }

  return chunks;
}

function normalizeCapacityUnitRow(
  row: Partial<AdminRegistrationCapacityBucketRow>,
): CapacityUnitSummary {
  return {
    id: requiredString(row.id, ""),
    key: requiredString(row.key, ""),
    title: requiredString(row.title, ""),
    capacity: nullableNumber(row.capacity),
    sortOrder: safeNumber(row.sort_order, 0),
    createdAt: requiredString(row.created_at, ""),
  };
}

function normalizeReservationRow(
  row: Partial<AdminRegistrationCapacityReservationRow>,
): ReservationSummary | null {
  const registrationId = requiredString(row.registration_id, "");
  const capacityUnitId = requiredString(row.capacity_unit_id, "");

  if (!registrationId || !capacityUnitId) {
    return null;
  }

  return {
    id: requiredString(row.id, ""),
    registrationId,
    capacityUnitId,
    unitKeySnapshot: requiredString(row.capacity_unit_key_snapshot, ""),
    unitTitleSnapshot: requiredString(row.capacity_unit_title_snapshot, ""),
    optionTitleSnapshot: nullableString(row.option_title_snapshot),
    seatsCount: Math.max(0, safeNumber(row.seats_count, 0)),
    createdAt: requiredString(row.created_at, ""),
  };
}

function toCapacityBucket(bucket: MutableCapacityBucket): AdminRegistrationCapacityBucket {
  const safeCapacity = bucket.capacity === null ? null : Math.max(0, bucket.capacity);
  const remainingSeats =
    safeCapacity === null ? null : Math.max(0, safeCapacity - bucket.occupiedSeats);
  const fillPercent =
    safeCapacity !== null && safeCapacity > 0
      ? Math.min(100, Math.round((bucket.occupiedSeats / safeCapacity) * 100))
      : null;

  return {
    capacityUnitId: bucket.capacityUnitId,
    key: bucket.key,
    title: bucket.title,
    capacity: safeCapacity,
    occupiedSeats: bucket.occupiedSeats,
    remainingSeats,
    fillPercent,
    reservationsCount: bucket.reservationsCount,
    optionTitles: uniqueStrings(bucket.optionTitles),
    isUnlimited: safeCapacity === null,
  };
}

async function fetchCapacityUnits(eventId: string): Promise<CapacityUnitSummary[]> {
  const supabase = requireSupabaseClient();
  const { data, error } = await supabase
    .from("event_capacity_units")
    .select(CAPACITY_UNIT_FIELDS)
    .eq("event_id", eventId)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(formatSupabaseError("List registration capacity units", error));
  }

  return ((data ?? []) as AdminRegistrationCapacityBucketRow[])
    .map(normalizeCapacityUnitRow)
    .filter((unit) => unit.id.length > 0);
}

async function fetchCapacityReservations(
  params: ListAdminRegistrationCapacityBucketsParams,
): Promise<ReservationSummary[]> {
  const supabase = requireSupabaseClient();
  const rows: AdminRegistrationCapacityReservationRow[] = [];

  for (let from = 0; ; from += QUERY_PAGE_SIZE) {
    const to = from + QUERY_PAGE_SIZE - 1;
    let query = supabase
      .from("event_registration_capacity_reservations")
      .select(CAPACITY_RESERVATION_FIELDS)
      .eq("event_id", params.eventId)
      .order("created_at", { ascending: true })
      .range(from, to);

    query =
      params.occurrenceId === null
        ? query.is("occurrence_id", null)
        : query.eq("occurrence_id", params.occurrenceId);

    const { data, error } = await query;

    if (error) {
      throw new Error(formatSupabaseError("List registration capacity reservations", error));
    }

    const page = (data ?? []) as AdminRegistrationCapacityReservationRow[];
    rows.push(...page);

    if (page.length < QUERY_PAGE_SIZE) {
      break;
    }
  }

  return rows
    .map(normalizeReservationRow)
    .filter((row): row is ReservationSummary => Boolean(row));
}

async function fetchActiveRegistrationIds(
  eventId: string,
  registrationIds: string[],
): Promise<Set<string>> {
  const uniqueIds = uniqueStrings(registrationIds);

  if (uniqueIds.length === 0) {
    return new Set();
  }

  const supabase = requireSupabaseClient();
  const activeIds = new Set<string>();

  for (const chunk of chunkValues(uniqueIds, REGISTRATION_STATUS_CHUNK_SIZE)) {
    const { data, error } = await supabase
      .from("event_registrations")
      .select("id, status")
      .eq("event_id", eventId)
      .in("id", chunk)
      .in("status", ACTIVE_CAPACITY_REGISTRATION_STATUSES);

    if (error) {
      throw new Error(formatSupabaseError("List active capacity registrations", error));
    }

    ((data ?? []) as AdminRegistrationCapacityRegistrationStatusRow[]).forEach((row) => {
      const registrationId = requiredString(row.id, "");

      if (registrationId) {
        activeIds.add(registrationId);
      }
    });
  }

  return activeIds;
}

export async function listAdminRegistrationCapacityBuckets(
  params: ListAdminRegistrationCapacityBucketsParams,
): Promise<AdminRegistrationCapacityBucket[]> {
  const [capacityUnits, reservations] = await Promise.all([
    fetchCapacityUnits(params.eventId),
    fetchCapacityReservations(params),
  ]);
  const activeRegistrationIds = await fetchActiveRegistrationIds(
    params.eventId,
    reservations.map((reservation) => reservation.registrationId),
  );
  const bucketsByUnitId = new Map<string, MutableCapacityBucket>();

  capacityUnits.forEach((unit) => {
    bucketsByUnitId.set(unit.id, {
      capacityUnitId: unit.id,
      key: unit.key,
      title: unit.title,
      capacity: unit.capacity,
      occupiedSeats: 0,
      reservationsCount: 0,
      optionTitles: new Set(),
      sortOrder: unit.sortOrder,
      createdAt: unit.createdAt,
    });
  });

  reservations.forEach((reservation) => {
    if (!activeRegistrationIds.has(reservation.registrationId)) {
      return;
    }

    const existingBucket = bucketsByUnitId.get(reservation.capacityUnitId);
    const bucket =
      existingBucket ??
      {
        capacityUnitId: reservation.capacityUnitId,
        key: reservation.unitKeySnapshot,
        title: reservation.unitTitleSnapshot,
        capacity: null,
        occupiedSeats: 0,
        reservationsCount: 0,
        optionTitles: new Set<string>(),
        sortOrder: Number.MAX_SAFE_INTEGER,
        createdAt: reservation.createdAt,
      };

    bucket.occupiedSeats += reservation.seatsCount;
    bucket.reservationsCount += 1;

    if (reservation.optionTitleSnapshot) {
      bucket.optionTitles.add(reservation.optionTitleSnapshot);
    }

    if (!existingBucket) {
      bucketsByUnitId.set(reservation.capacityUnitId, bucket);
    }
  });

  return Array.from(bucketsByUnitId.values())
    .sort((left, right) => {
      if (left.sortOrder !== right.sortOrder) {
        return left.sortOrder - right.sortOrder;
      }

      return left.createdAt.localeCompare(right.createdAt) || left.title.localeCompare(right.title);
    })
    .map(toCapacityBucket);
}
