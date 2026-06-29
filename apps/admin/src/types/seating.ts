// Seating types (block B).
//
// This file has two clearly separated sections:
//
//   1. Geometry / seat-state types (PR 9 — feature/admin-seating-geometry-lib).
//      The minimal types required by the pure geometry layer in
//      `lib/seatingGeometry.ts`. They cover only geometry / seat-state math.
//
//   2. Service-layer types (PR 10 — feature/admin-seating-service-types), at the
//      bottom of the file. The typed model for `services/adminSeatingService.ts`:
//      the normalised camelCase frontend model (SeatingLayout, SeatingTemplate,
//      SeatingAssignment, …), the raw snake_case RPC rows it normalises from, and
//      the v15 save payload contract it serialises to. They are built ON TOP of
//      the geometry types and reuse them (SeatingTable, SeatingConnection) so a
//      loaded layout can be fed straight into the geometry layer.
//
// The field names mirror the v15 payload contract (see PLAN §3 and the
// SeatingLayoutPayload type below): `customTables[]` rows carry
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

// ===========================================================================
// Service-layer types (block B, PR 10 — feature/admin-seating-service-types).
//
// The typed model consumed/produced by `services/adminSeatingService.ts`.
// Three layers:
//   * Frontend model — normalised camelCase (SeatingLayout, SeatingTemplate,
//     SeatingAssignment, …). What the service returns.
//   * RPC rows — the raw snake_case jsonb the read/write RPC return. What the
//     service normalises FROM. Suffixed `RpcRow`.
//   * Save payload — the v15 contract the save RPC accept. What the service
//     serialises TO. Suffixed `Payload`.
//
// `SeatingTable` and `SeatingConnection` are deliberately the geometry types
// above, so a loaded layout's `tables` / `connections` go straight into
// `computeTableSeats` without translation.
// ===========================================================================

/** Assignment kind. `reserve` carries no registration; `guest` references one. */
export type SeatingAssignmentType = "guest" | "reserve";

/**
 * How a placed assignment got onto its seat. `auto` = deterministic auto seating
 * (PR 14); `manual` = explicit drag/drop placement (PR 15). This is UI-safe
 * metadata: the `admin_save_seating_assignments` RPC only reads the known v15
 * entry keys, so it is ignored on the way to the backend and is not persisted as
 * a column. After a reopen the flag cannot be restored from the DB, so the editor
 * treats every currently placed assignment as locked for repeat auto seating
 * (see PR 15 in `docs/admin-seating.md`).
 */
export type SeatingPlacementSource = "auto" | "manual";

/**
 * A table connection in the service model. Identical to the geometry
 * {@link SeatingTableConnection} (`{ aTableId, aEnd, bTableId, bEnd, x, y }`);
 * aliased here so service-layer call sites can speak of "connections".
 */
export type SeatingConnection = SeatingTableConnection;

// ---------------------------------------------------------------------------
// Frontend model (normalised, camelCase)
// ---------------------------------------------------------------------------

/**
 * One `event_seating_layouts` row (a seating instance bound to a capacity slot),
 * without its child collections. Returned by the write RPC that mutate the row
 * (save layout, create-from-template).
 */
