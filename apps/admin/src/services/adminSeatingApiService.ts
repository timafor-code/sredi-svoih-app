import { apiClient } from "./apiClient";
import type {
  AdminApiSeatingAssignmentsSaveResponse,
  AdminApiSeatingAssignmentResponse,
  AdminApiSeatingConnectionResponse,
  AdminApiSeatingLayoutEnvelopeResponse,
  AdminApiSeatingLayoutRowResponse,
  AdminApiSeatingTableResponse,
  AdminApiSeatingTemplateResponse,
} from "../types/api";
import type {
  CreateSeatingLayoutFromTemplateParams,
  SeatingAssignment,
  SeatingAssignmentEntry,
  SeatingAssignmentsPayload,
  SeatingAssignmentsSaveResult,
  SeatingAssignmentType,
  SeatingConnection,
  SeatingLayout,
  SeatingLayoutPayload,
  SeatingLayoutRow,
  SeatingSlotParams,
  SeatingTable,
  SeatingTemplate,
  SeatingTemplateSnapshot,
  TableEnd,
} from "../types/seating";

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

function normalizeTable(value: unknown): SeatingTable {
  const row = toRecord(value) as Partial<AdminApiSeatingTableResponse> & JsonRecord;

  return {
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
  const row = toRecord(value) as Partial<AdminApiSeatingConnectionResponse> & JsonRecord;

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
  const row = toRecord(value) as Partial<AdminApiSeatingAssignmentResponse> & JsonRecord;

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
  const row = toRecord(value) as Partial<AdminApiSeatingLayoutRowResponse> & JsonRecord;

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
  const row = toRecord(value) as Partial<AdminApiSeatingTemplateResponse> & JsonRecord;

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

function normalizeLayoutEnvelope(
  value: AdminApiSeatingLayoutEnvelopeResponse | null,
): SeatingLayout | null {
  if (!value?.layout) {
    return null;
  }

  return {
    ...normalizeLayoutRow(value.layout),
    tables: toRecordArray(value.tables).map(normalizeTable),
    connections: toRecordArray(value.connections).map(normalizeConnection),
    assignments: toRecordArray(value.assignments).map(normalizeAssignment),
  };
}

function normalizeAssignmentsSaveResult(
  value: AdminApiSeatingAssignmentsSaveResponse,
): SeatingAssignmentsSaveResult {
  return {
    layoutId: requiredString(value.layout_id),
    placedCount: safeNumber(value.placed_count, 0),
    pooledCount: safeNumber(value.pooled_count, 0),
    reserveCount: safeNumber(value.reserve_count, 0),
  };
}

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

type SeatingLayoutFromTemplateApiPayload = {
  eventId: string;
  occurrenceId: string | null;
  capacityUnitId: string;
  templateId: string;
};

type SeatingTemplateFromLayoutApiPayload = {
  layoutId: string;
  title: string;
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

function serializeSeatingLayoutPayload(
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
    capacity: payload.capacity ?? 0,
    chairs: (payload.chairs ?? []).map(serializeEntry),
    pool: (payload.pool ?? []).map(serializeEntry),
  };
}

function serializeSeatingAssignmentsPayload(
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

export async function listSeatingTemplates(): Promise<SeatingTemplate[]> {
  const templates = await apiClient.get<AdminApiSeatingTemplateResponse[] | null>(
    "/admin/seating/templates",
  );

  return (templates ?? []).map(normalizeTemplate);
}

export async function getSeatingTemplate(templateId: string): Promise<SeatingTemplate> {
  const template = await apiClient.get<AdminApiSeatingTemplateResponse>(
    `/admin/seating/templates/${encodeURIComponent(templateId)}`,
  );

  return normalizeTemplate(template);
}

export async function getSeatingLayout(
  params: SeatingSlotParams,
): Promise<SeatingLayout | null> {
  const layout = await apiClient.get<AdminApiSeatingLayoutEnvelopeResponse | null>(
    "/admin/seating/layout",
    {
      query: {
        eventId: params.eventId,
        occurrenceId: params.occurrenceId,
        capacityUnitId: params.capacityUnitId,
      },
    },
  );

  return normalizeLayoutEnvelope(layout);
}

export async function createSeatingLayoutFromTemplate(
  params: CreateSeatingLayoutFromTemplateParams,
): Promise<SeatingLayoutRow> {
  const payload: SeatingLayoutFromTemplateApiPayload = {
    eventId: params.eventId,
    occurrenceId: params.occurrenceId,
    capacityUnitId: params.capacityUnitId,
    templateId: params.templateId,
  };
  const layout = await apiClient.post<
    AdminApiSeatingLayoutRowResponse,
    SeatingLayoutFromTemplateApiPayload
  >("/admin/seating/layout/from-template", payload);

  return normalizeLayoutRow(layout);
}

export async function saveSeatingLayout(
  payload: SeatingLayoutPayload,
): Promise<SeatingLayoutRow> {
  const layout = await apiClient.patch<
    AdminApiSeatingLayoutRowResponse,
    SeatingLayoutWirePayload
  >("/admin/seating/layout", serializeSeatingLayoutPayload(payload));

  return normalizeLayoutRow(layout);
}

export async function saveSeatingAssignments(
  payload: SeatingAssignmentsPayload,
): Promise<SeatingAssignmentsSaveResult> {
  const result = await apiClient.patch<
    AdminApiSeatingAssignmentsSaveResponse,
    SeatingAssignmentsWirePayload
  >("/admin/seating/assignments", serializeSeatingAssignmentsPayload(payload));

  return normalizeAssignmentsSaveResult(result);
}

export async function createSeatingTemplateFromLayout(
  layoutId: string,
  title: string,
): Promise<SeatingTemplate> {
  const payload: SeatingTemplateFromLayoutApiPayload = {
    layoutId,
    title,
  };
  const template = await apiClient.post<
    AdminApiSeatingTemplateResponse,
    SeatingTemplateFromLayoutApiPayload
  >("/admin/seating/templates/from-layout", payload);

  return normalizeTemplate(template);
}

export async function deleteSeatingTemplate(
  templateId: string,
): Promise<SeatingTemplate> {
  const template = await apiClient.delete<AdminApiSeatingTemplateResponse>(
    `/admin/seating/templates/${encodeURIComponent(templateId)}`,
  );

  return normalizeTemplate(template);
}
