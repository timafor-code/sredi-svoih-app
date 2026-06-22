export const ADMIN_EVENT_OCCURRENCE_STATUSES = [
  "active",
  "hidden",
  "cancelled",
  "archived",
] as const;

export type AdminEventOccurrenceStatus =
  (typeof ADMIN_EVENT_OCCURRENCE_STATUSES)[number];

export const ADMIN_EVENT_OCCURRENCE_REGISTRATION_STATES = [
  "open",
  "not_yet_open",
  "closed",
  "unavailable",
] as const;

export type AdminEventOccurrenceRegistrationState =
  (typeof ADMIN_EVENT_OCCURRENCE_REGISTRATION_STATES)[number];

export type AdminEventOccurrenceRow = {
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
  status: AdminEventOccurrenceStatus | string;
  sort_order: number;
  created_at: string;
  updated_at: string;
  server_now?: string | null;
  is_registration_always_open?: boolean | null;
  registration_state?: AdminEventOccurrenceRegistrationState | string | null;
  registration_state_reason?: string | null;
};

export type AdminEventOccurrence = {
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
  status: AdminEventOccurrenceStatus | string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  serverNow: string | null;
  isRegistrationAlwaysOpen: boolean;
  registrationState: AdminEventOccurrenceRegistrationState;
  registrationStateReason: string | null;
};

export type AdminEventOccurrenceInput = {
  id: string | null;
  title: string | null;
  startsAt: string;
  endsAt: string | null;
  timezone: string;
  registrationOpensAt: string | null;
  registrationClosesAt: string | null;
  capacity: number | null;
  waitlistEnabled: boolean | null;
  requiresApproval: boolean | null;
  status: AdminEventOccurrenceStatus;
  sortOrder: number;
};
