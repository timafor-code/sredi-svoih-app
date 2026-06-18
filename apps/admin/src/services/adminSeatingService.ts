// Typed seating service layer (block B, PR 10 — feature/admin-seating-service-types).
//
// This is the full typed service layer over the seating read RPC (PR 7) and
// write RPC (PR 8). It replaces the minimal pass-through wrappers from PR 8 with:
//   * typed inputs / outputs for every read and write RPC;
//   * normalisation of the snake_case RPC response into the camelCase frontend
//     model (SeatingLayout / SeatingTemplate / SeatingAssignment / …);
//   * serialisation of the camelCase frontend model into the v15 save payload;
//   * centralised Supabase RPC error handling.
//
// There is NO canvas, UI, template selector, auto-seating, drag/drop or capacity
// summary logic here — those are later PRs (11–18). This file does not change the
// registration limit: it never reads or writes `event_capacity_units.capacity`.
// The routing keys (eventId / occurrenceId / capacityUnitId) live inside the save
// payload by design (PR 8); they are typed explicitly, not hidden.
//
// The browser uses the normal authenticated Supabase session; every function maps
// to a SECURITY DEFINER RPC that enforces role, single-community scope and the
// seating validations. No service role, no Admin API, auth.users untouched.

import { requireSupabaseClient } from "./supabaseClient";
import type {
  CreateSeatingLayoutFromTemplateParams,
  SeatingAssignment,
  SeatingAssignmentEntry,
  SeatingAssignmentRpcRow,
  SeatingAssignmentsPayload,
  SeatingAssignmentsSaveResult,
  SeatingAssignmentType,
  SeatingConnection,
  SeatingConnectionRpcRow,
  SeatingLayout,
  SeatingLayoutPayload,
  SeatingLayoutRow,
  SeatingLayoutRpcRow,
  SeatingSlotParams,
  SeatingTable,
  SeatingTableRpcRow,
  SeatingTemplate,
  SeatingTemplateRpcRow,
  SeatingTemplateSnapshot,
  TableEnd,
} from "../types/seating";

// ---------------------------------------------------------------------------
// Error handling
// ---------------------------------------------------------------------------

type SupabaseRpcError = {
  message?: string;
  details?: string | null;
  hint?: string | null;
};

function formatRpcError(action: string, error: SupabaseRpcError): string {
  const details = [error.message, error.details, error.hint].filter(Boolean).join(" ");
  return `${action} failed: ${details || "Unknown Supabase error"}`;
}

// Run an RPC and centralise error formatting. Returns the raw `data`.
async function callRpc(
  action: string,
  fn: string,
  args?: Record<string, unknown>,
): Promise<unknown> {
  const supabase = requireSupabaseClient();
  const { data, error } = await supabase.rpc(fn, args);

  if (error) {
    throw new Error(formatRpcError(action, error as SupabaseRpcError));
  }

  return data;
}

// ---------------------------------------------------------------------------
// Small coercion helpers (RPC jsonb may arrive parsed or as a string)
// ---------------------------------------------------------------------------

type JsonRecord = Record<string, unknown>;

