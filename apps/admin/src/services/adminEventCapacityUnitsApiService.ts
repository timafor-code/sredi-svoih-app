import { apiClient } from "./apiClient";
import {
  listAdminEventParticipationOptionRows,
  replaceAdminEventParticipationOptionRows,
  toParticipationOptionApiPayloadFromRow,
  type AdminParticipationOptionCapacityUnitPayloadSource,
} from "./adminParticipationOptionsApiService";
import {
  normalizeEventCapacityUnitRow,
  normalizeOptionCapacityUnitMappingRow,
} from "./adminEventCapacityUnitsService";
import type { AdminApiEventCapacityUnitResponse } from "../types/api";
import type {
  AdminEventCapacityUnit,
  AdminEventCapacityUnitInput,
  AdminOptionCapacityUnitMapping,
  AdminOptionCapacityUnitMappingInput,
} from "../types/eventCapacityUnits";

type AdminEventCapacityUnitApiPayload = {
  id?: string | null;
  key: string;
  title: string;
  description: string | null;
  capacity: number | null;
  sort_order: number;
  is_active: boolean;
};

function normalizeAdminApiEventCapacityUnit(
  row: AdminApiEventCapacityUnitResponse,
): AdminEventCapacityUnit {
  return normalizeEventCapacityUnitRow(row);
}

function toUnitApiPayload(
  input: AdminEventCapacityUnitInput,
): AdminEventCapacityUnitApiPayload {
  return {
    id: input.id ?? null,
    key: input.key,
    title: input.title,
    description: input.description,
    capacity: input.capacity,
    sort_order: input.sortOrder,
    is_active: input.isActive,
  };
}

function mappingPayloadsByOptionId(
  rows: AdminOptionCapacityUnitMappingInput[],
): Map<string, AdminParticipationOptionCapacityUnitPayloadSource[]> {
  const mappingsByOptionId = new Map<
    string,
    AdminParticipationOptionCapacityUnitPayloadSource[]
  >();

  rows.forEach((row) => {
    const mappings = mappingsByOptionId.get(row.optionId) ?? [];
    mappings.push({
      capacity_unit_id: row.capacityUnitId,
      seats_per_quantity: row.seatsPerQuantity,
    });
    mappingsByOptionId.set(row.optionId, mappings);
  });

  return mappingsByOptionId;
}

export async function listAdminEventCapacityUnits(
  eventId: string,
): Promise<AdminEventCapacityUnit[]> {
  const units = await apiClient.get<AdminApiEventCapacityUnitResponse[]>(
    `/admin/events/${encodeURIComponent(eventId)}/capacity-units`,
  );

  return units.map(normalizeAdminApiEventCapacityUnit);
}

export async function replaceAdminEventCapacityUnits(
  eventId: string,
  units: AdminEventCapacityUnitInput[],
): Promise<AdminEventCapacityUnit[]> {
  const response = await apiClient.put<
    AdminApiEventCapacityUnitResponse[],
    { capacity_units: AdminEventCapacityUnitApiPayload[] }
  >(
    `/admin/events/${encodeURIComponent(eventId)}/capacity-units`,
    { capacity_units: units.map(toUnitApiPayload) },
  );

  return response.map(normalizeAdminApiEventCapacityUnit);
}

export async function listAdminOptionCapacityUnitMappings(
  eventId: string,
): Promise<AdminOptionCapacityUnitMapping[]> {
  const options = await listAdminEventParticipationOptionRows(eventId);

  return options
    .flatMap((option) => option.capacity_units ?? [])
    .map(normalizeOptionCapacityUnitMappingRow);
}

export async function replaceAdminOptionCapacityUnitMappings(
  eventId: string,
  mappings: AdminOptionCapacityUnitMappingInput[],
): Promise<AdminOptionCapacityUnitMapping[]> {
  const options = await listAdminEventParticipationOptionRows(eventId);
  const optionIds = new Set(options.map((option) => option.id));
  const unknownMapping = mappings.find((mapping) => !optionIds.has(mapping.optionId));

  if (unknownMapping) {
    throw new Error(
      "Replace option capacity unit mappings failed: participation option does not belong to this event.",
    );
  }

  const mappingsByOptionId = mappingPayloadsByOptionId(mappings);
  const response = await replaceAdminEventParticipationOptionRows(
    eventId,
    options.map((option) =>
      toParticipationOptionApiPayloadFromRow(
        option,
        mappingsByOptionId.get(option.id) ?? [],
      ),
    ),
  );

  return response
    .flatMap((option) => option.capacity_units ?? [])
    .map(normalizeOptionCapacityUnitMappingRow);
}
