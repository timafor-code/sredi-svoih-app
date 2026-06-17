// Minimal thin wrappers over the seating write RPC (block B, PR 8).
//
// This is deliberately NOT the full typed service layer — that arrives in PR 10
// (feature/admin-seating-service-types) together with the SeatingLayout /
// SeatingTemplate / SeatingAssignment types. The wrappers here exist only so the
// write RPC has a typed call site for typecheck and docs. They pass the v15
// payload contract straight through and return the raw RPC result.
//
// The browser uses the normal authenticated Supabase session; every function
// below maps to a SECURITY DEFINER RPC that enforces role, single-community
// scope and the seating validations. No service role, no Admin API.

import { requireSupabaseClient } from "./supabaseClient";

type SupabaseRpcError = {
  message?: string;
  details?: string | null;
  hint?: string | null;
};

function formatRpcError(action: string, error: SupabaseRpcError): string {
  const details = [error.message, error.details, error.hint].filter(Boolean).join(" ");
  return `${action} failed: ${details || "Unknown Supabase error"}`;
}

// v15 payload contract plus the routing keys that identify the capacity slot.
// Kept intentionally loose here; the strict types land in PR 10.
export type SeatingLayoutSavePayload = {
  eventId: string;
  occurrenceId?: string | null;
  capacityUnitId: string;
  layout?: string;
  customTables?: unknown[];
  tableConnections?: unknown[];
  selectedTableId?: string | null;
  seatingDone?: boolean;
  activeTemplateId?: string | null;
  reserveIds?: unknown[];
  capacity?: number | null;
  chairs?: unknown[];
  pool?: unknown[];
};

export type SeatingAssignmentsSavePayload = {
  eventId: string;
  occurrenceId?: string | null;
  capacityUnitId: string;
  chairs?: unknown[];
  pool?: unknown[];
  reserveIds?: unknown[];
};

export type SeatingAssignmentsSaveResult = {
  layoutId: string;
  placedCount: number;
  pooledCount: number;
  reserveCount: number;
};

// admin_save_seating_layout — saves geometry only (layout row, tables,
// connections, template_id, server-derived capacity_limit_snapshot). Never
// touches assignments or the real capacity unit limit.
export async function saveAdminSeatingLayout(
  payload: SeatingLayoutSavePayload,
): Promise<unknown> {
  const supabase = requireSupabaseClient();
  const { data, error } = await supabase.rpc("admin_save_seating_layout", {
    payload,
  });

  if (error) {
    throw new Error(formatRpcError("Save seating layout", error));
  }

  return data;
}

// admin_save_seating_assignments — saves guest / reserve assignments from
// chairs[] (placed) and pool[] (unplaced).
export async function saveAdminSeatingAssignments(
  payload: SeatingAssignmentsSavePayload,
): Promise<SeatingAssignmentsSaveResult> {
  const supabase = requireSupabaseClient();
  const { data, error } = await supabase.rpc("admin_save_seating_assignments", {
    payload,
  });

  if (error) {
    throw new Error(formatRpcError("Save seating assignments", error));
  }

  return data as SeatingAssignmentsSaveResult;
}

// admin_create_seating_template_from_layout — copies geometry only into a new
// community-scoped template snapshot.
export async function createAdminSeatingTemplateFromLayout(
  layoutId: string,
  title: string,
): Promise<unknown> {
  const supabase = requireSupabaseClient();
  const { data, error } = await supabase.rpc(
    "admin_create_seating_template_from_layout",
    {
      p_layout_id: layoutId,
      p_title: title,
    },
  );

  if (error) {
    throw new Error(formatRpcError("Create seating template", error));
  }

  return data;
}

// admin_delete_seating_template — soft delete (is_active = false); built-in
// templates are rejected by the RPC.
export async function deleteAdminSeatingTemplate(
  templateId: string,
): Promise<unknown> {
  const supabase = requireSupabaseClient();
  const { data, error } = await supabase.rpc("admin_delete_seating_template", {
    p_template_id: templateId,
  });

  if (error) {
    throw new Error(formatRpcError("Delete seating template", error));
  }

  return data;
}

// admin_create_seating_layout_from_template — forks a new layout instance for
// the slot from a template snapshot (tables / connections only, no assignments).
export async function createAdminSeatingLayoutFromTemplate(
  eventId: string,
  occurrenceId: string | null,
  capacityUnitId: string,
  templateId: string,
): Promise<unknown> {
  const supabase = requireSupabaseClient();
  const { data, error } = await supabase.rpc(
    "admin_create_seating_layout_from_template",
    {
      p_event_id: eventId,
      p_occurrence_id: occurrenceId,
      p_capacity_unit_id: capacityUnitId,
      p_template_id: templateId,
    },
  );

  if (error) {
    throw new Error(formatRpcError("Create seating layout from template", error));
  }

  return data;
}
