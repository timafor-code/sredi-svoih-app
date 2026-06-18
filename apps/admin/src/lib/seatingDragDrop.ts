// PR 15 — manual seating drag/drop (pure logic).
//
// Ports the v15 prototype `seatDrop` behaviour into pure, DOM-free TypeScript.
// The single source of truth is the `assignments` array (placed entries carry a
// `seatKey`; pooled entries carry `null`). `applySeatingDragDrop` takes that
// array plus a drag source and a drop target and returns the next array, so the
// React editor can keep one state and let the canvas, panel and status line all
// derive from it (no split state between panel and canvas).
//
// Supported moves (v15 `seatDrop`):
//   * pool    -> empty seat      place a guest from "Не рассажены".
//   * reserve -> empty seat      place a pooled reserve (PR 16) on a seat.
//   * seat    -> empty seat      move a seated guest / reserve.
//   * seat    -> occupied seat   swap two seated occupants.
//   * pool    -> occupied seat   place the guest, return the displaced one to pool.
//   * reserve -> occupied seat   place the reserve, return the displaced one to pool.
//   * seat    -> pool            unassign a seated occupant back to "Не рассажены".
//
// PR 16 — reserves: a reserve is a UI-created operational placeholder
// (`assignment_type='reserve'`, no registration). It lives in the same
// `assignments` array as a pooled entry (`seatKey === null`) until placed, so a
// seated reserve moves/swaps/unassigns through the generic `seat` source like any
// occupant. Reserves represent the rabbi's operational guests (габай, гость
// раввина) and are therefore allowed onto rabbi-reserved seats; ordinary
// registration guests are still blocked from them.
//
// Rejections (no-op, the caller decides whether/how to surface them):
//   * dropping onto the same seat;
//   * dropping onto a rabbi-reserved seat with an ordinary (non-rabbi) guest;
//   * an out-of-range seat index;
//   * a missing source occupant / missing pool guest / missing pooled reserve;
//   * a guest that is already seated (duplicate assignment).
//
// Seat keys are always rebuilt from the geometry via `seatingSeatKey`, which is
// derived from the stable `client_table_id`, never the volatile DB row id.

import {
  isExplicitRabbiGuest,
  seatIndexFromSeatKey,
  seatingSeatKey,
} from "./seatingAutoAssign";
import type {
  SeatingAssignment,
  SeatingGeometryResult,
  SeatingGuestPoolItem,
} from "../types/seating";

export type SeatingDragSourceRef =
  | { kind: "pool"; guestKey: string }
  | { kind: "reserve"; reserveId: string }
  | { kind: "seat"; seatIndex: number };

export type SeatingDropTargetRef =
  | { kind: "seat"; seatIndex: number }
  | { kind: "pool" };

export type SeatingDragDropRejection =
  | "noop"
  | "seat_out_of_range"
  | "rabbi_reserved_seat"
  | "missing_guest"
  | "missing_reserve"
  | "missing_source_occupant"
  | "duplicate_guest";

export interface SeatingDragDropInput {
  assignments: readonly SeatingAssignment[];
  geometry: SeatingGeometryResult;
  guestPool: readonly SeatingGuestPoolItem[];
  source: SeatingDragSourceRef;
  target: SeatingDropTargetRef;
}

export interface SeatingDragDropResult {
  /** The next assignments array (always a fresh copy). */
  assignments: SeatingAssignment[];
  /** `true` when the move changed the assignments; `false` for a rejected no-op. */
  changed: boolean;
  /** Set when `changed` is `false` and the move was rejected for a reason. */
  rejection?: SeatingDragDropRejection;
}

