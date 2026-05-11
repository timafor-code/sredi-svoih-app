import { supabase } from './supabaseClient';
import type {
  EventOccurrence,
  EventOccurrenceRow,
} from '@/types/eventOccurrence';

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

function safeNumber(value: unknown, fallback: number): number {
  const parsed = nullableNumber(value);

  return parsed === null ? fallback : parsed;
}

function nullableBoolean(value: unknown): boolean | null {
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();

    if (normalized === 'true') return true;
    if (normalized === 'false') return false;
  }

  return null;
}

export function normalizeEventOccurrenceRow(
  row: Partial<EventOccurrenceRow>,
): EventOccurrence {
  return {
    id: requiredString(row.id, ''),
    eventId: requiredString(row.event_id, ''),
    title: nullableString(row.title),
    startsAt: requiredString(row.starts_at, ''),
    endsAt: nullableString(row.ends_at),
    timezone: requiredString(row.timezone, 'Europe/Moscow'),
    registrationOpensAt: nullableString(row.registration_opens_at),
    registrationClosesAt: nullableString(row.registration_closes_at),
    capacity: nullableNumber(row.capacity),
    waitlistEnabled: nullableBoolean(row.waitlist_enabled),
    requiresApproval: nullableBoolean(row.requires_approval),
    status: requiredString(row.status, 'active'),
    sortOrder: safeNumber(row.sort_order, 0),
    createdAt: requiredString(row.created_at, ''),
    updatedAt: requiredString(row.updated_at, ''),
  };
}

function sortOccurrences(occurrences: EventOccurrence[]): EventOccurrence[] {
  return [...occurrences].sort((first, second) => {
    const byStart = new Date(first.startsAt).getTime() - new Date(second.startsAt).getTime();

    if (byStart !== 0) {
      return byStart;
    }

    return first.sortOrder - second.sortOrder;
  });
}

export async function listEventOccurrences(eventId: string): Promise<EventOccurrence[]> {
  const { data, error } = await supabase.rpc('list_event_occurrences', {
    p_event_id: eventId,
  });

  if (error) {
    throw new Error(error.message);
  }

  return sortOccurrences(
    ((data ?? []) as EventOccurrenceRow[]).map(normalizeEventOccurrenceRow),
  );
}

const EVENT_OCCURRENCE_FIELDS = `
  id,
  event_id,
  title,
  starts_at,
  ends_at,
  timezone,
  registration_opens_at,
  registration_closes_at,
  capacity,
  waitlist_enabled,
  requires_approval,
  status,
  sort_order,
  created_at,
  updated_at
`;

export async function listActiveOccurrencesForEvents(
  eventIds: ReadonlyArray<string>,
): Promise<Map<string, EventOccurrence[]>> {
  const map = new Map<string, EventOccurrence[]>();

  if (eventIds.length === 0) {
    return map;
  }

  const { data, error } = await supabase
    .from('event_occurrences')
    .select(EVENT_OCCURRENCE_FIELDS)
    .in('event_id', eventIds as string[])
    .eq('status', 'active');

  if (error) {
    throw new Error(error.message);
  }

  const normalized = ((data ?? []) as EventOccurrenceRow[]).map(
    normalizeEventOccurrenceRow,
  );

  normalized.forEach((occurrence) => {
    const existing = map.get(occurrence.eventId);
    if (existing) {
      existing.push(occurrence);
    } else {
      map.set(occurrence.eventId, [occurrence]);
    }
  });

  map.forEach((occurrences, key) => {
    map.set(key, sortOccurrences(occurrences));
  });

  return map;
}
