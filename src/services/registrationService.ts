import { supabase } from './supabaseClient';
import type {
  Event,
  EventRegistration,
  EventRegistrationMode,
  EventRegistrationStatus,
} from '@/types/event';

type EventRow = {
  id: string;
  title: string;
  short_description: string | null;
  starts_at: string;
  ends_at: string | null;
  timezone: string | null;
  location_name: string | null;
  address: string | null;
  category: string | null;
  image_url: string | null;
  registration_mode: EventRegistrationMode;
};

type EventRegistrationRow = {
  id: string;
  event_id: string;
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
  created_at: string;
  updated_at: string;
  event?: EventRow | EventRow[] | null;
};

const REGISTRATION_FIELDS = `
  id,
  event_id,
  user_id,
  status,
  seats_count,
  guest_names,
  comment,
  registered_at,
  confirmed_at,
  cancelled_at,
  payment_status,
  payment_id,
  created_at,
  updated_at,
  event:events (
    id,
    title,
    short_description,
    starts_at,
    ends_at,
    timezone,
    location_name,
    address,
    category,
    image_url,
    registration_mode
  )
`;

function normalizeEvent(row: EventRow): Event {
  return {
    id: row.id,
    title: row.title,
    shortDescription: row.short_description,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    timezone: row.timezone,
    locationName: row.location_name,
    address: row.address,
    category: row.category,
    imageUrl: row.image_url,
    registrationMode: row.registration_mode,
  };
}

function normalizeEmbeddedEvent(event: EventRegistrationRow['event']): Event | undefined {
  if (!event) {
    return undefined;
  }

  const row = Array.isArray(event) ? event[0] : event;

  return row ? normalizeEvent(row) : undefined;
}

function normalizeRegistration(row: EventRegistrationRow): EventRegistration {
  return {
    id: row.id,
    eventId: row.event_id,
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
    event: normalizeEmbeddedEvent(row.event),
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
    return registration;
  }

  const registrations = await loadMyRegistrations();
  const fallbackRegistration = registrations.find((item) => item.eventId === eventId);

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
