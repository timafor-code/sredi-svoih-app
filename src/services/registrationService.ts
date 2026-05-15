import { supabase } from './supabaseClient';
import {
  EVENT_FIELDS,
  normalizeEventRow,
  type CommunityEventRow,
} from '@/services/eventsService';
import type {
  Event,
  EventRegistration,
  EventRegistrationOccurrence,
  EventRegistrationSelectedOptionSnapshot,
  EventRegistrationStatus,
} from '@/types/event';

type EventRegistrationOptionSelectionRow = {
  id?: unknown;
  option_id?: unknown;
  optionId?: unknown;
  title?: unknown;
  name?: unknown;
  title_snapshot?: unknown;
  description?: unknown;
  description_snapshot?: unknown;
  option_type_snapshot?: unknown;
  optionType?: unknown;
  quantity?: unknown;
  unit_price_amount?: unknown;
  unitPriceAmount?: unknown;
  unitAmount?: unknown;
  total_amount?: unknown;
  totalAmount?: unknown;
  currency?: unknown;
  counts_toward_capacity?: unknown;
  countsTowardCapacity?: unknown;
  seats_count?: unknown;
  seatsCount?: unknown;
  is_donation?: unknown;
  isDonation?: unknown;
  created_at?: unknown;
  createdAt?: unknown;
};

type EventRegistrationOccurrenceRow = {
  id: string;
  event_id: string;
  title: string | null;
  starts_at: string;
  ends_at: string | null;
  timezone: string | null;
};

type EventRegistrationRow = {
  id: string;
  event_id: string;
  occurrence_id?: string | null;
  user_id: string;
  status: EventRegistrationStatus;
  seats_count: number;
  guest_names: unknown[];
  comment: string | null;
  registered_at: string;
  confirmed_at: string | null;
  cancelled_at: string | null;
  payment_status: string;
  payment_id: string | null;
  occurrence_starts_at?: string | null;
  occurrence_ends_at?: string | null;
  occurrence_title?: string | null;
  selected_options?: unknown;
  total_amount?: number | string | null;
  created_at: string;
  updated_at: string;
  event?: CommunityEventRow | CommunityEventRow[] | null;
  occurrence?: EventRegistrationOccurrenceRow | EventRegistrationOccurrenceRow[] | null;
};

export type PaidEventOptionSelectionInput = {
  optionId: string;
  quantity: number;
};

export type RegisterForPaidEventSimulatedInput = {
  eventId: string;
  occurrenceId?: string | null;
  optionSelections: PaidEventOptionSelectionInput[];
  seatsCount?: number | null;
  guestNames?: string[] | null;
  comment?: string | null;
};

const REGISTRATION_FIELDS = `
  id,
  event_id,
  user_id,
  status,
  seats_count,
  guest_names,
  comment,
  occurrence_id,
  registered_at,
  confirmed_at,
  cancelled_at,
  payment_status,
  payment_id,
  created_at,
  updated_at,
  event:events (
    ${EVENT_FIELDS}
  ),
  occurrence:event_occurrences (
    id,
    event_id,
    title,
    starts_at,
    ends_at,
    timezone
  ),
  selected_options:event_registration_option_selections (
    id,
    option_id,
    title_snapshot,
    description_snapshot,
    option_type_snapshot,
    quantity,
    unit_price_amount,
    total_amount,
    currency,
    counts_toward_capacity,
    seats_count,
    is_donation,
    created_at
  )
`;

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

function safeBoolean(value: unknown, fallback: boolean): boolean {
  const parsed = nullableBoolean(value);

  return parsed === null ? fallback : parsed;
}

function normalizeEmbeddedEvent(event: EventRegistrationRow['event']): Event | undefined {
  if (!event) {
    return undefined;
  }

  const row = Array.isArray(event) ? event[0] : event;

  return row ? normalizeEventRow(row) : undefined;
}

