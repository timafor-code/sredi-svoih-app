import { apiClient } from "./apiClient";
import type {
  AdminApiEventOccurrenceResponse,
  AdminApiEventRegistrationResponse,
  AdminApiEventResponse,
  AdminApiRegistrationSelectedOptionResponse,
  ApiPaginationMeta,
  ApiResponseEnvelope,
} from "../types/api";
import type {
  AdminEventRegistrationRow,
  AdminRegistrationAttendanceStatus,
  AdminRegistrationEventSummary,
  AdminRegistrationOptionSelectionSummary,
  AdminRegistrationStatus,
  AdminRegistrationStatusUpdate,
  ListEventRegistrationsParams,
} from "../types/registrations";

const ADMIN_EVENTS_PAGE_LIMIT = 100;
const ADMIN_REGISTRATION_SUMMARY_PAGE_LIMIT = 200;

const STATUS_ACTION_PATHS: Partial<Record<AdminRegistrationStatusUpdate, string>> = {
  confirmed: "confirm",
  rejected: "reject",
  waitlisted: "waitlist",
};

const ATTENDANCE_ACTION_PATHS: Record<AdminRegistrationAttendanceStatus, string> = {
  attended: "attended",
  no_show: "no-show",
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

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => (typeof entry === "string" ? entry.trim() : null))
    .filter((entry): entry is string => Boolean(entry && entry.length > 0));
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

function normalizeEventRegistrationRow(
  row: AdminApiEventRegistrationResponse,
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

function buildCounts(
  registrations: readonly AdminEventRegistrationRow[],
): Pick<
  AdminRegistrationEventSummary,
  | "attendedCount"
  | "cancelledCount"
  | "confirmedCount"
  | "noShowCount"
  | "pendingCount"
  | "rejectedCount"
  | "waitlistedCount"
> {
  const counts: Record<AdminRegistrationStatus, number> = {
    attended: 0,
    cancelled: 0,
    confirmed: 0,
    no_show: 0,
    pending: 0,
    rejected: 0,
    waitlisted: 0,
  };

  registrations.forEach((registration) => {
    if (registration.status in counts) {
      counts[registration.status as AdminRegistrationStatus] += 1;
    }
  });

  return {
    attendedCount: counts.attended,
    cancelledCount: counts.cancelled,
    confirmedCount: counts.confirmed,
    noShowCount: counts.no_show,
    pendingCount: counts.pending,
    rejectedCount: counts.rejected,
    waitlistedCount: counts.waitlisted,
  };
}

async function listAdminEventsViaApi(): Promise<AdminApiEventResponse[]> {
  const events: AdminApiEventResponse[] = [];
  let cursor: string | null = null;

  do {
    const response: ApiResponseEnvelope<AdminApiEventResponse[]> =
      await apiClient.getEnvelope<AdminApiEventResponse[]>(
        "/admin/events",
        {
          query: {
            cursor,
            limit: ADMIN_EVENTS_PAGE_LIMIT,
          },
        },
      );
    events.push(...(response.data ?? []));

    const pagination: ApiPaginationMeta | undefined = response.meta?.pagination;
    if (!pagination?.has_more) {
      cursor = null;
    } else if (pagination.next_cursor) {
      cursor = pagination.next_cursor;
    } else {
      throw new Error("List registration events failed: API pagination did not return next_cursor.");
    }
  } while (cursor);

  return events;
}

async function listAdminEventOccurrencesViaApi(
  eventId: string,
): Promise<AdminApiEventOccurrenceResponse[]> {
  return apiClient.get<AdminApiEventOccurrenceResponse[]>(
    `/admin/events/${encodeURIComponent(eventId)}/occurrences`,
  );
}

async function listAllEventRegistrationsViaApi(
  eventId: string,
): Promise<AdminEventRegistrationRow[]> {
  const registrations: AdminEventRegistrationRow[] = [];
  let offset = 0;

  while (true) {
    const page = await listEventRegistrations({
      eventId,
      limit: ADMIN_REGISTRATION_SUMMARY_PAGE_LIMIT,
      occurrenceId: null,
      offset,
      search: null,
      status: "all",
    });
    registrations.push(...page);

    if (page.length < ADMIN_REGISTRATION_SUMMARY_PAGE_LIMIT) {
      break;
    }

    offset += page.length;
  }

  return registrations;
}

export async function listRegistrationEvents(): Promise<AdminRegistrationEventSummary[]> {
  const events = await listAdminEventsViaApi();

  return Promise.all(
    events.map(async (event): Promise<AdminRegistrationEventSummary> => {
      const [occurrences, registrations] = await Promise.all([
        listAdminEventOccurrencesViaApi(event.id),
        listAllEventRegistrationsViaApi(event.id),
      ]);

      return {
        eventId: requiredString(event.id, ""),
        title: requiredString(event.title, "Untitled event"),
        startsAt: nullableString(event.starts_at),
        eventKind: requiredString(event.event_kind, "single"),
        registrationMode: requiredString(event.registration_mode, "none"),
        capacity: nullableNumber(event.capacity),
        occurrenceCount: occurrences.length,
        ...buildCounts(registrations),
      };
    }),
  );
}

export async function listAdminEventCapacities(
  eventIds: string[],
): Promise<Map<string, number | null>> {
  const requestedIds = new Set(eventIds.filter(Boolean));
  if (requestedIds.size === 0) {
    return new Map();
  }

  const events = await listAdminEventsViaApi();
  return new Map(
    events
      .filter((event) => requestedIds.has(event.id))
      .map((event) => [event.id, nullableNumber(event.capacity)] as const),
  );
}

export async function listEventRegistrations(
  params: ListEventRegistrationsParams,
): Promise<AdminEventRegistrationRow[]> {
  const registrations = await apiClient.get<AdminApiEventRegistrationResponse[]>(
    `/admin/events/${encodeURIComponent(params.eventId)}/registrations`,
    {
      query: {
        limit: params.limit ?? undefined,
        occurrence_id: params.occurrenceId ?? undefined,
        offset: params.offset ?? undefined,
        search: params.search ?? undefined,
        status: params.status ?? undefined,
      },
    },
  );

  return registrations.map(normalizeEventRegistrationRow);
}

export async function updateRegistrationStatus(
  registrationId: string,
  nextStatus: AdminRegistrationStatusUpdate,
  _reason?: string | null,
): Promise<AdminEventRegistrationRow> {
  const action = STATUS_ACTION_PATHS[nextStatus];
  if (!action) {
    throw new Error(`Registration status "${nextStatus}" is not available in API provider mode.`);
  }

  const registration = await apiClient.request<AdminApiEventRegistrationResponse>(
    `/admin/registrations/${encodeURIComponent(registrationId)}/${action}`,
    { method: "POST" },
  );

  return normalizeEventRegistrationRow(registration);
}

export async function markRegistrationAttendance(
  registrationId: string,
  attendanceStatus: AdminRegistrationAttendanceStatus,
): Promise<AdminEventRegistrationRow> {
  const action = ATTENDANCE_ACTION_PATHS[attendanceStatus];
  const registration = await apiClient.request<AdminApiEventRegistrationResponse>(
    `/admin/registrations/${encodeURIComponent(registrationId)}/${action}`,
    { method: "POST" },
  );

  return normalizeEventRegistrationRow(registration);
}
