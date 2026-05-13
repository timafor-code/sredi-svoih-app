import { requireSupabaseClient } from "./supabaseClient";
import type {
  AdminEvent,
  AdminEventMutationInput,
  AdminEventRow,
  CreateAdminEventInput,
  UpdateAdminEventInput,
} from "../types/events";
import type {
  AdminEventRegistrationRow,
  AdminEventRegistrationRpcRow,
  AdminRegistrationAttendanceStatus,
  AdminRegistrationEventSummary,
  AdminRegistrationEventSummaryRpcRow,
  AdminRegistrationOptionSelectionSummary,
  AdminRegistrationStatusUpdate,
  ListEventRegistrationsParams,
} from "../types/registrations";

type SupabaseSelectError = {
  code?: string;
  message?: string;
  details?: string | null;
  hint?: string | null;
};

const ADMIN_EVENT_FIELDS = `
  id,
  community_id,
  event_kind,
  title,
  subtitle,
  description,
  short_description,
  starts_at,
  ends_at,
  is_permanent,
  timezone,
  location_name,
  address,
  image_url,
  category,
  audience,
  visibility,
  status,
  source_type,
  source_url,
  source_external_id,
  manual_override,
  registration_mode,
  registration_url,
  capacity,
  waitlist_enabled,
  requires_approval,
  price_amount,
  price_currency,
  created_at,
  updated_at,
  published_at
`;

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

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => (typeof entry === "string" ? entry.trim() : null))
    .filter((entry): entry is string => Boolean(entry && entry.length > 0));
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

function normalizeSelectedOptions(
  value: unknown,
): AdminRegistrationOptionSelectionSummary[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map(normalizeSelectionValue)
    .filter((entry): entry is AdminRegistrationOptionSelectionSummary => Boolean(entry));
}

export function normalizeAdminEventRow(row: Partial<AdminEventRow>): AdminEvent {
  return {
    id: requiredString(row.id, ""),
    communityId: requiredString(row.community_id, ""),
    eventKind: requiredString(row.event_kind, "single"),
    title: requiredString(row.title, "Без названия"),
    subtitle: nullableString(row.subtitle),
    description: nullableString(row.description),
    shortDescription: nullableString(row.short_description),
    startsAt: nullableString(row.starts_at),
    endsAt: nullableString(row.ends_at),
    isPermanent: row.is_permanent === true,
    timezone: nullableString(row.timezone),
    locationName: nullableString(row.location_name),
    address: nullableString(row.address),
    imageUrl: nullableString(row.image_url),
    category: nullableString(row.category),
    audience: nullableString(row.audience),
    visibility: requiredString(row.visibility, "public"),
    status: requiredString(row.status, "draft"),
    sourceType: requiredString(row.source_type, "manual"),
    sourceUrl: nullableString(row.source_url),
    sourceExternalId: nullableString(row.source_external_id),
    manualOverride: row.manual_override === true,
    registrationMode: requiredString(row.registration_mode, "none"),
    registrationUrl: nullableString(row.registration_url),
    capacity: nullableNumber(row.capacity),
    waitlistEnabled: row.waitlist_enabled === true,
    requiresApproval: row.requires_approval === true,
    priceAmount: nullableNumber(row.price_amount),
    priceCurrency: nullableString(row.price_currency),
    createdAt: requiredString(row.created_at, ""),
    updatedAt: requiredString(row.updated_at, ""),
    publishedAt: nullableString(row.published_at),
  };
}

export function normalizeRegistrationEventSummaryRow(
  row: Partial<AdminRegistrationEventSummaryRpcRow>,
): AdminRegistrationEventSummary {
  return {
    eventId: requiredString(row.event_id, ""),
    title: requiredString(row.title, "Untitled event"),
    startsAt: nullableString(row.starts_at),
    eventKind: requiredString(row.event_kind, "single"),
    registrationMode: requiredString(row.registration_mode, "none"),
    occurrenceCount: safeNumber(row.occurrence_count, 0),
    confirmedCount: safeNumber(row.confirmed_count, 0),
    pendingCount: safeNumber(row.pending_count, 0),
    waitlistedCount: safeNumber(row.waitlisted_count, 0),
    cancelledCount: safeNumber(row.cancelled_count, 0),
    rejectedCount: safeNumber(row.rejected_count, 0),
    attendedCount: safeNumber(row.attended_count, 0),
    noShowCount: safeNumber(row.no_show_count, 0),
  };
}