function normalizeEmbeddedOccurrence(
  row: EventRegistrationRow,
  event: Event | undefined,
): EventRegistrationOccurrence | undefined {
  if (row.occurrence) {
    const occurrence = Array.isArray(row.occurrence) ? row.occurrence[0] : row.occurrence;

    if (occurrence) {
      return {
        id: occurrence.id,
        eventId: occurrence.event_id,
        title: occurrence.title,
        startsAt: occurrence.starts_at,
        endsAt: occurrence.ends_at,
        timezone: occurrence.timezone,
      };
    }
  }

  if (row.occurrence_id && row.occurrence_starts_at) {
    return {
      id: row.occurrence_id,
      eventId: row.event_id,
      title: row.occurrence_title ?? null,
      startsAt: row.occurrence_starts_at,
      endsAt: row.occurrence_ends_at ?? null,
      timezone: event?.timezone ?? null,
    };
  }

  return undefined;
}

function normalizeSelectedOption(
  row: EventRegistrationOptionSelectionRow,
): EventRegistrationSelectedOptionSnapshot {
  const quantity = Math.max(1, Math.round(safeNumber(row.quantity, 1)));
  const unitAmount = safeNumber(row.unitAmount ?? row.unitPriceAmount ?? row.unit_price_amount, 0);
  const totalAmount = safeNumber(row.totalAmount ?? row.total_amount, unitAmount * quantity);
  const title = requiredString(row.title ?? row.title_snapshot ?? row.name, 'Вариант участия');

  return {
    id: requiredString(row.id, ''),
    optionId: nullableString(row.optionId ?? row.option_id),
    title,
    name: requiredString(row.name ?? title, title),
    description: nullableString(row.description ?? row.description_snapshot),
    optionType: requiredString(row.optionType ?? row.option_type_snapshot, 'participation'),
    quantity,
    unitAmount,
    unitPriceAmount: unitAmount,
    totalAmount,
    currency: requiredString(row.currency, 'RUB'),
    countsTowardCapacity: safeBoolean(row.countsTowardCapacity ?? row.counts_toward_capacity, true),
    seatsCount: Math.max(0, Math.round(safeNumber(row.seatsCount ?? row.seats_count, 0))),
    isDonation: safeBoolean(row.isDonation ?? row.is_donation, false),
    createdAt: nullableString(row.createdAt ?? row.created_at),
  };
}

function normalizeSelectedOptions(value: unknown): EventRegistrationSelectedOptionSnapshot[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item): item is EventRegistrationOptionSelectionRow => (
      item !== null && typeof item === 'object'
    ))
    .map(normalizeSelectedOption)
    .sort((first, second) => {
      const firstCreatedAt = first.createdAt ? new Date(first.createdAt).getTime() : 0;
      const secondCreatedAt = second.createdAt ? new Date(second.createdAt).getTime() : 0;

      if (firstCreatedAt !== secondCreatedAt) {
        return firstCreatedAt - secondCreatedAt;
      }

      return first.id.localeCompare(second.id);
    });
}

function normalizeRegistration(row: EventRegistrationRow): EventRegistration {
  const event = normalizeEmbeddedEvent(row.event);
  const occurrence = normalizeEmbeddedOccurrence(row, event);
  const selectedOptions = normalizeSelectedOptions(row.selected_options);
  const totalAmount = nullableNumber(row.total_amount)
    ?? (selectedOptions.length > 0
      ? selectedOptions.reduce((sum, option) => sum + option.totalAmount, 0)
      : null);

  return {
    id: row.id,
    eventId: row.event_id,
    occurrenceId: row.occurrence_id ?? null,
    userId: row.user_id,
    status: row.status,
    seatsCount: row.seats_count,
    guestNames: Array.isArray(row.guest_names) ? row.guest_names : [],
    comment: row.comment,
    registeredAt: row.registered_at,
    confirmedAt: row.confirmed_at,
    cancelledAt: row.cancelled_at,
    paymentStatus: row.payment_status,
    paymentId: row.payment_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    event,
    occurrence,
    selectedOptions,
    totalAmount,
    totalCurrency: selectedOptions[0]?.currency ?? (totalAmount !== null ? event?.priceCurrency ?? 'RUB' : null),
  };
}

