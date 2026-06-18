// PR 17 — seating assignment reconcile after a table geometry edit (pure logic).
//
// When an admin enters geometry edit mode ("Редактировать столы"), the current
// guest/reserve assignments are NOT deleted — they are preserved in editor state
// while the tables are moved/added/removed. When the admin returns to seating (or
// runs "Сделать рассадку"), the saved/current assignments must be reconciled with
// the new geometry: a placement is kept when its seat still exists and is valid,
// otherwise the occupant is returned to the "Не рассажены" pool.
//
// This ports the spirit of the v15 prototype `applyGeometry(st,{preserveIndex})`
// behaviour, but works on the stable, `client_table_id`-based seat keys used by the
// production editor (NOT volatile DB uuids and NOT positional chair indexes), so a
// table that merely moves keeps its occupants while a table that is deleted or whose
// seats disappear frees them.
//
// It is pure and DOM-free: it never reads or writes anything, never touches
// `event_capacity_units.capacity`, and only derives the next assignments array plus
// the counts the editor shows in its reconcile warning.
//
// Validity rules (mirroring PR 14/15/16 invariants):
//   * seat still resolves from the seat key and is free      -> keep the placement;
//   * seat key no longer resolves to any seat (table/seat gone) -> return to pool;
//   * seat became rabbi-reserved (or is explicitly blocked)  -> ordinary guests are
//     returned to the pool; reserves and explicit rabbi guests may stay there;
//   * two placements resolve to the same physical seat       -> the highest-priority
//     one stays, the other is returned to the pool;
//   * the same guest/reserve is placed twice                 -> the highest-priority
//     placement stays, the redundant one is dropped;
//   * a guest assignment whose registration is no longer in the active bucket
//     (donation-only/cancelled/foreign slot) is surfaced as an orphan and dropped,
//     never rendered as occupied.
//
// Manual/locked placements (PR 15) and reserve placements (PR 16) win every
// conflict, so a repeat auto seating after a geometry edit never reshuffles them.

import { isExplicitRabbiGuest, seatIndexFromSeatKey } from "./seatingAutoAssign";
import type {
  SeatingAssignment,
  SeatingGeometryResult,
  SeatingGuestPoolItem,
} from "../types/seating";

/** Why a previously placed occupant was removed from its seat during reconcile. */
export type SeatingReconcileReason =
  | "missing_seat"
  | "blocked_seat"
  | "duplicate_seat"
  | "duplicate_occupant"
  | "orphan_guest";

/** Counts surfaced in the editor reconcile warning/status block. */
export interface SeatingReconcileCounts {
  /** Placements that survived the geometry change (still on a valid seat). */
  keptCount: number;
  /** Occupants returned to "Не рассажены" (missing + blocked + duplicate seat). */
  returnedCount: number;
  /** Placements whose seat key no longer resolves to any seat. */
  missingSeatCount: number;
  /** Placements whose seat became rabbi-reserved/blocked for that occupant. */
  blockedSeatCount: number;
  /** Conflicts where two placements wanted the same seat or the same occupant. */
  duplicateCount: number;
}

/** A placement that lost its seat, paired with the reason, for status messaging. */
export interface SeatingReconcileReturn {
  assignment: SeatingAssignment;
  reason: SeatingReconcileReason;
}

export interface SeatingReconcileResult {
  /**
   * The reconciled assignments array — the new single source of truth. Contains
   * the kept placements (with their seat keys), the occupants returned to the pool
   * (seat key cleared) and any originally-pooled entries, in input order. Dropped
   * occupant-duplicates and orphans are NOT included.
   */
  assignments: SeatingAssignment[];
  /** The placements that kept their seat. */
  keptAssignments: SeatingAssignment[];
  /** The occupants returned to the pool (seat key cleared), with their reason. */
  returned: SeatingReconcileReturn[];
  /** Orphaned guest placements (registration no longer in the active bucket). */
  invalidAssignments: SeatingAssignment[];
  counts: SeatingReconcileCounts;
}

