import { supabase } from './supabaseClient';

export type EventRegistrationStatus =
  | 'pending'
  | 'confirmed'
  | 'waitlisted'
  | 'cancelled'
  | 'rejected'
  | 'attended'
  | 'no_show';

export type EventRegistration = {
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
  updated_at
`;

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

  return data as EventRegistration;
}

export async function loadMyRegistrations(): Promise<EventRegistration[]> {
  const { data, error } = await supabase
    .from('event_registrations')
    .select(REGISTRATION_FIELDS)
    .order('registered_at', { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []) as EventRegistration[];
}

export async function cancelRegistration(registrationId: string): Promise<EventRegistration> {
  const { data, error } = await supabase
    .from('event_registrations')
    .update({
      status: 'cancelled',
      cancelled_at: new Date().toISOString(),
    })
    .eq('id', registrationId)
    .select(REGISTRATION_FIELDS)
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return data as EventRegistration;
}