function normalizeSingleResult(data: EventRegistrationRow | EventRegistrationRow[] | null): EventRegistration | null {
  if (!data) {
    return null;
  }

  if (Array.isArray(data)) {
    return data[0] ? normalizeRegistration(data[0]) : null;
  }

  return normalizeRegistration(data);
}

export async function registerForEvent(
  eventId: string,
  seatsCount = 1,
  comment?: string | null,
): Promise<EventRegistration> {
  const { data, error } = await supabase.rpc('register_for_event', {
    p_event_id: eventId,
    p_seats_count: seatsCount,
    p_comment: comment ?? null,
  });

  if (error) {
    throw new Error(error.message);
  }

  const registration = normalizeSingleResult(data as EventRegistrationRow | EventRegistrationRow[] | null);

  if (registration) {
    try {
      const registrations = await loadMyRegistrations();
      const hydratedRegistration = registrations.find((item) => item.id === registration.id);

      return hydratedRegistration ?? registration;
    } catch {
      return registration;
    }
  }

  const registrations = await loadMyRegistrations();
  const fallbackRegistration = registrations.find((item) => item.eventId === eventId);

  if (!fallbackRegistration) {
    throw new Error('Registration result is empty');
  }

  return fallbackRegistration;
}

export async function registerForPaidEventSimulated(
  input: RegisterForPaidEventSimulatedInput,
): Promise<EventRegistration> {
  const payload = {
    eventId: input.eventId,
    occurrenceId: input.occurrenceId ?? null,
    optionSelections: input.optionSelections.map((selection) => ({
      optionId: selection.optionId,
      quantity: selection.quantity,
    })),
    seatsCount: input.seatsCount ?? undefined,
    guestNames: input.guestNames ?? undefined,
    comment: input.comment ?? undefined,
  };
  const { data, error } = await supabase.rpc('register_for_paid_event_simulated', {
    payload,
  });

  if (error) {
    throw new Error(error.message);
  }

  const registration = normalizeSingleResult(data as EventRegistrationRow | EventRegistrationRow[] | null);

  if (registration) {
    return registration;
  }

  // RPC should always return the newly inserted row, but if it ever comes back
  // empty fall back to refetching the user's registrations.
  const registrations = await loadMyRegistrations();
  const targetOccurrenceId = input.occurrenceId ?? null;
  const fallbackRegistration = registrations
    .filter((item) => (
      item.eventId === input.eventId
      && (targetOccurrenceId ? item.occurrenceId === targetOccurrenceId : !item.occurrenceId)
    ))
    .sort((first, second) => (
      new Date(second.registeredAt).getTime() - new Date(first.registeredAt).getTime()
    ))[0]
    ?? registrations.find((item) => item.eventId === input.eventId);

  if (!fallbackRegistration) {
    throw new Error('Registration result is empty');
  }

  return fallbackRegistration;
}

export async function loadMyRegistrations(): Promise<EventRegistration[]> {
  const { data, error } = await supabase
    .from('event_registrations')
    .select(REGISTRATION_FIELDS)
    .order('registered_at', { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  return ((data ?? []) as EventRegistrationRow[]).map(normalizeRegistration);
}

export async function cancelRegistration(registrationId: string): Promise<EventRegistration> {
  const { data, error } = await supabase.rpc('cancel_event_registration', {
    registration_id: registrationId,
  });

  if (error) {
    throw new Error(error.message);
  }

  const registration = normalizeSingleResult(data as EventRegistrationRow | EventRegistrationRow[] | null);

  if (registration) {
    return registration;
  }

  const registrations = await loadMyRegistrations();
  const fallbackRegistration = registrations.find((item) => item.id === registrationId);

  if (!fallbackRegistration) {
    throw new Error('Registration result is empty');
  }

  return fallbackRegistration;
}
