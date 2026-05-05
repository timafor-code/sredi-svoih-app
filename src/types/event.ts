export type EventRegistrationMode =
  | 'none'
  | 'external_link'
  | 'internal_free'
  | 'internal_paid';

export type EventVisibility = 'public' | 'members_only' | 'hidden';

export type EventStatus = 'draft' | 'published' | 'cancelled' | 'archived';

export type EventRegistrationStatus =
  | 'pending'
  | 'confirmed'
  | 'waitlisted'
  | 'cancelled'
  | 'rejected'
  | 'attended'
  | 'no_show';

export const ACTIVE_EVENT_REGISTRATION_STATUSES: EventRegistrationStatus[] = [
  'pending',
  'confirmed',
  'waitlisted',
];

export interface Event {
  id: string;
  communityId: string;
  title: string;
  subtitle: string | null;
  shortDescription: string | null;
  description: string | null;
  startsAt: string;
  endsAt: string | null;
  timezone: string | null;
  locationName: string | null;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  category: string | null;
  audience: string | null;
  visibility: EventVisibility;
  status: EventStatus;
  sourceType: string;
  sourceUrl: string | null;
  imageUrl: string | null;
  registrationMode: EventRegistrationMode;
  registrationUrl: string | null;
  capacity: number | null;
  waitlistEnabled: boolean;
  requiresApproval: boolean;
  priceAmount: number | null;
  priceCurrency: string | null;
  publishedAt: string | null;
}

export interface EventRegistration {
  id: string;
  eventId: string;
  userId: string;
  status: EventRegistrationStatus;
  seatsCount: number;
  guestNames: unknown[];
  comment: string | null;
  registeredAt: string;
  confirmedAt: string | null;
  cancelledAt: string | null;
  paymentStatus: string;
  paymentId: string | null;
  createdAt: string;
  updatedAt: string;
  event?: Event;
}

export interface EventItem {
  id: string;
  communityId: string;
  title: string;
  date?: string;
  category: string;
  tagColor: string;
  imageIcon: string;
  featured?: boolean;
  subtitle?: string;
  shortDescription?: string | null;
  description?: string | null;
  startsAt?: string;
  endsAt?: string | null;
  timezone?: string | null;
  locationName?: string | null;
  address?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  imageUrl?: string | null;
  rawCategory?: string | null;
  audience?: string | null;
  visibility?: EventVisibility;
  status?: EventStatus;
  sourceType?: string;
  registrationMode: EventRegistrationMode;
  registrationUrl?: string | null;
  sourceUrl?: string | null;
  capacity?: number | null;
  waitlistEnabled?: boolean;
  requiresApproval?: boolean;
  priceAmount?: number | null;
  priceCurrency?: string | null;
  publishedAt?: string | null;
}
