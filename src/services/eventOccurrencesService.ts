import { supabase } from './supabaseClient';
import type {
  EventOccurrence,
  EventOccurrenceRow,
  EventOccurrenceRegistrationState,
} from '@/types/eventOccurrence';

const REGISTRATION_STATES: EventOccurrenceRegistrationState[] = [
  'open',
  'not_yet_open',
  'closed',
  'unavailable',
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

function normalizeRegistrationState(
  value: unknown,
): EventOccurrenceRegistrationState | undefined {
  const normalized = nullableString(value)?.trim().toLowerCase();

  return REGISTRATION_STATES.find((state) => state === normalized);
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
    serverNow: nullableString(row.server_now),
    isRegistrationAlwaysOpen: nullableBoolean(row.is_registration_always_open),
    registrationState: normalizeRegistrationState(row.registration_state),
    registrationStateReason: nullableString(row.registration_state_reason),
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
