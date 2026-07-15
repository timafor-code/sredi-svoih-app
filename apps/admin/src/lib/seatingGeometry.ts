// Pure seating geometry (block B, PR 9 — feature/admin-seating-geometry-lib).
//
// Ported from the v15 prototype (`docs/prototype/registrations-improved-seating-v15.html`).
// This module is INTENTIONALLY pure: no React, no DOM, no external client, no
// localStorage, no CSS, no file/network IO, no side effects. Every function maps
// inputs to outputs and never mutates its arguments. The UI editor (PR 11) and
// auto-seating (PR 14) build on top of this; canvas scaling is a UI concern and
// is deliberately NOT done here (coordinates stay in the input space).
//
// v15 cross-reference (line numbers from the prototype at time of port):
//   normalizeAngle 770 · tableVectors 771 · tableEndpoint 772 · tableCorners 776
//   dist 780 · angleDelta 781 · projectPoly 785 · polygonsOverlap 790
//   pointSegmentDistance 804 · pointInPoly 810 · pointPolyDistance 818
//   isNearPerpendicularConnection 828 · isChairBlockedByAnotherTable 839
//   dedupeChairs 850 · tableSideSeats 910 · tableBounds 1055
//   pickRabbiHeadIndex 1061 · customSeatGeometry 1095 (→ computeTableSeats)
//   isEndHardBlocked 1104 · spreadSeatIndexes 1180 · rabbiSeatIndexes 1203
//   buildSeatState 1258 (re-scoped to a pure occupancy derivation).

import type {
  ComputedSeat,
  Point,
  SeatAssignment,
  SeatingGeometryInput,
  SeatingGeometryResult,
  SeatingSeam,
  SeatingTableConnection,
  SeatingTableGeometry,
  SeatState,
  SeatStateEntry,
  TableEnd,
} from "../types/seating";

// v15 fixed dimensions (line 759). Exported so callers building default tables
// stay consistent with the geometry math.
export const TABLE_W = 120;
export const TABLE_H = 64;
export const CHAIR_OFFSET = 28;
export const TABLE_SEAM = 3;

// ---------------------------------------------------------------------------
// Angles & basis vectors
// ---------------------------------------------------------------------------

/** Snap an arbitrary angle to the nearest of {0, 90, 180, 270} degrees. */
export function normalizeAngle(a: number): number {
  const n = (((a % 360) + 360) % 360);
  return (Math.round(n / 90) * 90) % 360;
}

/** Unit basis vectors for a table: `u` along its length, `p` across its depth. */
export function tableVectors(t: { angle?: number }): {
  ux: number;
  uy: number;
  px: number;
  py: number;
} {
  const a = ((t.angle ?? 0) * Math.PI) / 180;
  return { ux: Math.cos(a), uy: Math.sin(a), px: -Math.sin(a), py: Math.cos(a) };
}

/** The outward end point (`a` or `b`) of a table, with direction/perp vectors. */
export function tableEndpoint(
  t: SeatingTableGeometry,
  end: TableEnd,
): { x: number; y: number; dir: Point; perp: Point } {
  const v = tableVectors(t);
  const sg = end === "a" ? -1 : 1;
  return {
    x: t.cx + v.ux * (t.w / 2) * sg,
    y: t.cy + v.uy * (t.w / 2) * sg,
    dir: { x: v.ux * sg, y: v.uy * sg },
    perp: { x: v.px, y: v.py },
  };
}

/** The four corner points of a table, in order, in world coordinates. */
export function tableCorners(t: SeatingTableGeometry): Point[] {
  const v = tableVectors(t);
  const hw = t.w / 2;
  const hh = t.h / 2;
  return ([
    [-hw, -hh],
    [hw, -hh],
    [hw, hh],
    [-hw, hh],
  ] as const).map(([x, y]) => ({
    x: t.cx + v.ux * x + v.px * y,
    y: t.cy + v.uy * x + v.py * y,
  }));
}

/** Axis-aligned bounding box of a table (from its rotated corners). */
export function tableBounds(t: SeatingTableGeometry): {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
} {
  const cs = tableCorners(t);
  return {
    minX: Math.min(...cs.map((c) => c.x)),
    maxX: Math.max(...cs.map((c) => c.x)),
    minY: Math.min(...cs.map((c) => c.y)),
    maxY: Math.max(...cs.map((c) => c.y)),
  };
}

