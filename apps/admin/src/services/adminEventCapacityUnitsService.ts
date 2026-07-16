import type {
  AdminEventCapacityUnit,
  AdminEventCapacityUnitRow,
  AdminOptionCapacityUnitMapping,
  AdminOptionCapacityUnitMappingRow,
} from "../types/eventCapacityUnits";

function string(value: unknown): string {
  return value == null ? "" : String(value);
}

function number(value: unknown, fallback: number | null = null): number | null {
  const result = typeof value === "number" ? value : Number(value);
  return Number.isFinite(result) ? result : fallback;
}

export function normalizeEventCapacityUnitRow(
  row: Partial<AdminEventCapacityUnitRow>,
): AdminEventCapacityUnit {
  return {
    id: string(row.id), eventId: string(row.event_id), key: string(row.key), title: string(row.title),
    description: row.description == null ? null : String(row.description), capacity: number(row.capacity),
    sortOrder: number(row.sort_order, 0) ?? 0, isActive: row.is_active !== false,
    createdAt: string(row.created_at), updatedAt: string(row.updated_at),
  };
}

export function normalizeOptionCapacityUnitMappingRow(
  row: Partial<AdminOptionCapacityUnitMappingRow>,
): AdminOptionCapacityUnitMapping {
  return {
    id: string(row.id), eventId: string(row.event_id), optionId: string(row.option_id),
    capacityUnitId: string(row.capacity_unit_id), seatsPerQuantity: number(row.seats_per_quantity, 1) ?? 1,
    createdAt: string(row.created_at),
  };
}

export {
  listAdminEventCapacityUnits,
  listAdminOptionCapacityUnitMappings,
  replaceAdminEventCapacityUnits,
  replaceAdminOptionCapacityUnitMappings,
} from "./adminEventCapacityUnitsApiService";
