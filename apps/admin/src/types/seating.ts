// Seating geometry types (block B, PR 9 — feature/admin-seating-geometry-lib).
//
// These are the minimal types required by the pure geometry layer in
// `lib/seatingGeometry.ts`. They intentionally cover only geometry / seat-state
// math — there is NO service-layer, RPC, DTO or persistence type here. The full
// typed service layer (SeatingLayout, SeatingTemplate, SeatingAssignment, …)
// arrives in PR 10 (feature/admin-seating-service-types).
//
// The field names mirror the v15 payload contract (see PLAN §3 and
// adminSeatingService.SeatingLayoutSavePayload): `customTables[]` rows carry
// `{ id, cx, cy, w, h, angle, sideSeats, isRabbiTable }` and `tableConnections[]`
// carry `{ aTableId, aEnd, bTableId, bEnd, x, y }`. Keeping the same shape means
// the geometry layer consumes saved layouts without a translation step.

/** A 2D point in the (unscaled) seating coordinate space. */
export interface Point {
  x: number;
  y: number;
}

/** Which physical end of a rectangular table a connection/seat refers to. */
export type TableEnd = "a" | "b";

/** Which long side of a table a side-seat sits on. */
export type TableEdge = "a" | "b";

/**
 * Pure geometry description of a single rectangular table.
 *
 * `cx/cy` is the table centre, `w` its length (long axis), `h` its depth.
 * `angle` is in degrees and is normalised to {0, 90, 180, 270} by the geometry
 * layer. `sideSeats` is the v15 "long_side_seats" value, constrained to {2, 3}.
 */
export interface SeatingTableGeometry {
  id: string;
  cx: number;
  cy: number;
  w: number;
  h: number;
  angle: number;
  sideSeats: number;
  isRabbiTable: boolean;
}

/** Alias used by callers that think of the row as a "table" rather than geometry. */
export type SeatingTable = SeatingTableGeometry;

/** A join between two table ends, with the seam point `{x, y}` where they meet. */
export interface SeatingTableConnection {
  aTableId: string;
  aEnd: TableEnd;
  bTableId: string;
  bEnd: TableEnd;
  x: number;
  y: number;
}

/**
 * A single computed physical seat (chair) produced by the geometry layer.
 *
 * `anchor` is the point on the table edge the chair belongs to (used for
 * collision / seam tests); `x/y` is the chair centre offset outward from it.
 */
export interface ComputedSeat {
  x: number;
  y: number;
  anchor: Point;
  tableId: string;
  kind: "side" | "end";
  /** Present for `kind === "side"` — which long side the seat is on. */
  edge?: TableEdge;
  /** Present for `kind === "end"` — which table end the seat caps. */
  end?: TableEnd;
  /** Present for `kind === "side"` — index of the seat along the side. */
  slot?: number;
  isRabbiTable: boolean;
}

/** A visible seam marker where two tables are connected. */
export type SeatingSeam = Point;

/** Input to the geometry layer: the tables plus their connections. */
export interface SeatingGeometryInput {
  tables: SeatingTableGeometry[];
  connections?: SeatingTableConnection[];
}

/**
 * Result of computing seats for a figure of tables.
 *
 * Coordinates are in the same (unscaled) space as the input tables — the React
 * UI is responsible for fitting them to the canvas (getCanvasScale /
 * fitSeatCanvas). `width/height` describe the content bounding box so the UI can
 * size/scale the canvas; nothing here is tied to the fixed 980×640 v15 canvas.
 */
export interface SeatingGeometryResult {
  seats: ComputedSeat[];
  seams: SeatingSeam[];
  headIndex: number;
  width: number;
  height: number;
  physicalSeatCount: number;
}

/** A per-seat occupant id, or `null` when the seat is empty. */
export type SeatAssignment = string | null;

/** A single seat row inside a computed SeatState. */
export interface SeatStateEntry {
  index: number;
  seat: ComputedSeat;
  occupantId: SeatAssignment;
  isHead: boolean;
  isRabbiReserved: boolean;
}

/**
 * Normalised occupancy view over a SeatingGeometryResult plus an assignment
 * array (chair → occupant id | null). Pure derivation of the v15 status counts
 * (occupied / free / rabbi reserve) — it never reads or mutates anything.
 */
export interface SeatState {
  seats: SeatStateEntry[];
  occupiedCount: number;
  freeCount: number;
  rabbiReserveCount: number;
  headIndex: number;
  physicalSeatCount: number;
}