/** Euclidean distance between two points. */
export function dist(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Smallest unsigned angle (0..90) between two table orientations, mod 180. */
export function angleDelta(a: number, b: number): number {
  const d = Math.abs(normalizeAngle(a) - normalizeAngle(b)) % 180;
  return d > 90 ? 180 - d : d;
}

// ---------------------------------------------------------------------------
// Polygon helpers (SAT overlap, point-in-poly, distances)
// ---------------------------------------------------------------------------

/** Project a polygon onto an axis, returning the [min, max] interval. */
export function projectPoly(
  poly: Point[],
  axis: Point,
): { min: number; max: number } {
  let min = Infinity;
  let max = -Infinity;
  poly.forEach((p) => {
    const v = p.x * axis.x + p.y * axis.y;
    min = Math.min(min, v);
    max = Math.max(max, v);
  });
  return { min, max };
}

/** Separating-axis test: do two convex polygons overlap (with epsilon slack)? */
export function polygonsOverlap(a: Point[], b: Point[], eps = 0.5): boolean {
  const axes: Point[] = [];
  [a, b].forEach((poly) => {
    for (let i = 0; i < poly.length; i++) {
      const p1 = poly[i];
      const p2 = poly[(i + 1) % poly.length];
      const ex = p2.x - p1.x;
      const ey = p2.y - p1.y;
      const len = Math.hypot(ex, ey) || 1;
      axes.push({ x: -ey / len, y: ex / len });
    }
  });
  return axes.every((axis) => {
    const pa = projectPoly(a, axis);
    const pb = projectPoly(b, axis);
    return !(pa.max <= pb.min + eps || pb.max <= pa.min + eps);
  });
}

/** Shortest distance from a point to a line segment [a, b]. */
export function pointSegmentDistance(p: Point, a: Point, b: Point): number {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const len2 = vx * vx + vy * vy || 1;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.y - a.y) * vy) / len2));
  const x = a.x + vx * t;
  const y = a.y + vy * t;
  return Math.hypot(p.x - x, p.y - y);
}

/** Ray-casting point-in-polygon test. */
export function pointInPoly(p: Point, poly: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const pi = poly[i];
    const pj = poly[j];
    if (
      pi.y > p.y !== pj.y > p.y &&
      p.x < ((pj.x - pi.x) * (p.y - pi.y)) / (pj.y - pi.y) + pi.x
    ) {
      inside = !inside;
    }
  }
  return inside;
}

/** Distance from a point to a polygon (0 if inside). */
export function pointPolyDistance(p: Point, poly: Point[]): number {
  if (pointInPoly(p, poly)) return 0;
  let d = Infinity;
  for (let i = 0; i < poly.length; i++) {
    d = Math.min(d, pointSegmentDistance(p, poly[i], poly[(i + 1) % poly.length]));
  }
  return d;
}

// ---------------------------------------------------------------------------
// Tables / seat constraints
// ---------------------------------------------------------------------------

/** v15 `tableSideSeats`: long-side seat count, constrained to {2, 3}. */
export function tableSideSeats(t: { sideSeats?: number }): number {
  return t && t.sideSeats === 2 ? 2 : 3;
}

/** Normalise a raw table into a clean geometry record (no mutation of input). */
function normalizeTable(t: SeatingTableGeometry): SeatingTableGeometry {
  return {
    id: t.id,
    cx: t.cx,
    cy: t.cy,
    w: t.w ?? TABLE_W,
    h: t.h ?? TABLE_H,
    angle: normalizeAngle(t.angle ?? 0),
    sideSeats: t.sideSeats === 2 ? 2 : 3,
    isRabbiTable: !!t.isRabbiTable,
  };
}

type TablesById = Map<string, SeatingTableGeometry>;

function connectionAngleDelta(
  c: SeatingTableConnection,
  tablesById: TablesById,
): number {
  const a = tablesById.get(c.aTableId);
  const b = tablesById.get(c.bTableId);
  return a && b ? angleDelta(a.angle, b.angle) : 0;
}

