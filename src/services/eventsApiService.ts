import type { ApiEventResponse } from '@/types/api';
import type {
  Event,
  EventRegistrationMode,
  EventStatus,
  EventVisibility,
} from '@/types/event';

import { apiClient, ApiClientError } from './apiClient';

const API_EVENTS_PAGE_LIMIT = 100;

const EVENT_VISIBILITIES: EventVisibility[] = ['public', 'members_only', 'hidden'];
const EVENT_STATUSES: EventStatus[] = ['draft', 'published', 'cancelled', 'archived'];
const EVENT_REGISTRATION_MODES: EventRegistrationMode[] = [
  'none',
  'external_link',
  'internal_free',
  'internal_paid',
];

function nullableString(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  return typeof value === 'string' ? value : String(value);
}

function requiredString(value: unknown, fallback: string): string {
  const normalized = nullableString(value);

  return normalized && normalized.trim().length > 0 ? normalized : fallback;
}

function nullableNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);

    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function normalizeBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();

    if (normalized === 'true') return true;
    if (normalized === 'false') return false;
  }

  return fallback;
}

function normalizeEnum<T extends string>(
  value: unknown,
  allowedValues: readonly T[],
  fallback: T,
): T {
  const normalized = nullableString(value);

  return allowedValues.find((allowedValue) => allowedValue === normalized) ?? fallback;
}

function eventPath(eventId: string): string {
  return `/events/${encodeURIComponent(eventId)}`;
}

export function normalizeApiEvent(row: ApiEventResponse): Event {
  return {
    id: requiredString(row.id, ''),
    communityId: requiredString(row.community_id, ''),
    eventKind: nullableString(row.event_kind),
    title: requiredString(row.title, ''),
    subtitle: nullableString(row.subtitle),
    shortDescription: nullableString(row.short_description),
    description: nullableString(row.description),
    startsAt: requiredString(row.starts_at, ''),
    endsAt: nullableString(row.ends_at),
    timezone: nullableString(row.timezone),
    locationName: nullableString(row.location_name),
    address: nullableString(row.address),
    latitude: nullableNumber(row.latitude),
    longitude: nullableNumber(row.longitude),
    imageUrl: nullableString(row.image_url),
    category: nullableString(row.category),
    audience: nullableString(row.audience),
    visibility: normalizeEnum(row.visibility, EVENT_VISIBILITIES, 'public'),
    status: normalizeEnum(row.status, EVENT_STATUSES, 'published'),
    sourceType: requiredString(row.source_type, 'api'),
    sourceUrl: nullableString(row.source_url),
    registrationMode: normalizeEnum(row.registration_mode, EVENT_REGISTRATION_MODES, 'none'),
    registrationUrl: nullableString(row.registration_url),
    capacity: nullableNumber(row.capacity),
    waitlistEnabled: normalizeBoolean(row.waitlist_enabled, false),
    requiresApproval: normalizeBoolean(row.requires_approval, false),
    priceAmount: nullableNumber(row.price_amount),
    priceCurrency: nullableString(row.price_currency),
    publishedAt: nullableString(row.published_at),
    isPermanent: normalizeBoolean(row.is_permanent, false),
  };
}

export async function listPublishedEvents(): Promise<Event[]> {
  const response = await apiClient.get<ApiEventResponse[] | null>('/events', {
    query: { limit: API_EVENTS_PAGE_LIMIT },
  });

  return (response ?? []).map(normalizeApiEvent);
}

export async function getEventById(id: string): Promise<Event | null> {
  try {
    const response = await apiClient.get<ApiEventResponse | null>(eventPath(id));

    return response ? normalizeApiEvent(response) : null;
  } catch (error) {
    if (error instanceof ApiClientError && error.status === 404) {
      return null;
    }

    throw error;
  }
}
