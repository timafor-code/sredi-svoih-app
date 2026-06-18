import {
  normalizeEventCapacityUnitRow,
} from "./adminEventCapacityUnitsService";
import { requireSupabaseClient } from "./supabaseClient";
import type {
  AdminEventCapacityUnit,
  AdminEventCapacityUnitRow,
} from "../types/eventCapacityUnits";

type SupabaseSelectError = {
  message?: string;
  details?: string | null;
  hint?: string | null;
};

function formatSupabaseError(action: string, error: SupabaseSelectError): string {
  const details = [error.message, error.details, error.hint].filter(Boolean).join(" ");
  return `${action} failed: ${details || "Unknown Supabase error"}`;
}

function normalizeNewCapacity(value: number | null): number | null {
  if (value === null) {
    return null;
  }

  if (!Number.isFinite(value)) {
    throw new Error("Capacity limit must be a finite number.");
  }

  const normalized = Math.round(value);

  if (normalized <= 0) {
    throw new Error("Capacity limit must be greater than 0.");
  }

  return normalized;
}

export async function updateCapacityUnitLimit(
  capacityUnitId: string,
  newCapacity: number | null,
): Promise<AdminEventCapacityUnit> {
  const normalizedCapacityUnitId = capacityUnitId.trim();

  if (!normalizedCapacityUnitId) {
    throw new Error("Capacity unit id is required.");
  }

  const supabase = requireSupabaseClient();
  const { data, error } = await supabase.rpc("admin_update_capacity_unit_limit", {
    capacity_unit_id: normalizedCapacityUnitId,
    new_capacity: normalizeNewCapacity(newCapacity),
  });

  if (error) {
    throw new Error(formatSupabaseError("Update capacity unit limit", error));
  }

  const row = (Array.isArray(data) ? data[0] : data) as
    | Partial<AdminEventCapacityUnitRow>
    | null
    | undefined;

  if (!row) {
    throw new Error("Update capacity unit limit failed: RPC returned no row.");
  }

  return normalizeEventCapacityUnitRow(row);
}