/**
 * v15 `isNearPerpendicularConnection`: a side seat that physically lands on a
 * near-perpendicular seam between two joined tables is blocked. Parallel
 * (end-to-end) joints are handled by {@link isEndHardBlocked} instead.
 */
export function isNearPerpendicularConnection(
  chair: ComputedSeat,
  connections: SeatingTableConnection[],
  tablesById: TablesById,
): boolean {
  return connections.some((c) => {
    if (c.aTableId !== chair.tableId && c.bTableId !== chair.tableId) return false;
    if (connectionAngleDelta(c, tablesById) < 12) return false;
    const p = { x: c.x, y: c.y };
    return dist(chair, p) < 26 || dist(chair.anchor, p) < 18;
  });
}

/**
 * v15 `isChairBlockedByAnotherTable`: a chair whose seat or anchor sits on/near
 * the footprint of a different table is removed.
 */
export function isChairBlockedByAnotherTable(
  chair: ComputedSeat,
  tables: SeatingTableGeometry[],
): boolean {
  return tables.some((t) => {
    if (t.id === chair.tableId) return false;
    const poly = tableCorners(t);
    return (
      pointPolyDistance({ x: chair.x, y: chair.y }, poly) < 24 ||
      pointPolyDistance(chair.anchor, poly) < 8
    );
  });
}

/**
 * v15 `isEndHardBlocked` (extracted from the `customSeatGeometry` closure):
 * an end seat is hard-blocked only when its end is joined end-to-end to a
 * roughly parallel table. Perpendicular/corner joints keep the outside end seat.
 */
export function isEndHardBlocked(
  table: SeatingTableGeometry,
  end: TableEnd,
  connections: SeatingTableConnection[],
  tablesById: TablesById,
): boolean {
  const c = connections.find(
    (con) =>
      (con.aTableId === table.id && con.aEnd === end) ||
      (con.bTableId === table.id && con.bEnd === end),
  );
  if (!c) return false;
  const otherId = c.aTableId === table.id ? c.bTableId : c.aTableId;
  const other = tablesById.get(otherId);
  return !!other && angleDelta(table.angle, other.angle) < 12;
}

/** v15 `dedupeChairs`: drop chairs that sit within `minDist` of an earlier one. */
export function dedupeChairs<T extends Point>(chairs: T[], minDist = 32): T[] {
  const out: T[] = [];
  chairs.forEach((c) => {
    if (!out.some((x) => Math.hypot(x.x - c.x, x.y - c.y) < minDist)) out.push(c);
  });
  return out;
}

// ---------------------------------------------------------------------------
// Core: compute the physical seats for a figure of tables
// ---------------------------------------------------------------------------

type RawChair = Omit<ComputedSeat, "isRabbiTable">;

/**
 * v15 `pickRabbiHeadIndex` (line 1061): choose the head seat index.
 *
 * If a rabbi table exists, the head is the centre seat of its "head" side —
 * the TOP side for a horizontal table, the LEFT side for a vertical one.
 * Otherwise it falls back to the seat nearest the hint point `hp`.
 */
export function pickRabbiHeadIndex(
  tables: SeatingTableGeometry[],
  chairs: ComputedSeat[],
  hp: Point,
): number {
  const rabbiTable = tables.find((t) => t && t.isRabbiTable);
  if (rabbiTable) {
    const tableChairs = chairs
      .map((c, i) => ({ chair: c, i }))
      .filter((c) => c.chair.tableId === rabbiTable.id);
    if (tableChairs.length) {
      const angle = normalizeAngle(rabbiTable.angle);
      const horizontal = angle === 0 || angle === 180;
      const prefer = horizontal
        ? tableChairs.filter((c) => c.chair.y <= rabbiTable.cy)
        : tableChairs.filter((c) => c.chair.x <= rabbiTable.cx);
      const side = prefer.length ? prefer : tableChairs;
      side.sort((a, b) =>
        horizontal ? a.chair.x - b.chair.x : a.chair.y - b.chair.y,
      );
      return side[Math.floor(side.length / 2)].i;
    }
  }
  let headIndex = 0;
  let best = 1e18;
  chairs.forEach((c, i) => {
    const dd = (c.x - hp.x) ** 2 + (c.y - hp.y) ** 2;
    if (dd < best) {
      best = dd;
      headIndex = i;
    }
  });
  return headIndex;
}

