import type { EventOccurrence } from './eventOccurrence';

export type EventRegistrationMode =
  | 'none'
  | 'external_link'
  | 'internal_free'
  | 'internal_paid';

export type EventKind =
  | 'single'
  | 'course'
  | 'sunday_school'
  | 'shabbat'
  | 'holiday'
  | 'announcement';

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

export const DUPLICATE_BLOCKING_EVENT_REGISTRATION_STATUSES: EventRegistrationStatus[] = [
  'pending',
  'confirmed',
  'waitlisted',
  'attended',
];

export interface Event {
  id: string;
  communityId: string;
  eventKind: EventKind | string | null;
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
  isPermanent: boolean;
  nextOccurrence?: EventOccurrence | null;
  effectiveStartsAt?: string | null;
  effectiveEndsAt?: string | null;
  hasOccurrences?: boolean;
}

export interface EventRegistrationOccurrence {
  id: string;
  eventId: string;
  title: string | null;
  startsAt: string;
  endsAt: string | null;
  timezone: string | null;
}

export interface EventRegistrationSelectedOptionSnapshot {
  id: string;
  optionId: string | null;
  title: string;
  name: string;
  description: string | null;
  optionType: string;
  quantity: number;
  unitAmount: number;
  unitPriceAmount: number;
  totalAmount: number;
  currency: string;
  countsTowardCapacity: boolean;
  seatsCount: number;
  isDonation: boolean;
  createdAt: string | null;
}

export interface RegisterForEventOccurrenceOptionSelectionInput {
  optionId: string;
  quantity: number;
}

export interface RegisterForEventOccurrenceWithOptionsInput {
  eventId: string;
  occurrenceId: string;
  optionSelections?: RegisterForEventOccurrenceOptionSelectionInput[] | null;
  comment?: string | null;
}

export interface EventRegistration {
  id: string;
  eventId: string;
  occurrenceId: string | null;
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
  occurrence?: EventRegistrationOccurrence;
  selectedOptions: EventRegistrationSelectedOptionSnapshot[];
  totalAmount: number | null;
  totalCurrency: string | null;
}

export interface EventItem {
  id: string;
  communityId: string;
  eventKind?: EventKind | string | null;
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
  isPermanent?: boolean;
  nextOccurrence?: EventOccurrence | null;
  effectiveStartsAt?: string | null;
  effectiveEndsAt?: string | null;
  hasOccurrences?: boolean;
}
