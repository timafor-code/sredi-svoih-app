import { supabase } from './supabaseClient';
import type {
  Event,
  EventKind,
  EventRegistrationMode,
  EventStatus,
  EventVisibility,
} from '@/types/event';

export type CommunityEventRow = {
  id: string;
  community_id: string;
  event_kind: EventKind | string | null;

  title: string;
  subtitle: string | null;
  short_description: string | null;
  description: string | null;

  starts_at: string;
  ends_at: string | null;
  timezone: string | null;

  location_name: string | null;
  address: string | null;
  latitude: number | null;
  longitude: number | null;

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

  is_permanent: boolean | null;
};

export const EVENT_FIELDS = `
  id,
  community_id,
  event_kind,
  title,
  subtitle,
  short_description,
  description,
  starts_at,
  ends_at,
  timezone,
  location_name,
  address,
  latitude,
  longitude,
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
  published_at,
  is_permanent
`;

export function normalizeEventRow(row: CommunityEventRow): Event {
  return {
    id: row.id,
    communityId: row.community_id,
    eventKind: row.event_kind,
    title: row.title,
    subtitle: row.subtitle,
    shortDescription: row.short_description,
    description: row.description,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    timezone: row.timezone,
    locationName: row.location_name,
    address: row.address,
    latitude: row.latitude,
    longitude: row.longitude,
    imageUrl: row.image_url,
    category: row.category,
    audience: row.audience,
    visibility: row.visibility,
    status: row.status,
    sourceType: row.source_type,
    sourceUrl: row.source_url,
    registrationMode: row.registration_mode,
    registrationUrl: row.registration_url,
    capacity: row.capacity,
    waitlistEnabled: row.waitlist_enabled,
    requiresApproval: row.requires_approval,
    priceAmount: row.price_amount,
    priceCurrency: row.price_currency,
    publishedAt: row.published_at,
    isPermanent: Boolean(row.is_permanent),
  };
}

export async function listPublishedEvents(): Promise<Event[]> {
  const { data, error } = await supabase
    .from('events')
    .select(EVENT_FIELDS)
    .eq('status', 'published')
    .order('starts_at', { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  return ((data ?? []) as CommunityEventRow[]).map(normalizeEventRow);
}

export async function getEventById(id: string): Promise<Event | null> {
  const { data, error } = await supabase
    .from('events')
    .select(EVENT_FIELDS)
    .eq('id', id)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return data ? normalizeEventRow(data as CommunityEventRow) : null;
}