export function normalizeEventRegistrationRow(
  row: Partial<AdminEventRegistrationRpcRow>,
): AdminEventRegistrationRow {
  return {
    id: requiredString(row.id, ""),
    eventId: requiredString(row.event_id, ""),
    occurrenceId: nullableString(row.occurrence_id),
    userId: requiredString(row.user_id, ""),
    participantDisplayName: requiredString(row.participant_display_name, "Participant"),
    email: nullableString(row.email),
    phone: nullableString(row.phone),
    status: requiredString(row.status, "pending"),
    seatsCount: safeNumber(row.seats_count, 1),
    guestNames: normalizeStringArray(row.guest_names),
    comment: nullableString(row.comment),
    paymentStatus: requiredString(row.payment_status, "not_required"),
    paymentId: nullableString(row.payment_id),
    registeredAt: requiredString(row.registered_at, ""),
    confirmedAt: nullableString(row.confirmed_at),
    cancelledAt: nullableString(row.cancelled_at),
    occurrenceStartsAt: nullableString(row.occurrence_starts_at),
    occurrenceEndsAt: nullableString(row.occurrence_ends_at),
    occurrenceTitle: nullableString(row.occurrence_title),
    selectedOptions: normalizeSelectedOptions(row.selected_options),
    totalAmount: nullableNumber(row.total_amount),
    createdAt: requiredString(row.created_at, ""),
    updatedAt: requiredString(row.updated_at, ""),
  };
}

function normalizeSingleAdminEvent(
  data: Partial<AdminEventRow> | Partial<AdminEventRow>[] | null,
): AdminEvent {
  const row = Array.isArray(data) ? data[0] : data;

  if (!row) {
    throw new Error("Admin event RPC returned an empty result.");
  }

  return normalizeAdminEventRow(row);
}

function normalizeSingleEventRegistration(
  data:
    | Partial<AdminEventRegistrationRpcRow>
    | Partial<AdminEventRegistrationRpcRow>[]
    | null,
): AdminEventRegistrationRow {
  const row = Array.isArray(data) ? data[0] : data;

  if (!row) {
    throw new Error("Admin registration RPC returned an empty result.");
  }

  return normalizeEventRegistrationRow(row);
}

function formatSupabaseError(action: string, error: SupabaseSelectError): string {
  const details = [error.message, error.details, error.hint].filter(Boolean).join(" ");
  return `${action} failed: ${details || "Unknown Supabase error"}`;
}

export async function listAdminEvents(): Promise<AdminEvent[]> {
  const supabase = requireSupabaseClient();
  const { data, error } = await supabase
    .from("events")
    .select(ADMIN_EVENT_FIELDS)
    .order("starts_at", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(formatSupabaseError("List admin events", error));
  }

  return ((data ?? []) as AdminEventRow[]).map(normalizeAdminEventRow);
}

export async function listRegistrationEvents(): Promise<AdminRegistrationEventSummary[]> {
  const supabase = requireSupabaseClient();
  const { data, error } = await supabase.rpc("admin_list_registration_events");

  if (error) {
    throw new Error(formatSupabaseError("List registration events", error));
  }

  return ((data ?? []) as AdminRegistrationEventSummaryRpcRow[]).map(
    normalizeRegistrationEventSummaryRow,
  );
}

export async function listEventRegistrations(
  params: ListEventRegistrationsParams,
): Promise<AdminEventRegistrationRow[]> {
  const supabase = requireSupabaseClient();
  const payload = buildListEventRegistrationsPayload(params);
  const { data, error } = await supabase.rpc("admin_list_event_registrations", {
    payload,
  });

  if (error) {
    throw new Error(formatSupabaseError("List event registrations", error));
  }

  return ((data ?? []) as AdminEventRegistrationRpcRow[]).map(normalizeEventRegistrationRow);
}

export async function updateRegistrationStatus(
  registrationId: string,
  nextStatus: AdminRegistrationStatusUpdate,
  reason?: string | null,
): Promise<AdminEventRegistrationRow> {
  const supabase = requireSupabaseClient();
  const { data, error } = await supabase.rpc("admin_update_registration_status", {
    registration_id: registrationId,
    next_status: nextStatus,
    reason: reason ?? null,
  });

  if (error) {
    throw new Error(formatSupabaseError("Update registration status", error));
  }

  return normalizeSingleEventRegistration(
    data as Partial<AdminEventRegistrationRpcRow> | Partial<AdminEventRegistrationRpcRow>[] | null,
  );
}

