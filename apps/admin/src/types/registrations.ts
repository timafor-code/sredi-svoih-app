import type {
  AdminEventKind,
  AdminEventRegistrationMode,
} from "./events";

export const ADMIN_REGISTRATION_STATUSES = [
  "pending",
  "confirmed",
  "waitlisted",
  "cancelled",
  "rejected",
  "attended",
  "no_show",
] as const;

export type AdminRegistrationStatus =
  (typeof ADMIN_REGISTRATION_STATUSES)[number];

export type AdminRegistrationStatusUpdate = Exclude<
  AdminRegistrationStatus,
  "attended" | "no_show"
>;

export type AdminRegistrationAttendanceStatus = Extract<
  AdminRegistrationStatus,
  "attended" | "no_show"
>;

export type AdminRegistrationEventSummaryRpcRow = {
  event_id: string;
  title: string;
  starts_at: string | null;
  event_kind: AdminEventKind | string;
  registration_mode: AdminEventRegistrationMode | string;
  capacity: number | string | null;
  occurrence_count: number | string | null;
  confirmed_count: number | string | null;
  pending_count: number | string | null;
  waitlisted_count: number | string | null;
  cancelled_count: number | string | null;
  rejected_count: number | string | null;
  attended_count: number | string | null;
  no_show_count: number | string | null;
};

export type AdminRegistrationEventSummary = {
  eventId: string;
  title: string;
  startsAt: string | null;
  eventKind: AdminEventKind | string;
  registrationMode: AdminEventRegistrationMode | string;
  capacity: number | null;
  occurrenceCount: number;
  confirmedCount: number;
  pendingCount: number;
  waitlistedCount: number;
  cancelledCount: number;
  rejectedCount: number;
  attendedCount: number;
  noShowCount: number;
};

export type AdminRegistrationOptionSelectionSummary = {
  id: string;
  optionId: string | null;
  title: string;
  description: string | null;
  optionType: string;
  quantity: number;
  unitPriceAmount: number;
  totalAmount: number;
  currency: string;
  countsTowardCapacity: boolean;
  seatsCount: number;
  isDonation: boolean;
  createdAt: string;
};

export type AdminEventRegistrationRpcRow = {
  id: string;
  event_id: string;
  occurrence_id: string | null;
  user_id: string;
  participant_display_name: string | null;
  email: string | null;
  phone: string | null;
  status: AdminRegistrationStatus | string;
  seats_count: number | string | null;
  guest_names: unknown;
  comment: string | null;
  payment_status: string | null;
  payment_id: string | null;
  registered_at: string;
  confirmed_at: string | null;
  cancelled_at: string | null;
  occurrence_starts_at: string | null;
  occurrence_ends_at: string | null;
  occurrence_title: string | null;
  selected_options: unknown;
  total_amount: number | string | null;
  created_at: string;
  updated_at: string;
};

export type AdminEventRegistrationRow = {
  id: string;
  eventId: string;
  occurrenceId: string | null;
  userId: string;
  participantDisplayName: string;
  email: string | null;
  phone: string | null;
  status: AdminRegistrationStatus | string;
  seatsCount: number;
  guestNames: string[];
  comment: string | null;
  paymentStatus: string;
  paymentId: string | null;
  registeredAt: string;
  confirmedAt: string | null;
  cancelledAt: string | null;
  occurrenceStartsAt: string | null;
  occurrenceEndsAt: string | null;
  occurrenceTitle: string | null;
  selectedOptions: AdminRegistrationOptionSelectionSummary[];
  totalAmount: number | null;
  createdAt: string;
  updatedAt: string;
};

export type ListEventRegistrationsParams = {
  eventId: string;
  occurrenceId?: string | null;
  status?: AdminRegistrationStatus | "all" | null;
  search?: string | null;
  limit?: number | null;
  offset?: number | null;
};
