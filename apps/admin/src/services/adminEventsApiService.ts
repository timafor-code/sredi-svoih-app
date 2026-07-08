import { apiClient } from "./apiClient";
import { normalizeAdminEventRow } from "./adminEventsService";
import type {
  AdminApiEventResponse,
  ApiPaginationMeta,
  ApiResponseEnvelope,
} from "../types/api";
import type {
  AdminEvent,
  AdminEventMutationInput,
  CreateAdminEventInput,
  UpdateAdminEventInput,
} from "../types/events";

const ADMIN_EVENTS_PAGE_LIMIT = 100;

type AdminEventApiMutationPayload = {
  community_id?: string;
  event_kind?: string;
  title?: string;
  subtitle?: string | null;
  description?: string | null;
  short_description?: string | null;
  starts_at?: string;
  ends_at?: string | null;
  is_permanent?: boolean;
  timezone?: string;
  location_name?: string | null;
  address?: string | null;
  image_url?: string | null;
  category?: string;
  audience?: string | null;
  visibility?: string;
  status?: string;
  registration_mode?: string;
  registration_url?: string | null;
  capacity?: number | null;
  waitlist_enabled?: boolean;
  requires_approval?: boolean;
  price_amount?: number | null;
  price_currency?: string;
};

type AdminEventStatusAction = "publish" | "archive" | "cancel";

const STATUS_ACTION_PATHS: Partial<Record<string, AdminEventStatusAction>> = {
  archived: "archive",
  cancelled: "cancel",
  published: "publish",
};

function compactUndefined<T extends Record<string, unknown>>(payload: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(payload).filter(([, value]) => value !== undefined),
  ) as Partial<T>;
}

function normalizeAdminApiEvent(row: AdminApiEventResponse): AdminEvent {
  return normalizeAdminEventRow(row);
}

function buildAdminEventApiPayload(
  input: Partial<AdminEventMutationInput> & { communityId?: string },
): Partial<AdminEventApiMutationPayload> {
  return compactUndefined({
    community_id: input.communityId,
    event_kind: input.eventKind,
    title: input.title,
    subtitle: input.subtitle,
    description: input.description,
    short_description: input.shortDescription,
    starts_at: input.startsAt,
    ends_at: input.endsAt,
    is_permanent: input.isPermanent,
    timezone: input.timezone,
    location_name: input.locationName,
    address: input.address,
    image_url: input.imageUrl,
    category: input.category,
    audience: input.audience,
    visibility: input.visibility,
    status: input.status,
    registration_mode: input.registrationMode,
    registration_url: input.registrationUrl,
    capacity: input.capacity,
    waitlist_enabled: input.waitlistEnabled,
    requires_approval: input.requiresApproval,
    price_amount: input.priceAmount,
    price_currency: input.priceCurrency,
  });
}

function isApiStatusActionPayload(input: UpdateAdminEventInput): boolean {
  const statusAction = input.status ? STATUS_ACTION_PATHS[input.status] : undefined;
  if (!statusAction) {
    return false;
  }

  const keys = Object.entries(input)
    .filter(([, value]) => value !== undefined)
    .map(([key]) => key);

  return keys.length > 0 && keys.every((key) => key === "status" || key === "visibility");
}

async function transitionAdminEventStatus(
  eventId: string,
  input: UpdateAdminEventInput,
): Promise<AdminEvent> {
  const action = input.status ? STATUS_ACTION_PATHS[input.status] : undefined;
  if (!action) {
    throw new Error("Unsupported admin event status action.");
  }

  const encodedEventId = encodeURIComponent(eventId);
  let event = normalizeAdminApiEvent(
    await apiClient.request<AdminApiEventResponse>(
      `/admin/events/${encodedEventId}/${action}`,
      { method: "POST" },
    ),
  );

  if (input.visibility !== undefined && event.visibility !== input.visibility) {
    event = normalizeAdminApiEvent(
      await apiClient.patch<AdminApiEventResponse, Partial<AdminEventApiMutationPayload>>(
        `/admin/events/${encodedEventId}`,
        { visibility: input.visibility },
      ),
    );
  }

  return event;
}

export async function listAdminEvents(): Promise<AdminEvent[]> {
  const events: AdminEvent[] = [];
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
    const pageEvents = response.data ?? [];
    events.push(...pageEvents.map(normalizeAdminApiEvent));

    const pagination: ApiPaginationMeta | undefined = response.meta?.pagination;
    if (!pagination?.has_more) {
      cursor = null;
    } else if (pagination.next_cursor) {
      cursor = pagination.next_cursor;
    } else {
      throw new Error("List admin events failed: API pagination did not return next_cursor.");
    }
  } while (cursor);

  return events;
}

export async function createAdminEvent(input: CreateAdminEventInput): Promise<AdminEvent> {
  const payload = buildAdminEventApiPayload(input);
  const event = await apiClient.post<
    AdminApiEventResponse,
    Partial<AdminEventApiMutationPayload>
  >("/admin/events", payload);

  return normalizeAdminApiEvent(event);
}

export async function updateAdminEvent(
  eventId: string,
  input: UpdateAdminEventInput,
): Promise<AdminEvent> {
  if (isApiStatusActionPayload(input)) {
    return transitionAdminEventStatus(eventId, input);
  }

  const event = await apiClient.patch<
    AdminApiEventResponse,
    Partial<AdminEventApiMutationPayload>
  >(`/admin/events/${encodeURIComponent(eventId)}`, buildAdminEventApiPayload(input));

  return normalizeAdminApiEvent(event);
}

export async function deleteAdminEvent(_eventId: string): Promise<AdminEvent> {
  throw new Error(
    "Delete admin event is not available in API provider mode yet. Use archive or cancel instead, or switch VITE_ADMIN_EVENTS_PROVIDER back to supabase for the legacy hard-delete RPC.",
  );
}
