import { isAdminApiProviderEnabled } from "./apiClient";
import {
  listAdminEventCapacityUnits as listAdminEventCapacityUnitsViaApi,
  listAdminOptionCapacityUnitMappings as listAdminOptionCapacityUnitMappingsViaApi,
  replaceAdminEventCapacityUnits as replaceAdminEventCapacityUnitsViaApi,
  replaceAdminOptionCapacityUnitMappings as replaceAdminOptionCapacityUnitMappingsViaApi,
} from "./adminEventCapacityUnitsApiService";
import { requireSupabaseClient } from "./supabaseClient";
import type {
  AdminEventCapacityUnit,
  AdminEventCapacityUnitInput,
  AdminEventCapacityUnitRow,
  AdminOptionCapacityUnitMapping,
  AdminOptionCapacityUnitMappingInput,
  AdminOptionCapacityUnitMappingRow,
} from "../types/eventCapacityUnits";

type SupabaseSelectError = {
  message?: string;
  details?: string | null;
  hint?: string | null;
};

type EventCapacityUnitRpcPayload = {
  id: string | null;
  key: string;
  title: string;
  description: string | null;
  capacity: number | null;
  sortOrder: number;
  isActive: boolean;
};

type OptionCapacityUnitMappingRpcPayload = {
  optionId: string;
  capacityUnitId: string;
  seatsPerQuantity: number;
};

const OPTION_CAPACITY_UNIT_MAPPING_FIELDS = `
  id,
  event_id,
  option_id,
  capacity_unit_id,
  seats_per_quantity,
  created_at
`;

function formatSupabaseError(action: string, error: SupabaseSelectError): string {
  const details = [error.message, error.details, error.hint].filter(Boolean).join(" ");
  return `${action} failed: ${details || "Unknown Supabase error"}`;
}

function nullableString(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  return typeof value === "string" ? value : String(value);
}

function nullableNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function safeNumber(value: unknown, fallback: number): number {
  return nullableNumber(value) ?? fallback;
}

export function normalizeEventCapacityUnitRow(
  row: Partial<AdminEventCapacityUnitRow>,
): AdminEventCapacityUnit {
  return {
    id: nullableString(row.id) ?? "",
    eventId: nullableString(row.event_id) ?? "",
    key: nullableString(row.key) ?? "",
    title: nullableString(row.title) ?? "",
    description: nullableString(row.description),
    capacity: nullableNumber(row.capacity),
    sortOrder: safeNumber(row.sort_order, 0),
    isActive: row.is_active !== false,
    createdAt: nullableString(row.created_at) ?? "",
    updatedAt: nullableString(row.updated_at) ?? "",
  };
}

export function normalizeOptionCapacityUnitMappingRow(
  row: Partial<AdminOptionCapacityUnitMappingRow>,
): AdminOptionCapacityUnitMapping {
  return {
    id: nullableString(row.id) ?? "",
    eventId: nullableString(row.event_id) ?? "",
    optionId: nullableString(row.option_id) ?? "",
    capacityUnitId: nullableString(row.capacity_unit_id) ?? "",
    seatsPerQuantity: safeNumber(row.seats_per_quantity, 1),
    createdAt: nullableString(row.created_at) ?? "",
  };
}

function toUnitRpcPayload(
  input: AdminEventCapacityUnitInput,
): EventCapacityUnitRpcPayload {
  return {
    id: input.id ?? null,
    key: input.key,
    title: input.title,
    description: input.description,
    capacity: input.capacity,
    sortOrder: input.sortOrder,
    isActive: input.isActive,
  };
}

function toMappingRpcPayload(
  input: AdminOptionCapacityUnitMappingInput,
): OptionCapacityUnitMappingRpcPayload {
  return {
    optionId: input.optionId,
    capacityUnitId: input.capacityUnitId,
    seatsPerQuantity: input.seatsPerQuantity,
  };
}

export async function listAdminEventCapacityUnits(
  eventId: string,
): Promise<AdminEventCapacityUnit[]> {
  if (isAdminApiProviderEnabled("events")) {
    return listAdminEventCapacityUnitsViaApi(eventId);
  }

  const supabase = requireSupabaseClient();
  const { data, error } = await supabase.rpc("admin_list_event_capacity_units", {
    p_event_id: eventId,
  });

  if (error) {
    throw new Error(formatSupabaseError("List event capacity units", error));
  }

  return ((data ?? []) as AdminEventCapacityUnitRow[]).map(
    normalizeEventCapacityUnitRow,
  );
}

export async function replaceAdminEventCapacityUnits(
  eventId: string,
  units: AdminEventCapacityUnitInput[],
): Promise<AdminEventCapacityUnit[]> {
  if (isAdminApiProviderEnabled("events")) {
    return replaceAdminEventCapacityUnitsViaApi(eventId, units);
  }

  const supabase = requireSupabaseClient();
  const payload = units.map(toUnitRpcPayload);
  const { data, error } = await supabase.rpc("admin_replace_event_capacity_units", {
    p_event_id: eventId,
    p_units: payload,
  });

  if (error) {
    throw new Error(formatSupabaseError("Replace event capacity units", error));
  }

  return ((data ?? []) as AdminEventCapacityUnitRow[]).map(
    normalizeEventCapacityUnitRow,
  );
}

export async function listAdminOptionCapacityUnitMappings(
  eventId: string,
): Promise<AdminOptionCapacityUnitMapping[]> {
  if (isAdminApiProviderEnabled("events")) {
    return listAdminOptionCapacityUnitMappingsViaApi(eventId);
  }

  const supabase = requireSupabaseClient();
  const { data, error } = await supabase
    .from("event_participation_option_capacity_units")
    .select(OPTION_CAPACITY_UNIT_MAPPING_FIELDS)
    .eq("event_id", eventId)
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(formatSupabaseError("List option capacity unit mappings", error));
  }

  return ((data ?? []) as AdminOptionCapacityUnitMappingRow[]).map(
    normalizeOptionCapacityUnitMappingRow,
  );
}

export async function replaceAdminOptionCapacityUnitMappings(
  eventId: string,
  mappings: AdminOptionCapacityUnitMappingInput[],
): Promise<AdminOptionCapacityUnitMapping[]> {
  if (isAdminApiProviderEnabled("events")) {
    return replaceAdminOptionCapacityUnitMappingsViaApi(eventId, mappings);
  }

  const supabase = requireSupabaseClient();
  const payload = mappings.map(toMappingRpcPayload);
  const { data, error } = await supabase.rpc("admin_replace_option_capacity_units", {
    p_event_id: eventId,
    p_mappings: payload,
  });

  if (error) {
    throw new Error(formatSupabaseError("Replace option capacity unit mappings", error));
  }

  return ((data ?? []) as AdminOptionCapacityUnitMappingRow[]).map(
    normalizeOptionCapacityUnitMappingRow,
  );
}