export function applySeatingDragDrop({
  assignments,
  geometry,
  guestPool,
  source,
  target,
}: SeatingDragDropInput): SeatingDragDropResult {
  const next = assignments.map((assignment) => ({ ...assignment }));
  const placedPosByIndex = indexPlacedAssignments(next, geometry);

  // ---- resolve the moving entity ----------------------------------------
  let sourcePos: number | null = null;
  let movingGuest: SeatingGuestPoolItem | null = null;
  let movingIsReserve = false;

  if (source.kind === "seat") {
    const pos = placedPosByIndex.get(source.seatIndex);
    if (pos === undefined) {
      return rejection(assignments, "missing_source_occupant");
    }
    sourcePos = pos;
    movingIsReserve = next[pos].type === "reserve";
  } else if (source.kind === "reserve") {
    // A pooled reserve is already an assignment (seatKey === null); place it by
    // setting its seatKey. It can never be on two seats: there is exactly one
    // pooled entry per reserve id.
    const pos = next.findIndex(
      (assignment) =>
        assignment.type === "reserve" &&
        assignment.id === source.reserveId &&
        !assignment.seatKey,
    );
    if (pos < 0) {
      return rejection(assignments, "missing_reserve");
    }
    sourcePos = pos;
    movingIsReserve = true;
  } else {
    movingGuest = guestPool.find((guest) => guest.key === source.guestKey) ?? null;
    if (!movingGuest) {
      return rejection(assignments, "missing_guest");
    }
    if (next.some((assignment) => assignment.seatKey && matchesGuest(assignment, movingGuest!))) {
      return rejection(assignments, "duplicate_guest");
    }
  }

  // ---- target: pool (unassign) ------------------------------------------
  if (target.kind === "pool") {
    if (source.kind !== "seat" || sourcePos === null) {
      // Dragging a pool chip / pooled reserve back to the pool is a no-op.
      return rejection(assignments, "noop");
    }
    next[sourcePos] = unplaceAssignment(next[sourcePos]);
    return { assignments: next, changed: true };
  }

  // ---- target: seat -----------------------------------------------------
  const targetIndex = target.seatIndex;
  if (targetIndex < 0 || targetIndex >= geometry.seats.length) {
    return rejection(assignments, "seat_out_of_range");
  }

  if (source.kind === "seat" && source.seatIndex === targetIndex) {
    return rejection(assignments, "noop");
  }

  const movingIsRabbi =
    source.kind === "pool"
      ? isExplicitRabbiGuest(movingGuest!)
      : source.kind === "seat"
        ? isRabbiSeatedOccupant(next[sourcePos!], geometry, guestPool)
        : false;

  // Reserves may take rabbi-reserved seats (they ARE the rabbi/admin reserve);
  // only ordinary registration guests are blocked there.
  if (isRabbiReservedSeat(geometry, targetIndex) && !movingIsRabbi && !movingIsReserve) {
    return rejection(assignments, "rabbi_reserved_seat");
  }

  const targetSeatKey = seatingSeatKey(geometry.seats[targetIndex], targetIndex);
  const targetPos = placedPosByIndex.get(targetIndex);

  if (source.kind === "seat") {
    const sPos = sourcePos!;
    const sourceSeatKey = next[sPos].seatKey as string;

    if (targetPos !== undefined) {
      // swap — the displaced occupant takes the source seat; guard the rabbi seat
      // (a reserve is allowed back onto a rabbi-reserved source seat).
      const displacedIsRabbi = isRabbiSeatedOccupant(next[targetPos], geometry, guestPool);
      const displacedIsReserve = next[targetPos].type === "reserve";
      if (
        isRabbiReservedSeat(geometry, source.seatIndex) &&
        !displacedIsRabbi &&
        !displacedIsReserve
      ) {
        return rejection(assignments, "rabbi_reserved_seat");
      }
      next[targetPos] = markManual({ ...next[targetPos], seatKey: sourceSeatKey });
    }

    next[sPos] = markManual({ ...next[sPos], seatKey: targetSeatKey });
    return { assignments: next, changed: true };
  }

  // source: pooled reserve or pool guest — place onto the target seat, returning
  // any displaced occupant to the pool.
  if (targetPos !== undefined) {
    next[targetPos] = unplaceAssignment(next[targetPos]);
  }

  if (source.kind === "reserve") {
    next[sourcePos!] = markManual({ ...next[sourcePos!], seatKey: targetSeatKey });
    return { assignments: next, changed: true };
  }

  const guest = movingGuest!;
  const placed = markManual(placedAssignmentFromGuest(guest, targetSeatKey));
  const pooledPos = next.findIndex(
    (assignment) => !assignment.seatKey && matchesGuest(assignment, guest),
  );
  if (pooledPos >= 0) {
    next[pooledPos] = placed;
  } else {
    next.push(placed);
  }
  return { assignments: next, changed: true };
}

function indexPlacedAssignments(
  assignments: readonly SeatingAssignment[],
  geometry: SeatingGeometryResult,
): Map<number, number> {
  const byIndex = new Map<number, number>();
  assignments.forEach((assignment, pos) => {
    if (!assignment.seatKey) {
      return;
    }
    const seatIndex = seatIndexFromSeatKey(assignment.seatKey, geometry);
    if (seatIndex === null || byIndex.has(seatIndex)) {
      return;
    }
    byIndex.set(seatIndex, pos);
  });
  return byIndex;
}

function rejection(
  assignments: readonly SeatingAssignment[],
  reason: SeatingDragDropRejection,
): SeatingDragDropResult {
  return {
    assignments: assignments.map((assignment) => ({ ...assignment })),
    changed: false,
    rejection: reason,
  };
}

function markManual(assignment: SeatingAssignment): SeatingAssignment {
  return { ...assignment, locked: true, placementSource: "manual" };
}

function unplaceAssignment(assignment: SeatingAssignment): SeatingAssignment {
  return {
    ...assignment,
    locked: false,
    placementSource: undefined,
    seatKey: null,
  };
}

function placedAssignmentFromGuest(
  guest: SeatingGuestPoolItem,
  seatKey: string,
): SeatingAssignment {
  return {
    guestInitials: guest.initials,
    guestLabel: guest.displayName,
    id: `manual:${guest.key}:${seatKey}`,
    layoutId: "",
    registrationId: guest.registrationId,
    seatKey,
    type: "guest",
  };
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

function isRabbiReservedSeat(
  geometry: SeatingGeometryResult,
  seatIndex: number,
): boolean {
  return Boolean(geometry.seats[seatIndex]?.isRabbiTable);
}

function isRabbiSeatedOccupant(
  assignment: SeatingAssignment,
  geometry: SeatingGeometryResult,
  guestPool: readonly SeatingGuestPoolItem[],
): boolean {
  const guest = guestPool.find((candidate) => matchesGuest(assignment, candidate));
  if (guest && isExplicitRabbiGuest(guest)) {
    return true;
  }

  // A guest already seated on a rabbi-reserved seat is allowed to stay/return
  // there (e.g. the rabbi head occupant swapping within the rabbi area).
  const seatIndex = assignment.seatKey
    ? seatIndexFromSeatKey(assignment.seatKey, geometry)
    : null;
  return seatIndex !== null && isRabbiReservedSeat(geometry, seatIndex);
}