export interface SeatingReconcileInput {
  /** Current assignments (placed entries carry a seat key; pooled entries null). */
  assignments: readonly SeatingAssignment[];
  /** The physical seats computed after the geometry change. */
  geometry: SeatingGeometryResult;
  /**
   * The active guest pool for the bucket. When provided it enables orphan
   * detection (a placed guest whose registration is no longer in the bucket) and
   * rabbi-guest resolution (an explicit rabbi guest may keep a rabbi-reserved
   * seat). When empty, neither check evicts anyone beyond the geometry rules.
   */
  guestPool?: readonly SeatingGuestPoolItem[];
  /** Optional explicit rabbi-guest keys (same contract as auto seating). */
  rabbiGuestKeys?: readonly string[];
  /** Optional extra blocked seat indexes (besides rabbi-reserved seats). */
  blockedSeatIndexes?: readonly number[];
}

export function reconcileSeatingAssignments({
  assignments,
  geometry,
  guestPool = [],
  rabbiGuestKeys = [],
  blockedSeatIndexes = [],
}: SeatingReconcileInput): SeatingReconcileResult {
  const blocked = new Set(blockedSeatIndexes);
  const poolRegistrationIds = new Set(
    guestPool.map((guest) => guest.registrationId).filter(Boolean) as string[],
  );

  type PlacedEntry = {
    assignment: SeatingAssignment;
    order: number;
    priority: number;
  };

  const placed: PlacedEntry[] = [];
  // outcome by original index: keep | return | drop | pool
  const outcomeByOrder = new Map<
    number,
    { kind: "return" | "drop" }
  >();

  assignments.forEach((assignment, order) => {
    if (assignment.seatKey) {
      placed.push({ assignment, order, priority: placementPriority(assignment) });
    }
  });

  // Highest priority first (locked/manual win conflicts); stable by input order.
  placed.sort((a, b) => b.priority - a.priority || a.order - b.order);

  const usedSeatIndexes = new Set<number>();
  const usedOccupants = new Set<string>();
  const keptAssignments: SeatingAssignment[] = [];
  const returned: SeatingReconcileReturn[] = [];
  const invalidAssignments: SeatingAssignment[] = [];
  let missingSeatCount = 0;
  let blockedSeatCount = 0;
  let duplicateCount = 0;

  for (const { assignment, order } of placed) {
    // Orphan: a guest whose registration is no longer in the active bucket. It is
    // surfaced and dropped (never rendered as occupied, never re-saved).
    if (isOrphanGuest(assignment, guestPool, poolRegistrationIds)) {
      invalidAssignments.push(assignment);
      outcomeByOrder.set(order, { kind: "drop" });
      continue;
    }

    const signature = occupantSignature(assignment);

    // Duplicate occupant: the same guest/reserve already kept a seat. The redundant
    // placement is dropped (the occupant is already seated once).
    if (usedOccupants.has(signature)) {
      duplicateCount += 1;
      outcomeByOrder.set(order, { kind: "drop" });
      continue;
    }

    const seatIndex = seatIndexFromSeatKey(assignment.seatKey, geometry);
    if (seatIndex === null) {
      missingSeatCount += 1;
      returned.push({ assignment: unplaceAssignment(assignment), reason: "missing_seat" });
      outcomeByOrder.set(order, { kind: "return" });
      continue;
    }

    const seat = geometry.seats[seatIndex];
    const isRabbiSeat = Boolean(seat?.isRabbiTable);
    const allowedOnRabbiSeat =
      assignment.type === "reserve" ||
      isRabbiGuestAssignment(assignment, guestPool, rabbiGuestKeys);

    if ((isRabbiSeat && !allowedOnRabbiSeat) || blocked.has(seatIndex)) {
      blockedSeatCount += 1;
      returned.push({ assignment: unplaceAssignment(assignment), reason: "blocked_seat" });
      outcomeByOrder.set(order, { kind: "return" });
      continue;
    }

    // Duplicate seat: another (higher-priority) occupant already claimed this seat.
    if (usedSeatIndexes.has(seatIndex)) {
      duplicateCount += 1;
      returned.push({ assignment: unplaceAssignment(assignment), reason: "duplicate_seat" });
      outcomeByOrder.set(order, { kind: "return" });
      continue;
    }

    usedSeatIndexes.add(seatIndex);
    usedOccupants.add(signature);
    keptAssignments.push(assignment);
  }

  // Rebuild the next assignments array in input order so the canvas/panel/status
  // line all derive from one stable source of truth.
  const reconciled: SeatingAssignment[] = [];
  const returnedAssignmentsQueue = [...returned];

  assignments.forEach((assignment, order) => {
    if (!assignment.seatKey) {
      // Originally pooled entry (overflow guest or unseated reserve) — passthrough.
      reconciled.push(assignment);
      return;
    }

    const outcome = outcomeByOrder.get(order);
    if (!outcome) {
      // Kept — emit the placement unchanged (still carries its seat key).
      reconciled.push(assignment);
      return;
    }

    if (outcome.kind === "drop") {
      // Orphan / redundant duplicate occupant — removed entirely.
      return;
    }

    // Returned to the pool — emit the unplaced (seat key cleared) form.
    const unplaced = matchReturned(returnedAssignmentsQueue, assignment);
    reconciled.push(unplaced ?? unplaceAssignment(assignment));
  });

  return {
    assignments: reconciled,
    keptAssignments,
    returned,
    invalidAssignments,
    counts: {
      keptCount: keptAssignments.length,
      returnedCount: returned.length,
      missingSeatCount,
      blockedSeatCount,
      duplicateCount,
    },
  };
}