export interface SeatingLayoutRow {
  id: string;
  communityId: string;
  eventId: string;
  /** `null` for the legacy single-occurrence slot. */
  occurrenceId: string | null;
  capacityUnitId: string;
  /** `null` when the instance keeps its own geometry (builtin/grid/blank). */
  templateId: string | null;
  /** Non-authoritative display snapshot; `null` = no limit. Never the real limit. */
  capacityLimitSnapshot: number | null;
  seatingDone: boolean;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

/** A seating instance with its tables, connections and assignments. */
export interface SeatingLayout extends SeatingLayoutRow {
  tables: SeatingTable[];
  connections: SeatingConnection[];
  assignments: SeatingAssignment[];
}

/** Geometry-only snapshot stored on a template (no guests, no slot). */
export interface SeatingTemplateSnapshot {
  version: number;
  canvas: { width: number; height: number };
  tables: SeatingTable[];
  connections: SeatingConnection[];
}

/** A reusable, community-scoped geometry template. */
export interface SeatingTemplate {
  id: string;
  communityId: string;
  title: string;
  snapshot: SeatingTemplateSnapshot;
  /** Built-in templates cannot be deleted. */
  isBuiltin: boolean;
  /** Soft-delete flag (`false` = deleted). */
  isActive: boolean;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

/** A guest / reserve placed on a chair (or pooled when `seatKey` is null). */
export interface SeatingAssignment {
  id: string;
  layoutId: string;
  /** `null` for reserves and unplaced pool entries. */
  registrationId: string | null;
  /** `client_table_id` + seat index; `null` when unplaced (pool). */
  seatKey: string | null;
  guestLabel: string | null;
  guestInitials: string | null;
  type: SeatingAssignmentType;
  /** PR 15: how this assignment reached its seat. Optional / UI-safe metadata. */
  placementSource?: SeatingPlacementSource;
  /** PR 15: a locked assignment is preserved by repeat auto seating. */
  locked?: boolean;
}

/** Display occupant derived from a saved/auto-generated seating assignment. */
export interface SeatingSeatOccupant {
  displayName: string;
  id: string;
  initials: string;
  isRabbiHead?: boolean;
  registrationId: string | null;
  seatIndex: number;
  seatKey: string;
  type: SeatingAssignmentType;
  /** PR 15: present when the occupant was placed manually / is locked. */
  placementSource?: SeatingPlacementSource;
  locked?: boolean;
}

/**
 * Display-only capacity summary shape (the v15 status line). This PR ships the
 * TYPE only — the formulas (PLAN §1) and the UI land in PR 18
 * (feature/admin-seating-capacity-summary). It is never computed here and never
 * changes `event_capacity_units.capacity`.
 */
export interface SeatingCapacitySummary {
  /** Physical chairs from the geometry (`computePhysicalSeatCount`). */
  physicalSeatCount: number;
  /** Registration limit; `null` = no limit. */
  capacityLimit: number | null;
  occupiedSeats: number;
  reserveCount: number;
  /** `capacityLimit − occupiedSeats`; `null` when there is no limit. */
  freeByLimit: number | null;
  /** `physicalSeatCount − occupiedSeats − reserveCount`. */
  freePhysical: number;
  /** `max(0, occupiedSeats + reserveCount − physicalSeatCount)`. */
  missingPhysical: number;
  /** `max(0, physicalSeatCount − capacityLimit)`; `0` when there is no limit. */
  physicalOverflow: number;
}

/**
 * PR 16: a UI-created operational reserve shown in the "Не рассажены" pool.
 *
 * A reserve is NOT a registration: it carries no `registrationId`, never appears
 * in `event_registration_capacity_reservations`, and never increases the occupied
 * registration seat count. It only occupies a physical seat. Reserves are
 * persisted as `assignment_type='reserve'` assignments (placed in `chairs[]` or
 * pooled in `pool[]`); `id` is the stable reserve / assignment identity used as
 * the pool drag key and to match the reserve across moves.
 */
export interface SeatingReservePoolItem {
  id: string;
  label: string;
  initials: string;
}

// ---------------------------------------------------------------------------
// Print model (admin-only A4 seating document)
// ---------------------------------------------------------------------------

export interface SeatingPrintHeader {
  capacityBucketTitle: string;
  eventTitle: string;
  occurrenceSubtitle: string;
  printedAtLabel: string;
}

export interface SeatingPrintTable {
  angle: number;
  cx: number;
  cy: number;
  h: number;
  id: string;
  isRabbiTable: boolean;
  label: string;
  printOrder: number;
  w: number;
}

export interface SeatingPrintSeatOccupant {
  displayName: string;
  id: string;
  initials: string;
  isRabbiHead: boolean;
  legendLabel: string;
  schemeLabel: string;
  seatNumber: number;
  type: SeatingAssignmentType;
}

export interface SeatingPrintSeat {
  isHead: boolean;
  isRabbiTable: boolean;
  occupant: SeatingPrintSeatOccupant | null;
  seatNumber: number;
  x: number;
  y: number;
}

export interface SeatingPrintLegendItem {
  displayName: string;
  id: string;
  initials: string;
  legendLabel: string;
  seatNumber: number;
  type: SeatingAssignmentType;
}

export interface SeatingPrintUnseatedItem {
  displayName: string;
  id: string;
  initials: string;
  type: SeatingAssignmentType;
}

export interface SeatingPrintModel {
  canvas: {
    isCompact: boolean;
    offsetX: number;
    offsetY: number;
    height: number;
    printSeatNumberBySeatIndex: Record<number, number>;
    scale: number;
    seats: SeatingPrintSeat[];
    seams: SeatingSeam[];
    tables: SeatingPrintTable[];
    viewportHeight: number;
    viewportWidth: number;
    width: number;
  };
  header: SeatingPrintHeader;
  layout: {
    hasFullLegendPage: boolean;
    inlineLegend: boolean;
    legendColumns: 3 | 4;
  };
  legend: SeatingPrintLegendItem[];
  unseated: SeatingPrintUnseatedItem[];
}

export type SeatingGuestPoolSource = "participant" | "guest";
export type SeatingGuestPoolObligationSource =
  | "reservation"
  | "mapped_option"
  | "mixed";

/**
 * A read-only seat obligation for the selected registration capacity bucket.
 *
 * PR 13 renders these in the "Не рассажены" panel only. They are not seating
 * assignments yet and are never written back to `event_seating_assignments` by
 * this model.
 */
export interface SeatingGuestPoolItem {
  /** Stable React key / future assignment candidate id. */
  id: string;
  key: string;
  displayName: string;
  initials: string;
  registrationId: string;
  participantUserId: string | null;
  participantDisplayName: string | null;
  email: string | null;
  phone: string | null;
  guestIndex: number | null;
  guestName: string | null;
  source: SeatingGuestPoolSource;
  sourceLabel: string;
  status: string | null;
  paymentStatus: string | null;
  optionTitles: string[];
  optionIds: string[];
  capacityReservationIds: string[];
  seatObligationSource: SeatingGuestPoolObligationSource;
  capacityUnitId: string;
  occurrenceId: string | null;
}

// ---------------------------------------------------------------------------
// Raw RPC rows (snake_case, as returned by the read/write RPC)
// ---------------------------------------------------------------------------

/** `to_jsonb(event_seating_layout_templates)` / template-returning RPC rows. */
export interface SeatingTemplateRpcRow {
  id: string;
  community_id: string;
  title: string;
  snapshot: unknown;
  is_builtin: boolean;
  is_active: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

/** `to_jsonb(event_seating_layouts)` / layout-returning RPC rows. */
export interface SeatingLayoutRpcRow {
  id: string;
  community_id: string;
  event_id: string;
  occurrence_id: string | null;
  capacity_unit_id: string;
  template_id: string | null;
  capacity_limit_snapshot: number | null;
  seating_done: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

/** `to_jsonb(event_seating_tables)` rows (layout `tables` jsonb). */
export interface SeatingTableRpcRow {
  client_table_id: string;
  cx: number | string;
  cy: number | string;
  w: number | string;
  h: number | string;
  angle: number | string;
  long_side_seats: number | string;
  is_rabbi_table: boolean;
}

/** `to_jsonb(event_seating_table_connections)` rows (layout `connections` jsonb). */
export interface SeatingConnectionRpcRow {
  from_client_table_id: string;
  from_end: string | null;
  to_client_table_id: string;
  to_end: string | null;
  anchor_x: number | string | null;
  anchor_y: number | string | null;
}

/** `to_jsonb(event_seating_assignments)` rows (layout `assignments` jsonb). */
export interface SeatingAssignmentRpcRow {
  id: string;
  layout_id: string;
  registration_id: string | null;
  seat_key: string | null;
  guest_label: string | null;
  guest_initials: string | null;
  assignment_type: string;
}

/** A single row of `admin_get_seating_layout`. `layout` is null for an empty slot. */
export interface SeatingLayoutEnvelopeRpcRow {
  layout: SeatingLayoutRpcRow | null;
  tables: SeatingTableRpcRow[];
  connections: SeatingConnectionRpcRow[];
  assignments: SeatingAssignmentRpcRow[];
}

// ---------------------------------------------------------------------------
// Save payload (v15 contract + slot routing keys)
// ---------------------------------------------------------------------------

/**
 * One entry of the v15 `chairs[]` (placed) or `pool[]` (unplaced) arrays.
 * `seatKey` is set for placed chairs and null/absent for pool entries.
 */
export interface SeatingAssignmentEntry {
  seatKey?: string | null;
  registrationId?: string | null;
  type: SeatingAssignmentType;
  name?: string | null;
  initials?: string | null;
  /**
   * PR 15 UI-safe metadata. The save RPC ignores unknown entry keys, so these
   * are sent for client round-tripping only and never reach a DB column.
   */
  placementSource?: SeatingPlacementSource;
  locked?: boolean;
}

/**
 * The v15 save-layout payload (PLAN §3) plus the slot routing keys. The routing
 * keys (`eventId` / `occurrenceId` / `capacityUnitId`) live INSIDE the payload by
 * design (PR 8): the prototype carried the slot in the localStorage key, the RPC
 * reads it from the body. They are typed explicitly here, not hidden.
 *
 * Only routing + geometry are required; the remaining v15 fields are optional and
 * defaulted by the serializer to the canonical contract. `capacity` is accepted
 * for parity only — the RPC ignores it and derives `capacity_limit_snapshot`
 * server-side, so it can never change `event_capacity_units.capacity`.
 */
export interface SeatingLayoutPayload {
  // routing keys
  eventId: string;
  occurrenceId?: string | null;
  capacityUnitId: string;
  // v15 contract
  layout?: string;
  customTables: SeatingTable[];
  tableConnections?: SeatingConnection[];
  selectedTableId?: string | null;
  seatingDone?: boolean;
  activeTemplateId?: string | null;
  reserveIds?: string[];
  capacity?: number;
  chairs?: SeatingAssignmentEntry[];
  pool?: SeatingAssignmentEntry[];
}

/** The save-assignments payload: chairs[] (placed) + pool[] (unplaced) + routing. */
export interface SeatingAssignmentsPayload {
  eventId: string;
  occurrenceId?: string | null;
  capacityUnitId: string;
  chairs?: SeatingAssignmentEntry[];
  pool?: SeatingAssignmentEntry[];
  reserveIds?: string[];
}

/** Slot identifier for the read / fork RPC. */
export interface SeatingSlotParams {
  eventId: string;
  occurrenceId: string | null;
  capacityUnitId: string;
}

/** Slot + template id for `admin_create_seating_layout_from_template`. */
export interface CreateSeatingLayoutFromTemplateParams extends SeatingSlotParams {
  templateId: string;
}

/** Result of `admin_save_seating_assignments`. */
export interface SeatingAssignmentsSaveResult {
  layoutId: string;
  placedCount: number;
  pooledCount: number;
  reserveCount: number;
}
