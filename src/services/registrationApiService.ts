import type {
  ApiEventRegistrationResponse,
  ApiRegisterEventRequest,
  ApiRegistrationSelectedOptionResponse,
} from '@/types/api';
import type {
  Event,
  EventRegistration,
  EventRegistrationOccurrence,
  EventRegistrationSelectedOptionSnapshot,
  EventRegistrationStatus,
  RegisterForEventOccurrenceOptionSelectionInput,
  RegisterForEventOccurrenceWithOptionsInput,
} from '@/types/event';

import { apiClient, ApiClientError } from './apiClient';
import { normalizeApiEventOccurrence } from './eventOccurrencesApiService';
import { normalizeApiEvent } from './eventsApiService';

type RegisterForPaidEventSimulatedInput = {
  eventId: string;
  occurrenceId?: string | null;
  optionSelections: RegisterForEventOccurrenceOptionSelectionInput[];
  seatsCount?: number | null;
  guestNames?: string[] | null;
  comment?: string | null;
};

type RegistrationApiAction = 'register' | 'cancel' | 'list';

const REGISTRATION_STATUSES: EventRegistrationStatus[] = [
  'pending',
  'confirmed',
  'waitlisted',
  'cancelled',
  'rejected',
  'attended',
  'no_show',
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

function normalizeStatus(value: unknown): EventRegistrationStatus {
  const normalized = nullableString(value);

  return REGISTRATION_STATUSES.find((status) => status === normalized) ?? 'pending';
}

function eventRegistrationPath(eventId: string): string {
  return `/events/${encodeURIComponent(eventId)}/register`;
}

function registrationCancelPath(registrationId: string): string {
  return `/registrations/${encodeURIComponent(registrationId)}/cancel`;
}

function normalizeOptionSelectionPayload(
  selections: RegisterForEventOccurrenceOptionSelectionInput[] | null | undefined,
): ApiRegisterEventRequest['option_selections'] {
  return (selections ?? []).map((selection) => ({
    option_id: selection.optionId,
    quantity: selection.quantity,
  }));
}

function normalizeSelectedOption(
  row: ApiRegistrationSelectedOptionResponse,
): EventRegistrationSelectedOptionSnapshot {
  const quantity = Math.max(1, Math.round(safeNumber(row.quantity, 1)));
  const unitAmount = safeNumber(row.unit_price_amount, 0);
  const totalAmount = safeNumber(row.total_amount, unitAmount * quantity);
  const title = requiredString(row.title_snapshot, 'Participation option');

  return {
    id: requiredString(row.id, ''),
    optionId: nullableString(row.option_id),
    title,
    name: title,
    description: nullableString(row.description_snapshot),
    optionType: requiredString(row.option_type_snapshot, 'participation'),
    quantity,
    unitAmount,
    unitPriceAmount: unitAmount,
    totalAmount,
    currency: requiredString(row.currency, 'RUB'),
    countsTowardCapacity: row.counts_toward_capacity,
    seatsCount: Math.max(0, Math.round(safeNumber(row.seats_count, 0))),
    isDonation: row.is_donation,
    createdAt: nullableString(row.created_at),
  };
}

function normalizeSelectedOptions(
  rows: ApiRegistrationSelectedOptionResponse[] | null | undefined,
): EventRegistrationSelectedOptionSnapshot[] {
  return [...(rows ?? [])]
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

function normalizeOccurrence(
  row: ApiEventRegistrationResponse['occurrence'],
): EventRegistrationOccurrence | undefined {
  if (!row) {
    return undefined;
  }

  const occurrence = normalizeApiEventOccurrence(row);

  return {
    id: occurrence.id,
    eventId: occurrence.eventId,
    title: occurrence.title,
    startsAt: occurrence.startsAt,
    endsAt: occurrence.endsAt,
    timezone: occurrence.timezone,
  };
}

export function normalizeApiRegistration(row: ApiEventRegistrationResponse): EventRegistration {
  const event: Event = normalizeApiEvent(row.event);
  const selectedOptions = normalizeSelectedOptions(row.selected_options);
  const totalAmount = nullableNumber(row.total_amount)
    ?? (selectedOptions.length > 0
      ? selectedOptions.reduce((sum, option) => sum + option.totalAmount, 0)
      : null);

  return {
    id: requiredString(row.id, ''),
    eventId: requiredString(row.event_id, ''),
    occurrenceId: nullableString(row.occurrence_id),
    userId: requiredString(row.user_id, ''),
    status: normalizeStatus(row.status),
    seatsCount: Math.max(1, Math.round(safeNumber(row.seats_count, 1))),
    guestNames: Array.isArray(row.guest_names) ? row.guest_names : [],
    comment: nullableString(row.comment),
    registeredAt: requiredString(row.registered_at, ''),
    confirmedAt: nullableString(row.confirmed_at),
    cancelledAt: nullableString(row.cancelled_at),
    paymentStatus: requiredString(row.payment_status, 'not_required'),
    paymentId: nullableString(row.payment_id),
    createdAt: requiredString(row.created_at, ''),
    updatedAt: requiredString(row.updated_at, ''),
    event,
    occurrence: normalizeOccurrence(row.occurrence),
    selectedOptions,
    totalAmount,
    totalCurrency: nullableString(row.total_currency)
      ?? selectedOptions[0]?.currency
      ?? (totalAmount !== null ? event.priceCurrency ?? 'RUB' : null),
  };
}

function normalizeApiRegistrationError(error: ApiClientError, action: RegistrationApiAction): Error {
  const normalizedMessage = error.message.toLowerCase();

  if (error.status === 401 || error.code === 'unauthenticated') {
    return new Error('Auth required');
  }

  if (error.code === 'capacity_unavailable' || normalizedMessage.includes('capacity')) {
    return new Error('No seats available for this event');
  }

  if (error.code === 'state_conflict') {
    if (normalizedMessage.includes('cancel')) {
      return new Error('Registration cannot be cancelled');
    }

    return new Error(error.message || 'Registration is not available.');
  }

  if (error.status === 409 || error.code === 'conflict') {
    return new Error('Registration is not available.');
  }

  if (error.status === 422 || error.code === 'validation_error') {
    if (
      normalizedMessage.includes('occurrence_id')
      || normalizedMessage.includes('occurrenceid')
    ) {
      return new Error('occurrenceId is required');
    }

    return new Error(error.message || 'Request validation failed.');
  }

  if (error.status === 403 || error.code === 'forbidden') {
    return new Error('Registration is not available.');
  }

  if (error.status === 404 || error.code === 'not_found') {
    return new Error(action === 'cancel' ? 'Registration not found' : 'Registration is not available.');
  }

  return new Error(error.message);
}

async function withRegistrationApiErrors<T>(
  action: RegistrationApiAction,
  run: () => Promise<T>,
): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof ApiClientError) {
      throw normalizeApiRegistrationError(error, action);
    }

    throw error;
  }
}

