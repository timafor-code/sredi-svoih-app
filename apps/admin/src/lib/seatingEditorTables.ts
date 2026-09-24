import {
  CHAIR_OFFSET,
  TABLE_H,
  TABLE_W,
  normalizeAngle,
  normalizeDisabledSeats,
  tableBounds,
} from "./seatingGeometry";
import type { SeatingTable } from "../types/seating";

export const TABLE_START_CX = TABLE_W + CHAIR_OFFSET * 2;
export const TABLE_START_CY = TABLE_H + CHAIR_OFFSET * 2;
export const TABLE_ADD_DX = TABLE_W + CHAIR_OFFSET * 2;
export const TABLE_ADD_DY = TABLE_H / 2;
export const TABLE_MIN_PADDING = CHAIR_OFFSET + 24;

let clientTableSequence = 0;

export function createEditorTable({
  angle = 0,
  cx = TABLE_START_CX,
  cy = TABLE_START_CY,
  disabledSeats = [],
  h = TABLE_H,
  isRabbiTable = false,
  sideSeats = 3,
  w = TABLE_W,
}: Partial<SeatingTable> = {}): SeatingTable {
  return {
    angle: normalizeAngle(angle),
    cx,
    cy,
    disabledSeats: [...normalizeDisabledSeats(disabledSeats)].sort(),
    h: h > 0 ? h : TABLE_H,
    id: createClientTableId(),
    isRabbiTable,
    sideSeats: sideSeats === 2 ? 2 : 3,
    w: w > 0 ? w : TABLE_W,
  };
}

export function createClientTableId(): string {
  clientTableSequence += 1;
  return `table_${Date.now().toString(36)}_${clientTableSequence.toString(36)}`;
}

export function normalizeEditorTables(tables: SeatingTable[]): SeatingTable[] {
  const normalizedTables = tables
    .filter((table) => table.id)
    .map((table) =>
      clampTableToCanvasStart({
        angle: normalizeAngle(table.angle || 0),
        cx: Number.isFinite(table.cx) ? table.cx : TABLE_START_CX,
        cy: Number.isFinite(table.cy) ? table.cy : TABLE_START_CY,
        disabledSeats: [...normalizeDisabledSeats(table.disabledSeats)].sort(),
        h: table.h > 0 ? table.h : TABLE_H,
        id: table.id,
        isRabbiTable: Boolean(table.isRabbiTable),
        sideSeats: table.sideSeats === 2 ? 2 : 3,
        w: table.w > 0 ? table.w : TABLE_W,
      }),
    );

  return ensureOneRabbiTable(
    normalizedTables.length > 0
      ? normalizedTables
      : [createEditorTable({ isRabbiTable: true })],
  );
}

export function ensureOneRabbiTable(tables: SeatingTable[]): SeatingTable[] {
  if (tables.length === 0) {
    return [];
  }

  const rabbiIndex = Math.max(
    0,
    tables.findIndex((table) => table.isRabbiTable),
  );

  return tables.map((table, index) => ({
    ...table,
    isRabbiTable: index === rabbiIndex,
  }));
}

export function clampTableToCanvasStart(table: SeatingTable): SeatingTable {
  const bounds = tableBounds(table);
  const dx = bounds.minX < TABLE_MIN_PADDING ? TABLE_MIN_PADDING - bounds.minX : 0;
  const dy = bounds.minY < TABLE_MIN_PADDING ? TABLE_MIN_PADDING - bounds.minY : 0;

  return dx || dy ? { ...table, cx: table.cx + dx, cy: table.cy + dy } : table;
}
