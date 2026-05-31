export type AdminRegistrationCapacityBucketRow = {
  id: string;
  event_id: string;
  key: string;
  title: string;
  description: string | null;
  capacity: number | string | null;
  sort_order: number | string | null;
  is_active: boolean;
  created_at: string;
};

export type AdminRegistrationCapacityReservationRow = {
  id: string;
  registration_id: string;
  event_id: string;
  occurrence_id: string | null;
  capacity_unit_id: string;
  option_id: string | null;
  capacity_unit_key_snapshot: string;
  capacity_unit_title_snapshot: string;
  option_title_snapshot: string | null;
  quantity: number | string | null;
  seats_per_quantity: number | string | null;
  seats_count: number | string | null;
  created_at: string;
};

export type AdminRegistrationCapacityRegistrationStatusRow = {
  id: string;
  status: string;
};

export type AdminRegistrationCapacityBucket = {
  capacityUnitId: string;
  key: string;
  title: string;
  capacity: number | null;
  occupiedSeats: number;
  remainingSeats: number | null;
  fillPercent: number | null;
  reservationsCount: number;
  optionTitles: string[];
  isUnlimited: boolean;
};

export type ListAdminRegistrationCapacityBucketsParams = {
  eventId: string;
  occurrenceId: string | null;
};
