export type EventOccurrenceStatus =
  | 'active'
  | 'hidden'
  | 'cancelled'
  | 'archived';

export type EventOccurrenceRow = {
  id: string;
  event_id: string;
  title: string | null;
  starts_at: string;
  ends_at: string | null;
  timezone: string;
  registration_opens_at: string | null;
  registration_closes_at: string | null;
  capacity: number | null;
  waitlist_enabled: boolean | null;
  requires_approval: boolean | null;
  status: EventOccurrenceStatus | string;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

export type EventOccurrence = {
  id: string;
  eventId: string;
  title: string | null;
  startsAt: string;
  endsAt: string | null;
  timezone: string;
  registrationOpensAt: string | null;
  registrationClosesAt: string | null;
  capacity: number | null;
  waitlistEnabled: boolean | null;
  requiresApproval: boolean | null;
  status: EventOccurrenceStatus | string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};