export async function markRegistrationAttendance(
  registrationId: string,
  attendanceStatus: AdminRegistrationAttendanceStatus,
): Promise<AdminEventRegistrationRow> {
  const supabase = requireSupabaseClient();
  const { data, error } = await supabase.rpc("admin_mark_registration_attendance", {
    registration_id: registrationId,
    attendance_status: attendanceStatus,
  });

  if (error) {
    throw new Error(formatSupabaseError("Mark registration attendance", error));
  }

  return normalizeSingleEventRegistration(
    data as Partial<AdminEventRegistrationRpcRow> | Partial<AdminEventRegistrationRpcRow>[] | null,
  );
}

export async function createAdminEvent(input: CreateAdminEventInput): Promise<AdminEvent> {
  const supabase = requireSupabaseClient();
  const payload = {
    communityId: input.communityId,
    ...buildAdminEventMutationPayload(input),
  };

  const { data, error } = await supabase.rpc("admin_create_event", { payload });

  if (error) {
    throw new Error(formatSupabaseError("Create admin event", error));
  }

  return normalizeSingleAdminEvent(data as Partial<AdminEventRow> | Partial<AdminEventRow>[] | null);
}

export async function updateAdminEvent(
  eventId: string,
  input: UpdateAdminEventInput,
): Promise<AdminEvent> {
  const supabase = requireSupabaseClient();
  const payload = buildAdminEventMutationPayload(input);
  const { data, error } = await supabase.rpc("admin_update_event", {
    event_id: eventId,
    payload,
  });

  if (error) {
    throw new Error(formatSupabaseError("Update admin event", error));
  }

  return normalizeSingleAdminEvent(data as Partial<AdminEventRow> | Partial<AdminEventRow>[] | null);
}

export async function deleteAdminEvent(eventId: string): Promise<AdminEvent> {
  const supabase = requireSupabaseClient();
  const { data, error } = await supabase.rpc("admin_delete_event", {
    event_id: eventId,
  });

  if (error) {
    if (
      error.code === "PGRST202" ||
      error.message?.includes("public.admin_delete_event")
    ) {
      throw new Error(
        "RPC admin_delete_event не найдена в Supabase. Примените миграцию 20260513120000_admin_delete_event_rpc.sql к базе, к которой подключена админка, и повторите удаление.",
      );
    }

    throw new Error(formatSupabaseError("Delete admin event", error));
  }

  return normalizeSingleAdminEvent(data as Partial<AdminEventRow> | Partial<AdminEventRow>[] | null);
}

type ListEventRegistrationsPayload = Record<string, string | number>;

function buildListEventRegistrationsPayload(
  params: ListEventRegistrationsParams,
): ListEventRegistrationsPayload {
  const payload = {
    eventId: params.eventId,
    occurrenceId: params.occurrenceId,
    status: params.status,
    search: params.search,
    limit: params.limit,
    offset: params.offset,
  } satisfies Record<string, string | number | null | undefined>;

  return Object.fromEntries(
    Object.entries(payload).filter(([, value]) => value !== null && value !== undefined),
  ) as ListEventRegistrationsPayload;
}

type AdminEventMutationPayload = Record<string, string | number | boolean | null>;

function buildAdminEventMutationPayload(
  input: Partial<AdminEventMutationInput>,
): AdminEventMutationPayload {
  const payload = {
    title: input.title,
    eventKind: input.eventKind,
    subtitle: input.subtitle,
    shortDescription: input.shortDescription,
    description: input.description,
    startsAt: input.startsAt,
    endsAt: input.endsAt,
    isPermanent: input.isPermanent,
    timezone: input.timezone,
    locationName: input.locationName,
    address: input.address,
    imageUrl: input.imageUrl,
    category: input.category,
    audience: input.audience,
    visibility: input.visibility,
    status: input.status,
    registrationMode: input.registrationMode,
    registrationUrl: input.registrationUrl,
    capacity: input.capacity,
    waitlistEnabled: input.waitlistEnabled,
    requiresApproval: input.requiresApproval,
    priceAmount: input.priceAmount,
    priceCurrency: input.priceCurrency,
  } satisfies Record<string, string | number | boolean | null | undefined>;

  return Object.fromEntries(
    Object.entries(payload).filter(([, value]) => value !== undefined),
  ) as AdminEventMutationPayload;
}
