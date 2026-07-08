import { apiClient } from "./apiClient";
import { normalizeParticipationOptionRow } from "./adminParticipationOptionsService";
import type {
  AdminApiOptionCapacityUnitMappingResponse,
  AdminApiParticipationOptionResponse,
} from "../types/api";
import type {
  ParticipationOption,
  ParticipationOptionInput,
} from "../types/participationOptions";

export type AdminParticipationOptionApiPayload = {
  id?: string | null;
  title: string;
  description: string | null;
  price_amount: number;
  price_currency: string;
  option_type: string;
  seat_limit: number | null;
  allow_quantity: boolean;
  min_quantity: number;
  max_quantity: number;
  is_donation: boolean;
  counts_toward_capacity: boolean;
  group_key: string | null;
  conflicts_with: string[];
  sort_order: number;
  is_active: boolean;
  capacity_units: Array<{
    capacity_unit_id: string;
    seats_per_quantity: number;
  }>;
};

export type AdminParticipationOptionCapacityUnitPayloadSource = Pick<
  AdminApiOptionCapacityUnitMappingResponse,
  "capacity_unit_id" | "seats_per_quantity"
>;

export async function listAdminEventParticipationOptionRows(
  eventId: string,
): Promise<AdminApiParticipationOptionResponse[]> {
  return apiClient.get<AdminApiParticipationOptionResponse[]>(
    `/admin/events/${encodeURIComponent(eventId)}/participation-options`,
  );
}

export function normalizeAdminApiParticipationOption(
  row: AdminApiParticipationOptionResponse,
): ParticipationOption {
  return normalizeParticipationOptionRow(row);
}

export function toParticipationOptionApiPayload(
  input: ParticipationOptionInput,
  capacityUnits: AdminParticipationOptionCapacityUnitPayloadSource[] = [],
): AdminParticipationOptionApiPayload {
  return {
    id: input.id ?? null,
    title: input.title,
    description: input.description,
    price_amount: input.priceAmount,
    price_currency: input.priceCurrency,
    option_type: input.optionType,
    seat_limit: input.seatLimit,
    allow_quantity: input.allowQuantity,
    min_quantity: input.minQuantity,
    max_quantity: input.maxQuantity,
    is_donation: input.isDonation,
    counts_toward_capacity: input.countsTowardCapacity,
    group_key: input.groupKey,
    conflicts_with: input.conflictsWith,
    sort_order: input.sortOrder,
    is_active: input.isActive,
    capacity_units: capacityUnits.map((mapping) => ({
      capacity_unit_id: mapping.capacity_unit_id,
      seats_per_quantity: mapping.seats_per_quantity,
    })),
  };
}

export function toParticipationOptionApiPayloadFromRow(
  row: AdminApiParticipationOptionResponse,
  capacityUnits: AdminParticipationOptionCapacityUnitPayloadSource[] =
    row.capacity_units ?? [],
): AdminParticipationOptionApiPayload {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    price_amount: row.price_amount,
    price_currency: row.price_currency,
    option_type: row.option_type,
    seat_limit: row.seat_limit,
    allow_quantity: row.allow_quantity,
    min_quantity: row.min_quantity,
    max_quantity: row.max_quantity,
    is_donation: row.is_donation,
    counts_toward_capacity: row.counts_toward_capacity,
    group_key: row.group_key,
    conflicts_with: row.conflicts_with,
    sort_order: row.sort_order,
    is_active: row.is_active,
    capacity_units: capacityUnits.map((mapping) => ({
      capacity_unit_id: mapping.capacity_unit_id,
      seats_per_quantity: mapping.seats_per_quantity,
    })),
  };
}

export async function replaceAdminEventParticipationOptionRows(
  eventId: string,
  participationOptions: AdminParticipationOptionApiPayload[],
): Promise<AdminApiParticipationOptionResponse[]> {
  return apiClient.put<
    AdminApiParticipationOptionResponse[],
    { participation_options: AdminParticipationOptionApiPayload[] }
  >(
    `/admin/events/${encodeURIComponent(eventId)}/participation-options`,
    { participation_options: participationOptions },
  );
}

export async function listAdminEventParticipationOptions(
  eventId: string,
): Promise<ParticipationOption[]> {
  const options = await listAdminEventParticipationOptionRows(eventId);

  return options.map(normalizeAdminApiParticipationOption);
}

export async function replaceAdminEventParticipationOptions(
  eventId: string,
  options: ParticipationOptionInput[],
): Promise<ParticipationOption[]> {
  const response = await replaceAdminEventParticipationOptionRows(
    eventId,
    options.map((option) => toParticipationOptionApiPayload(option)),
  );

  return response.map(normalizeAdminApiParticipationOption);
}
