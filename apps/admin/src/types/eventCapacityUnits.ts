export type AdminEventCapacityUnitRow = {
  id: string;
  event_id: string;
  key: string;
  title: string;
  description: string | null;
  capacity: number | null;
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type AdminEventCapacityUnit = {
  id: string;
  eventId: string;
  key: string;
  title: string;
  description: string | null;
  capacity: number | null;
  sortOrder: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type AdminEventCapacityUnitInput = {
  id?: string | null;
  key: string;
  title: string;
  description: string | null;
  capacity: number | null;
  sortOrder: number;
  isActive: boolean;
};

export type AdminOptionCapacityUnitMappingRow = {
  id: string;
  event_id: string;
  option_id: string;
  capacity_unit_id: string;
  seats_per_quantity: number;
  created_at: string;
};

export type AdminOptionCapacityUnitMapping = {
  id: string;
  eventId: string;
  optionId: string;
  capacityUnitId: string;
  seatsPerQuantity: number;
  createdAt: string;
};

export type AdminOptionCapacityUnitMappingInput = {
  optionId: string;
  capacityUnitId: string;
  seatsPerQuantity: number;
};
