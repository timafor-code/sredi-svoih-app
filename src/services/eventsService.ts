import { supabase } from './supabaseClient';

export type EventRegistrationMode =
  | 'none'
  | 'external_link'
  | 'internal_free'
  | 'internal_paid';

export type EventVisibility = 'public' | 'members_only' | 'hidden';

export type EventStatus = 'draft' | 'published' | 'cancelled' | 'archived';

export type CommunityEvent = {
  id: string;
  community_id: string;

  title: string;
  subtitle: string | null;
  short_description: string | null;
  description: string | null;

  starts_at: string;
  ends_at: string | null;
  timezone: string | null;

  location_name: string | null;
  address: string | null;

  image_url: string | null;
  category: string | null;
  audience: string | null;

  visibility: EventVisibility;
  status: EventStatus;

  source_type: string;
  source_url: string | null;

  registration_mode: EventRegistrationMode;
  registration_url: string | null;

  capacity: number | null;
  waitlist_enabled: boolean;
  requires_approval: boolean;

  price_amount: number | null;
  price_currency: string | null;

  published_at: string | null;
};

const EVENT_FIELDS = `
  id,
  community_id,
  title,
  subtitle,
  short_description,
  description,
  starts_at,
  ends_at,
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
  registration_mode,
  registration_url,
  capacity,
  waitlist_enabled,
  requires_approval,
  price_amount,
  price_currency,
  published_at
`;

export async function listPublishedEvents(): Promise<CommunityEvent[]> {
  const { data, error } = await supabase
    .from('events')
    .select(EVENT_FIELDS)
    .eq('status', 'published')
    .eq('visibility', 'public')
    .order('starts_at', { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []) as CommunityEvent[];
}

export async function getEventById(id: string): Promise<CommunityEvent | null> {
  const { data, error } = await supabase
    .from('events')
    .select(EVENT_FIELDS)
    .eq('id', id)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return data as CommunityEvent | null;
}