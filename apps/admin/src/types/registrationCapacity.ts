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

export type AdminRegistrationCapacityStatusCounts = {
  confirmed: number;
  pending: number;
  waitlisted: number;
  cancelled: number;
  rejected: number;
  attended: number;
  no_show: number;
};

export type AdminRegistrationCapacityOptionStat = {
  optionId: string | null;
  title: string;
  optionType: string;
  registrationsCount: number;
  quantity: number;
  seatsCount: number;
  isDonation: boolean;
  countsTowardCapacity: boolean;
};

export type AdminRegistrationCapacityBucketOptionBreakdown = {
  optionId: string | null;
  title: string;
  registrationsCount: number;
  quantity: number;
  seatsCount: number;
  isDonation: boolean;
  countsTowardCapacity: boolean;
};

export type AdminRegistrationCapacityBucket = {
  capacityUnitId: string;
  key: string;
  code?: string;
  title: string;
  capacity: number | null;
  effectiveCapacity?: number | null;
  occupiedSeats: number;
  remainingSeats: number | null;
  freeSeats?: number | null;
  effectiveRemainingSeats?: number | null;
  fillPercent: number | null;
  effectiveFillPercent?: number | null;
  effectiveFreePercent?: number | null;
  reservationsCount: number;
  optionTitles: string[];
  optionBreakdown?: AdminRegistrationCapacityBucketOptionBreakdown[];
  isUnlimited: boolean;
  usesFallbackCapacity?: boolean;
};

export type AdminRegistrationCapacityBucketAggregate = {
  occupiedSeats: number;
  knownCapacity: number;
  remainingSeats: number;
  fillPercent: number | null;
  freePercent: number | null;
  limitedBucketCount: number;
  hasUnlimitedBuckets: boolean;
};

export type AdminRegistrationCapacityTotals = {
  totalRegistrations: number;
  totalRegistrationsCount: number;
  statusCounts: AdminRegistrationCapacityStatusCounts;
  confirmedCount: number;
  pendingCount: number;
  waitlistedCount: number;
  cancelledCount: number;
  rejectedCount: number;
  attendedCount: number;
  noShowCount: number;
  activeRegistrationsCount: number;
  activeSeatsCount: number;
  uniqueRegisteredUsersCount: number;
  uniqueGuestsCount: number;
  uniquePeopleCount: number;
  multiMealGuestsCount: number;
  sponsorsDonationsCount: number;
  donationsCount: number;
  donationQuantity: number;
  donationRegistrationsCount: number;
  capacity: number | null;
  remainingSeats: number | null;
  freeSeats: number | null;
  fillPercent: number | null;
  freePercent: number | null;
};

export type AdminRegistrationCapacityAnalytics = {
  eventId: string;
  occurrenceId: string | null;
  totals: AdminRegistrationCapacityTotals;
  bucketAggregate: AdminRegistrationCapacityBucketAggregate;
  buckets: AdminRegistrationCapacityBucket[];
  optionStats: AdminRegistrationCapacityOptionStat[];
  donationOptions: AdminRegistrationCapacityOptionStat[];
};

export type AdminRegistrationCapacityAnalyticsRpcRow = {
  event_id: string;
  occurrence_id: string | null;
  totals: unknown;
  bucket_aggregate: unknown;
  buckets: unknown;
  option_stats: unknown;
  donation_options: unknown;
};

export type ListAdminRegistrationCapacityBucketsParams = {
  eventId: string;
  occurrenceId: string | null;
};