/**
 * v15 `customSeatGeometry` (line 1095), re-expressed as a pure function over
 * `SeatingGeometryInput`. Computes every physical seat for the figure, applies
 * seam / neighbour blocking and de-duplication, picks the head seat and returns
 * the content bounding box. No coordinate shifting / canvas fitting is done here.
 */
export function computeTableSeats(
  input: SeatingGeometryInput,
): SeatingGeometryResult {
  const tables = input.tables.map(normalizeTable);
  const connections = input.connections ?? [];
  const tablesById: TablesById = new Map(tables.map((t) => [t.id, t]));

  const seams: SeatingSeam[] = connections.map((c) => ({ x: c.x, y: c.y }));

  const rawChairs: RawChair[] = [];
  const withRabbi = (c: RawChair): ComputedSeat => ({
    ...c,
    isRabbiTable: !!tablesById.get(c.tableId)?.isRabbiTable,
  });
  const pushChair = (ch: RawChair) => {
    const seat = withRabbi(ch);
    if (ch.kind === "side" && isNearPerpendicularConnection(seat, connections, tablesById)) {
      return;
    }
    if (isChairBlockedByAnotherTable(seat, tables)) return;
    rawChairs.push(ch);
  };

  tables.forEach((t) => {
    const v = tableVectors(t);
    const sideSeats = tableSideSeats(t);
    for (let j = 0; j < sideSeats; j++) {
      const along = -t.w / 2 + (j + 0.5) * (t.w / sideSeats);
      const anchorA = {
        x: t.cx + v.ux * along + v.px * (-t.h / 2),
        y: t.cy + v.uy * along + v.py * (-t.h / 2),
      };
      const anchorB = {
        x: t.cx + v.ux * along + v.px * (t.h / 2),
        y: t.cy + v.uy * along + v.py * (t.h / 2),
      };
      pushChair({
        x: anchorA.x + v.px * -CHAIR_OFFSET,
        y: anchorA.y + v.py * -CHAIR_OFFSET,
        anchor: anchorA,
        tableId: t.id,
        kind: "side",
        edge: "a",
        slot: j,
      });
      pushChair({
        x: anchorB.x + v.px * CHAIR_OFFSET,
        y: anchorB.y + v.py * CHAIR_OFFSET,
        anchor: anchorB,
        tableId: t.id,
        kind: "side",
        edge: "b",
        slot: j,
      });
    }
    const endA = tableEndpoint(t, "a");
    const endB = tableEndpoint(t, "b");
    if (!isEndHardBlocked(t, "a", connections, tablesById)) {
      pushChair({
        x: endA.x + endA.dir.x * CHAIR_OFFSET,
        y: endA.y + endA.dir.y * CHAIR_OFFSET,
        anchor: { x: endA.x, y: endA.y },
        tableId: t.id,
        kind: "end",
        end: "a",
      });
    }
    if (!isEndHardBlocked(t, "b", connections, tablesById)) {
      pushChair({
        x: endB.x + endB.dir.x * CHAIR_OFFSET,
        y: endB.y + endB.dir.y * CHAIR_OFFSET,
        anchor: { x: endB.x, y: endB.y },
        tableId: t.id,
        kind: "end",
        end: "b",
      });
    }
  });

  const seats = dedupeChairs(rawChairs, 20).map(withRabbi);

  const hp: Point =
    seats.find((s) => s.isRabbiTable) ??
    seats[0] ??
    (tables[0] ? { x: tables[0].cx, y: tables[0].cy } : { x: 0, y: 0 });
  const headIndex = pickRabbiHeadIndex(tables, seats, hp);

  // Content bounding box (v15 `finishGeo`, without the in-place canvas shift —
  // the React UI fits/scales coordinates itself via getCanvasScale).
  let maxX = 0;
  let maxY = 0;
  let minX = 1e9;
  let minY = 1e9;
  tables.forEach((t) => {
    const b = tableBounds(t);
    maxX = Math.max(maxX, b.maxX);
    maxY = Math.max(maxY, b.maxY);
    minX = Math.min(minX, b.minX);
    minY = Math.min(minY, b.minY);
  });
  seats.forEach((c) => {
    maxX = Math.max(maxX, c.x + 20);
    maxY = Math.max(maxY, c.y + 20);
    minX = Math.min(minX, c.x - 20);
    minY = Math.min(minY, c.y - 20);
  });
  seams.forEach((c) => {
    maxX = Math.max(maxX, c.x + 12);
    maxY = Math.max(maxY, c.y + 12);
    minX = Math.min(minX, c.x - 12);
    minY = Math.min(minY, c.y - 12);
  });

  return {
    seats,
    seams,
    headIndex,
    width: maxX + 40,
    height: maxY + 40,
    physicalSeatCount: seats.length,
  };
}

