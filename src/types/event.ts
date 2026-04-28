export type EventCategory = 'Курс' | 'Клуб' | 'Для детей' | 'Праздник';

export type EventRegistrationMode =
  | 'none'
  | 'external_link'
  | 'internal_free'
  | 'internal_paid';

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
}

export interface EventItem {
  id: string;
  title: string;
  date?: string;
  category: EventCategory;
  tagColor: string;
  imageIcon: string;
  featured?: boolean;
  subtitle?: string;
  registrationMode: EventRegistrationMode;
  registrationUrl?: string;
  sourceUrl?: string;
  capacity?: number;
}