function parseJsonish(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function toRecord(value: unknown): JsonRecord {
  const parsed = parseJsonish(value);
  return isRecord(parsed) ? parsed : {};
}

function toRecordArray(value: unknown): JsonRecord[] {
  const parsed = parseJsonish(value);
  return Array.isArray(parsed) ? parsed.filter(isRecord) : [];
}

function nullableString(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  return typeof value === "string" ? value : String(value);
}

function requiredString(value: unknown, fallback = ""): string {
  const normalized = nullableString(value);
  return normalized && normalized.length > 0 ? normalized : fallback;
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

function safeBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function toAssignmentType(value: unknown): SeatingAssignmentType {
  return nullableString(value)?.toLowerCase() === "reserve" ? "reserve" : "guest";
}

function toTableEnd(value: unknown): TableEnd {
  return nullableString(value)?.toLowerCase() === "b" ? "b" : "a";
}

// The first row of an RPC result: setof / table RPC return an array, composite
// RPC return a single object.
function firstRecord(value: unknown): JsonRecord {
  const parsed = parseJsonish(value);
  if (Array.isArray(parsed)) {
    return parsed.length > 0 ? toRecord(parsed[0]) : {};
  }
  return toRecord(parsed);
}

// ---------------------------------------------------------------------------
// Normalisation: snake_case RPC rows -> camelCase frontend model
//
// Table / connection normalisers accept BOTH shapes because the payloads differ
// by source: a layout's `tables` jsonb is a snake_case DB row
// (`client_table_id`, `long_side_seats`, `is_rabbi_table`), whereas a template
// snapshot's `tables` already use the v15 camelCase shape (`id`, `sideSeats`,
// `isRabbiTable`).
// ---------------------------------------------------------------------------

function normalizeTable(value: unknown): SeatingTable {
  const row = toRecord(value) as Partial<SeatingTableRpcRow> & JsonRecord;
  return {
    // The table identity MUST be the stable `client_table_id`, never the
    // `event_seating_tables.id` uuid. The read RPC returns `to_jsonb(st.*)`,
    // which carries BOTH `id` (the DB row uuid) and `client_table_id`. Seat
    // keys, connections and saved assignments are all built from
    // `client_table_id`, so preferring `id` here would re-key every table to a
    // volatile uuid on reopen and orphan every saved seat_key. Template
    // snapshots use the v15 camelCase shape (`{ id, … }`, no client_table_id),
    // so fall back to `id` for those.
    id: requiredString(row.client_table_id ?? row.id),
    cx: safeNumber(row.cx, 0),
    cy: safeNumber(row.cy, 0),
    w: safeNumber(row.w, 0),
    h: safeNumber(row.h, 0),
    angle: safeNumber(row.angle, 0),
    sideSeats: safeNumber(row.sideSeats ?? row.long_side_seats, 3),
    isRabbiTable: safeBoolean(row.isRabbiTable ?? row.is_rabbi_table, false),
  };
}

function normalizeConnection(value: unknown): SeatingConnection {
  const row = toRecord(value) as Partial<SeatingConnectionRpcRow> & JsonRecord;
  return {
    aTableId: requiredString(row.aTableId ?? row.from_client_table_id),
    aEnd: toTableEnd(row.aEnd ?? row.from_end),
    bTableId: requiredString(row.bTableId ?? row.to_client_table_id),
    bEnd: toTableEnd(row.bEnd ?? row.to_end),
    x: safeNumber(row.x ?? row.anchor_x, 0),
    y: safeNumber(row.y ?? row.anchor_y, 0),
  };
}

function normalizeAssignment(value: unknown): SeatingAssignment {
  const row = toRecord(value) as Partial<SeatingAssignmentRpcRow> & JsonRecord;
  return {
    id: requiredString(row.id),
    layoutId: requiredString(row.layoutId ?? row.layout_id),
    registrationId: nullableString(row.registrationId ?? row.registration_id),
    seatKey: nullableString(row.seatKey ?? row.seat_key),
    guestLabel: nullableString(row.guestLabel ?? row.guest_label),
    guestInitials: nullableString(row.guestInitials ?? row.guest_initials),
    type: toAssignmentType(row.type ?? row.assignment_type),
  };
}

function normalizeSnapshot(value: unknown): SeatingTemplateSnapshot {
  const snapshot = toRecord(value);
  const canvas = toRecord(snapshot.canvas);
  return {
    version: safeNumber(snapshot.version, 1),
    canvas: {
      width: safeNumber(canvas.width, 980),
      height: safeNumber(canvas.height, 640),
    },
    tables: toRecordArray(snapshot.tables).map(normalizeTable),
    connections: toRecordArray(snapshot.connections).map(normalizeConnection),
  };
}

function normalizeLayoutRow(value: unknown): SeatingLayoutRow {
  const row = toRecord(value) as Partial<SeatingLayoutRpcRow> & JsonRecord;
  return {
    id: requiredString(row.id),
    communityId: requiredString(row.communityId ?? row.community_id),
    eventId: requiredString(row.eventId ?? row.event_id),
    occurrenceId: nullableString(row.occurrenceId ?? row.occurrence_id),
    capacityUnitId: requiredString(row.capacityUnitId ?? row.capacity_unit_id),
    templateId: nullableString(row.templateId ?? row.template_id),
    capacityLimitSnapshot: nullableNumber(
      row.capacityLimitSnapshot ?? row.capacity_limit_snapshot,
    ),
    seatingDone: safeBoolean(row.seatingDone ?? row.seating_done, false),
    createdBy: nullableString(row.createdBy ?? row.created_by),
    createdAt: requiredString(row.createdAt ?? row.created_at),
    updatedAt: requiredString(row.updatedAt ?? row.updated_at),
  };
}

function normalizeTemplate(value: unknown): SeatingTemplate {
  const row = toRecord(value) as Partial<SeatingTemplateRpcRow> & JsonRecord;
  return {
    id: requiredString(row.id),
    communityId: requiredString(row.communityId ?? row.community_id),
    title: requiredString(row.title),
    snapshot: normalizeSnapshot(row.snapshot),
    isBuiltin: safeBoolean(row.isBuiltin ?? row.is_builtin, false),
    isActive: safeBoolean(row.isActive ?? row.is_active, true),
    createdBy: nullableString(row.createdBy ?? row.created_by),
    createdAt: requiredString(row.createdAt ?? row.created_at),
    updatedAt: requiredString(row.updatedAt ?? row.updated_at),
  };
}

// admin_get_seating_layout returns a single row { layout, tables, connections,
// assignments }; `layout` is null when no instance exists yet for the slot.
function normalizeLayoutEnvelope(value: unknown): SeatingLayout | null {
  const row = firstRecord(value);
  const layout = parseJsonish(row.layout);

  if (!isRecord(layout)) {
    return null;
  }

  return {
    ...normalizeLayoutRow(layout),
    tables: toRecordArray(row.tables).map(normalizeTable),
    connections: toRecordArray(row.connections).map(normalizeConnection),
    assignments: toRecordArray(row.assignments).map(normalizeAssignment),
  };
}

function normalizeAssignmentsSaveResult(value: unknown): SeatingAssignmentsSaveResult {
  const row = toRecord(value);
  return {
    layoutId: requiredString(row.layoutId ?? row.layout_id),
    placedCount: safeNumber(row.placedCount ?? row.placed_count, 0),
    pooledCount: safeNumber(row.pooledCount ?? row.pooled_count, 0),
    reserveCount: safeNumber(row.reserveCount ?? row.reserve_count, 0),
  };
}

// ---------------------------------------------------------------------------
// Serialisation: camelCase frontend model -> v15 save payload
//
// The wire payload is exactly the v15 contract (PLAN §3) plus the routing keys.
// We rebuild it field by field so unknown extra properties never leak to the RPC
// and every contract key is always present with its canonical default.
// ---------------------------------------------------------------------------

type SeatingTableWire = {
  id: string;
  cx: number;
  cy: number;
  w: number;
  h: number;
  angle: number;
  sideSeats: number;
  isRabbiTable: boolean;
};

type SeatingConnectionWire = {
  aTableId: string;
  aEnd: TableEnd;
  bTableId: string;
  bEnd: TableEnd;
  x: number;
  y: number;
};

type SeatingAssignmentEntryWire = {
  seatKey: string | null;
  registrationId: string | null;
  type: SeatingAssignmentType;
  name: string | null;
  initials: string | null;
};

// The full v15 layout contract on the wire (all keys present) + routing keys.
type SeatingLayoutWirePayload = {
  eventId: string;
  occurrenceId: string | null;
  capacityUnitId: string;
  layout: string;
  customTables: SeatingTableWire[];
  tableConnections: SeatingConnectionWire[];
  selectedTableId: string | null;
  seatingDone: boolean;
  activeTemplateId: string | null;
  reserveIds: string[];
  capacity: number;
  chairs: SeatingAssignmentEntryWire[];
  pool: SeatingAssignmentEntryWire[];
};

type SeatingAssignmentsWirePayload = {
  eventId: string;
  occurrenceId: string | null;
  capacityUnitId: string;
  chairs: SeatingAssignmentEntryWire[];
  pool: SeatingAssignmentEntryWire[];
  reserveIds: string[];
};

function serializeTable(table: SeatingTable): SeatingTableWire {
  return {
    id: table.id,
    cx: table.cx,
    cy: table.cy,
    w: table.w,
    h: table.h,
    angle: table.angle,
    sideSeats: table.sideSeats,
    isRabbiTable: table.isRabbiTable,
  };
}

function serializeConnection(connection: SeatingConnection): SeatingConnectionWire {
  return {
    aTableId: connection.aTableId,
    aEnd: connection.aEnd,
    bTableId: connection.bTableId,
    bEnd: connection.bEnd,
    x: connection.x,
    y: connection.y,
  };
}

function serializeEntry(entry: SeatingAssignmentEntry): SeatingAssignmentEntryWire {
  return {
    seatKey: entry.seatKey ?? null,
    registrationId: entry.registrationId ?? null,
    type: entry.type,
    name: entry.name ?? null,
    initials: entry.initials ?? null,
  };
}

export function serializeSeatingLayoutPayload(
  payload: SeatingLayoutPayload,
): SeatingLayoutWirePayload {
  return {
    eventId: payload.eventId,
    occurrenceId: payload.occurrenceId ?? null,
    capacityUnitId: payload.capacityUnitId,
    layout: payload.layout ?? "",
    customTables: (payload.customTables ?? []).map(serializeTable),
    tableConnections: (payload.tableConnections ?? []).map(serializeConnection),
    selectedTableId: payload.selectedTableId ?? null,
    seatingDone: payload.seatingDone ?? false,
    activeTemplateId: payload.activeTemplateId ?? null,
    reserveIds: payload.reserveIds ?? [],
    // Accepted for v15 parity only. The RPC ignores it and derives
    // capacity_limit_snapshot server-side; it can never change the real limit.
    capacity: payload.capacity ?? 0,
    chairs: (payload.chairs ?? []).map(serializeEntry),
    pool: (payload.pool ?? []).map(serializeEntry),
  };
}

export function serializeSeatingAssignmentsPayload(
  payload: SeatingAssignmentsPayload,
): SeatingAssignmentsWirePayload {
  return {
    eventId: payload.eventId,
    occurrenceId: payload.occurrenceId ?? null,
    capacityUnitId: payload.capacityUnitId,
    chairs: (payload.chairs ?? []).map(serializeEntry),
    pool: (payload.pool ?? []).map(serializeEntry),
    reserveIds: payload.reserveIds ?? [],
  };
}

// ---------------------------------------------------------------------------
// Read service functions
// ---------------------------------------------------------------------------

// admin_list_seating_templates — active templates across the caller's
// admin/event_manager communities.
export async function listSeatingTemplates(): Promise<SeatingTemplate[]> {
  const data = await callRpc("List seating templates", "admin_list_seating_templates");
  return toRecordArray(data).map(normalizeTemplate);
}

// admin_get_seating_template — a single template by id.
export async function getSeatingTemplate(templateId: string): Promise<SeatingTemplate> {
  const data = await callRpc("Get seating template", "admin_get_seating_template", {
    p_template_id: templateId,
  });
  return normalizeTemplate(firstRecord(data));
}

// admin_get_seating_layout — the instance for one slot with its tables,
// connections and assignments. Returns null when no instance exists yet.
export async function getSeatingLayout(
  params: SeatingSlotParams,
): Promise<SeatingLayout | null> {
  const data = await callRpc("Get seating layout", "admin_get_seating_layout", {
    p_event_id: params.eventId,
    p_occurrence_id: params.occurrenceId,
    p_capacity_unit_id: params.capacityUnitId,
  });
  return normalizeLayoutEnvelope(data);
}

// ---------------------------------------------------------------------------
// Write service functions
// ---------------------------------------------------------------------------

// admin_create_seating_layout_from_template — forks a new layout instance for
// the slot from a template snapshot (tables / connections only, no assignments).
export async function createSeatingLayoutFromTemplate(
  params: CreateSeatingLayoutFromTemplateParams,
): Promise<SeatingLayoutRow> {
  const data = await callRpc(
    "Create seating layout from template",
    "admin_create_seating_layout_from_template",
    {
      p_event_id: params.eventId,
      p_occurrence_id: params.occurrenceId,
      p_capacity_unit_id: params.capacityUnitId,
      p_template_id: params.templateId,
    },
  );
  return normalizeLayoutRow(firstRecord(data));
}

// admin_save_seating_layout — saves geometry only (layout row, tables,
// connections, template_id, server-derived capacity_limit_snapshot). Never
// touches assignments or the real capacity unit limit.
export async function saveSeatingLayout(
  payload: SeatingLayoutPayload,
): Promise<SeatingLayoutRow> {
  const data = await callRpc("Save seating layout", "admin_save_seating_layout", {
    payload: serializeSeatingLayoutPayload(payload),
  });
  return normalizeLayoutRow(firstRecord(data));
}

// admin_save_seating_assignments — replaces the layout's guest / reserve
// assignments from chairs[] (placed) and pool[] (unplaced).
export async function saveSeatingAssignments(
  payload: SeatingAssignmentsPayload,
): Promise<SeatingAssignmentsSaveResult> {
  const data = await callRpc(
    "Save seating assignments",
    "admin_save_seating_assignments",
    { payload: serializeSeatingAssignmentsPayload(payload) },
  );
  return normalizeAssignmentsSaveResult(parseJsonish(data));
}

// admin_create_seating_template_from_layout — copies geometry only into a new
// community-scoped template snapshot.
export async function createSeatingTemplateFromLayout(
  layoutId: string,
  title: string,
): Promise<SeatingTemplate> {
  const data = await callRpc(
    "Create seating template",
    "admin_create_seating_template_from_layout",
    { p_layout_id: layoutId, p_title: title },
  );
  return normalizeTemplate(firstRecord(data));
}

// admin_delete_seating_template — soft delete (is_active = false); built-in
// templates are rejected by the RPC.
export async function deleteSeatingTemplate(
  templateId: string,
): Promise<SeatingTemplate> {
  const data = await callRpc("Delete seating template", "admin_delete_seating_template", {
    p_template_id: templateId,
  });
  return normalizeTemplate(firstRecord(data));
}
