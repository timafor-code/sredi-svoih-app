export const PARTICIPATION_OPTION_TYPES = [
  "participation",
  "meal",
  "package",
  "donation",
  "child",
  "family",
  "other",
] as const;

export type ParticipationOptionType = (typeof PARTICIPATION_OPTION_TYPES)[number];

export type ParticipationOptionRow = {
  id: string;
  event_id: string;
  title: string;
  description: string | null;
  price_amount: number;
  price_currency: string;
  option_type: ParticipationOptionType | string;
  seat_limit: number | null;
  allow_quantity: boolean;
  min_quantity: number;
  max_quantity: number;
  is_donation: boolean;
  counts_toward_capacity: boolean;
  group_key: string | null;
  conflicts_with: unknown;
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type ParticipationOption = {
  id: string;
  eventId: string;
  title: string;
  description: string | null;
  priceAmount: number;
  priceCurrency: string;
  optionType: ParticipationOptionType | string;
  seatLimit: number | null;
  allowQuantity: boolean;
  minQuantity: number;
  maxQuantity: number;
  isDonation: boolean;
  countsTowardCapacity: boolean;
  groupKey: string | null;
  conflictsWith: string[];
  sortOrder: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type ParticipationOptionInput = {
  title: string;
  description: string | null;
  priceAmount: number;
  priceCurrency: string;
  optionType: ParticipationOptionType;
  seatLimit: number | null;
  allowQuantity: boolean;
  minQuantity: number;
  maxQuantity: number;
  isDonation: boolean;
  countsTowardCapacity: boolean;
  groupKey: string | null;
  conflictsWith: string[];
  sortOrder: number;
  isActive: boolean;
};