/**
 * Number of physical seats a figure yields, after seam / neighbour blocking and
 * de-duplication. This is the v15 `g.chairs.length` used in the status line and
 * is independent of `capacity_unit.capacity` (PLAN §1).
 */
export function computePhysicalSeatCount(input: SeatingGeometryInput): number {
  return computeTableSeats(input).seats.length;
}

// ---------------------------------------------------------------------------
// Rabbi seats & even spreading
// ---------------------------------------------------------------------------

/** Indexes of all seats that belong to the rabbi table (kept as reserve). */
export function rabbiSeatIndexes(seats: ComputedSeat[]): Set<number> {
  const indexes = new Set<number>();
  seats.forEach((c, i) => {
    if (c.isRabbiTable) indexes.add(i);
  });
  return indexes;
}

/**
 * v15 `spreadSeatIndexes` (line 1180): pick `count` seat indexes spread evenly
 * across the available seats (excluding the head seat and any excluded
 * indexes). Deterministic, and deliberately NOT "the first N seats".
 */
export function spreadSeatIndexes(
  total: number,
  count: number,
  headIndex: number,
  excludedIndexes: Set<number> = new Set(),
): number[] {
  const available: number[] = [];
  for (let i = 0; i < total; i++) {
    if (i !== headIndex && !excludedIndexes.has(i)) available.push(i);
  }
  if (count <= 0) return [];
  if (count >= available.length) return available;
  if (count === 1) return [available[Math.floor(available.length / 2)]];
  const picked: number[] = [];
  const used = new Set<number>();
  const step = (available.length - 1) / (count - 1);
  for (let k = 0; k < count; k++) {
    let at = Math.round(k * step);
    if (used.has(at)) {
      let left = at - 1;
      let right = at + 1;
      while (left >= 0 || right < available.length) {
        if (right < available.length && !used.has(right)) {
          at = right;
          break;
        }
        if (left >= 0 && !used.has(left)) {
          at = left;
          break;
        }
        left--;
        right++;
      }
    }
    used.add(at);
    picked.push(available[at]);
  }
  return picked;
}

// ---------------------------------------------------------------------------
// Seat state (pure occupancy derivation)
// ---------------------------------------------------------------------------

/**
 * Pure re-scope of v15 `buildSeatState`: given a computed geometry result and an
 * assignment array (chair index → occupant id | null), derive the normalised
 * occupancy view (per-seat rows plus occupied / free / rabbi-reserve counts).
 *
 * The v15 original also generated people and read localStorage; that IO is NOT
 * part of the geometry layer (it belongs to the assignments work, PR 13+). This
 * function only does math and never mutates its inputs.
 */
export function buildSeatState(
  geo: SeatingGeometryResult,
  assignments: SeatAssignment[] = [],
): SeatState {
  const seats: SeatStateEntry[] = geo.seats.map((seat, index) => ({
    index,
    seat,
    occupantId: assignments[index] ?? null,
    isHead: index === geo.headIndex,
    isRabbiReserved: seat.isRabbiTable,
  }));
  const occupiedCount = seats.filter((s) => s.occupantId != null).length;
  const physicalSeatCount = geo.seats.length;
  const rabbiReserveCount = geo.seats.filter((s) => s.isRabbiTable).length;
  return {
    seats,
    occupiedCount,
    freeCount: Math.max(0, physicalSeatCount - occupiedCount),
    rabbiReserveCount,
    headIndex: geo.headIndex,
    physicalSeatCount,
  };
}