function matchReturned(
  queue: SeatingReconcileReturn[],
  original: SeatingAssignment,
): SeatingAssignment | null {
  const index = queue.findIndex((entry) => entry.assignment.id === original.id);
  if (index < 0) {
    return null;
  }
  const [entry] = queue.splice(index, 1);
  return entry.assignment;
}

function placementPriority(assignment: SeatingAssignment): number {
  let priority = 0;
  if (assignment.locked) {
    priority += 2;
  }
  if (assignment.placementSource === "manual") {
    priority += 1;
  }
  return priority;
}

function unplaceAssignment(assignment: SeatingAssignment): SeatingAssignment {
  return {
    ...assignment,
    locked: false,
    placementSource: undefined,
    seatKey: null,
  };
}

function occupantSignature(assignment: SeatingAssignment): string {
  if (assignment.type === "reserve") {
    return `reserve:${assignment.id}`;
  }
  return `guest:${guestSignature(
    assignment.registrationId,
    assignment.guestLabel,
    assignment.guestInitials,
  )}`;
}

function isOrphanGuest(
  assignment: SeatingAssignment,
  guestPool: readonly SeatingGuestPoolItem[],
  poolRegistrationIds: ReadonlySet<string>,
): boolean {
  if (assignment.type !== "guest") {
    return false;
  }
  if (guestPool.length === 0) {
    // No pool to validate against — do not evict on identity grounds.
    return false;
  }
  if (!assignment.registrationId) {
    // A guest assignment with no registration is not a valid bucket obligation.
    return true;
  }
  return !poolRegistrationIds.has(assignment.registrationId);
}

function isRabbiGuestAssignment(
  assignment: SeatingAssignment,
  guestPool: readonly SeatingGuestPoolItem[],
  rabbiGuestKeys: readonly string[],
): boolean {
  const guest = guestPool.find((candidate) => matchesGuest(assignment, candidate));
  return guest ? isExplicitRabbiGuest(guest, rabbiGuestKeys) : false;
}

function matchesGuest(
  assignment: SeatingAssignment,
  guest: SeatingGuestPoolItem,
): boolean {
  return (
    guestSignature(assignment.registrationId, assignment.guestLabel, assignment.guestInitials) ===
    guestSignature(guest.registrationId, guest.displayName, guest.initials)
  );
}

function guestSignature(
  registrationId: string | null,
  label: string | null,
  initials: string | null,
): string {
  return [
    registrationId ?? "",
    (label ?? "").trim().toLocaleLowerCase("ru-RU"),
    (initials ?? "").trim().toLocaleLowerCase("ru-RU"),
  ].join("|");
}