async function postRegistration(
  eventId: string,
  payload: ApiRegisterEventRequest,
): Promise<EventRegistration> {
  const response = await apiClient.post<ApiEventRegistrationResponse, ApiRegisterEventRequest>(
    eventRegistrationPath(eventId),
    payload,
  );

  return normalizeApiRegistration(response);
}

export async function registerForEvent(
  eventId: string,
  seatsCount = 1,
  comment?: string | null,
): Promise<EventRegistration> {
  return withRegistrationApiErrors('register', () => postRegistration(eventId, {
    seats_count: seatsCount,
    comment: comment ?? null,
  }));
}

export async function registerForPaidEventSimulated(
  input: RegisterForPaidEventSimulatedInput,
): Promise<EventRegistration> {
  return withRegistrationApiErrors('register', () => postRegistration(input.eventId, {
    occurrence_id: input.occurrenceId ?? null,
    option_selections: normalizeOptionSelectionPayload(input.optionSelections),
    seats_count: input.seatsCount ?? 1,
    guest_names: input.guestNames ?? [],
    comment: input.comment ?? null,
  }));
}

export async function registerForEventOccurrenceWithOptions(
  input: RegisterForEventOccurrenceWithOptionsInput,
): Promise<EventRegistration> {
  return withRegistrationApiErrors('register', () => postRegistration(input.eventId, {
    occurrence_id: input.occurrenceId,
    option_selections: normalizeOptionSelectionPayload(input.optionSelections),
    comment: input.comment ?? null,
  }));
}

export async function loadMyRegistrations(): Promise<EventRegistration[]> {
  return withRegistrationApiErrors('list', async () => {
    const response = await apiClient.get<ApiEventRegistrationResponse[] | null>(
      '/me/registrations',
    );

    return (response ?? []).map(normalizeApiRegistration);
  });
}

export async function cancelRegistration(registrationId: string): Promise<EventRegistration> {
  return withRegistrationApiErrors('cancel', async () => {
    const response = await apiClient.post<ApiEventRegistrationResponse, Record<string, never>>(
      registrationCancelPath(registrationId),
      {},
    );

    return normalizeApiRegistration(response);
  });
}
