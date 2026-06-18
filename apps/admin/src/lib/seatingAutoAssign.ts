import {
  computeTableSeats,
  pickRabbiHeadIndex,
  rabbiSeatIndexes,
  spreadSeatIndexes,
} from "./seatingGeometry";
import type {
  ComputedSeat,
  SeatingAssignment,
  SeatingAssignmentEntry,
  SeatingConnection,
  SeatingGeometryResult,
  SeatingGuestPoolItem,
  SeatingSeatOccupant,
  SeatingTable,
} from "../types/seating";

const INACTIVE_ASSIGNMENT_STATUSES = new Set([
  "cancelled",
  "rejected",
  "no_show",
  "waitlisted",
]);
const RABBI_MARKERS = new Set([
  "rabbi",
  "ravvin",
  "раввин",
  "rabbi_guest",
  "rabbi-participant",
  "rabbi_participant",
]);

export type SeatingAutoAssignWarningCode =
  | "empty_guest_pool"
  | "no_tables"
  | "not_enough_physical_seats";

export type SeatingAutoAssignWarning = {
  code: SeatingAutoAssignWarningCode;
  overflowCount?: number;
};

export type SeatingAutoAssignedSeat = {
  guest: SeatingGuestPoolItem;
  isRabbiHead: boolean;
  seatIndex: number;
  seatKey: string;
};

export type SeatingAutoAssignInput = {
  blockedSeatIndexes?: readonly number[];
  capacityUnitId?: string;
  connections?: readonly SeatingConnection[];
  geometry?: SeatingGeometryResult;
  guestPool: readonly SeatingGuestPoolItem[];
  occurrenceId?: string | null;
  rabbiGuestKeys?: readonly string[];
  tables: readonly SeatingTable[];
};

export type SeatingAutoAssignResult = {
  assignedSeats: SeatingAutoAssignedSeat[];
  blockedRabbiSeats: number[];
  geometry: SeatingGeometryResult;
  remainingUnassignedGuests: SeatingGuestPoolItem[];
  warning?: SeatingAutoAssignWarning;
};

export type SeatingAssignmentRestoreState = {
  currentAssignments: SeatingAssignment[];
  invalidAssignments: SeatingAssignment[];
  occupiedCount: number;
  occupants: SeatingSeatOccupant[];
  unassignedGuests: SeatingGuestPoolItem[];
};

type RabbiMarkerRecord = {
  assignmentType?: unknown;
  isRabbi?: unknown;
  isRabbiGuest?: unknown;
  marker?: unknown;
  role?: unknown;
  roleCode?: unknown;
  source?: unknown;
  tags?: unknown;
};

export function autoAssignSeating({
  blockedSeatIndexes = [],
  capacityUnitId,
  connections = [],
  geometry: providedGeometry,
  guestPool,
  occurrenceId,
  rabbiGuestKeys = [],
  tables,
}: SeatingAutoAssignInput): SeatingAutoAssignResult {
  const geometry =
    providedGeometry ??
    computeTableSeats({
      connections: [...connections],
      tables: [...tables],
    });
  const activeGuests = uniqueAssignmentGuests(
    guestPool
      .filter((guest) => isGuestInSlot(guest, capacityUnitId, occurrenceId))
      .filter(isActiveAssignmentGuest),
  );

  if (tables.length === 0) {
    return {
      assignedSeats: [],
      blockedRabbiSeats: [],
      geometry,
      remainingUnassignedGuests: activeGuests,
      warning: activeGuests.length > 0 ? { code: "no_tables" } : { code: "empty_guest_pool" },
    };
  }

  if (activeGuests.length === 0) {
    return {
      assignedSeats: [],
      blockedRabbiSeats: blockedRabbiSeatIndexes(geometry, tables),
      geometry,
      remainingUnassignedGuests: [],
      warning: { code: "empty_guest_pool" },
    };
  }

  const headIndex = resolveHeadIndex(geometry, tables);
  const blockedRabbiSeats = blockedRabbiSeatIndexes(geometry, tables);
  const blockedSeats = new Set([...blockedRabbiSeats, ...blockedSeatIndexes]);
  const rabbiGuest = activeGuests.find((guest) =>
    isExplicitRabbiGuest(guest, rabbiGuestKeys),
  );
  const assignedSeats: SeatingAutoAssignedSeat[] = [];
  const queue = activeGuests.filter((guest) => guest !== rabbiGuest);

  if (rabbiGuest && headIndex >= 0 && geometry.seats[headIndex]) {
    assignedSeats.push({
      guest: rabbiGuest,
      isRabbiHead: true,
      seatIndex: headIndex,
      seatKey: seatingSeatKey(geometry.seats[headIndex], headIndex),
    });
  }

  const assignableCount = countAssignableRegularSeats(geometry, blockedSeats);
  const targetIndexes = spreadSeatIndexes(
    geometry.seats.length,
    Math.min(queue.length, assignableCount),
    headIndex,
    blockedSeats,
  );

  targetIndexes.forEach((seatIndex, queueIndex) => {
    const guest = queue[queueIndex];
    const seat = geometry.seats[seatIndex];
    if (!guest || !seat) return;

    assignedSeats.push({
      guest,
      isRabbiHead: false,
      seatIndex,
      seatKey: seatingSeatKey(seat, seatIndex),
    });
  });

  const remainingUnassignedGuests = [
    ...(rabbiGuest && !assignedSeats.some((seat) => seat.guest === rabbiGuest)
      ? [rabbiGuest]
      : []),
    ...queue.slice(targetIndexes.length),
  ];

  return {
    assignedSeats,
    blockedRabbiSeats,
    geometry,
    remainingUnassignedGuests,
    warning:
      remainingUnassignedGuests.length > 0
        ? {
            code: "not_enough_physical_seats",
            overflowCount: remainingUnassignedGuests.length,
          }
        : undefined,
  };
}

export function autoAssignResultToPayloadEntries(
  result: SeatingAutoAssignResult,
): {
  chairs: SeatingAssignmentEntry[];
  pool: SeatingAssignmentEntry[];
} {
  return {
    chairs: result.assignedSeats.map(({ guest, seatKey }) =>
      guestToAssignmentEntry(guest, seatKey),
    ),
    pool: result.remainingUnassignedGuests.map((guest) =>
      guestToAssignmentEntry(guest, null),
    ),
  };
}

export function autoAssignResultToAssignments(
  result: SeatingAutoAssignResult,
): SeatingAssignment[] {
  return [
    ...result.assignedSeats.map(({ guest, seatKey }) =>
      assignmentFromGuest(guest, seatKey),
    ),
    ...result.remainingUnassignedGuests.map((guest) =>
      assignmentFromGuest(guest, null),
    ),
  ];
}

export function deriveSeatingAssignmentRestoreState({
  assignments,
  geometry,
  guestPool,
}: {
  assignments: readonly SeatingAssignment[];
  geometry: SeatingGeometryResult;
  guestPool: readonly SeatingGuestPoolItem[];
}): SeatingAssignmentRestoreState {
  const usedSeatIndexes = new Set<number>();
  const currentAssignments: SeatingAssignment[] = [];
  const invalidAssignments: SeatingAssignment[] = [];
  const occupants: SeatingSeatOccupant[] = [];

  assignments.forEach((assignment) => {
    const fallbackGuest = findGuestPoolFallback(guestPool, assignment);
    const normalizedAssignment = normalizeAssignmentDisplay(assignment, fallbackGuest);
    const seatIndex = seatIndexFromSeatKey(normalizedAssignment.seatKey, geometry);

    if (!normalizedAssignment.seatKey) {
      currentAssignments.push(normalizedAssignment);
      return;
    }

    if (seatIndex === null || usedSeatIndexes.has(seatIndex)) {
      invalidAssignments.push(normalizedAssignment);
      currentAssignments.push({
        ...normalizedAssignment,
        seatKey: null,
      });
      return;
    }

    usedSeatIndexes.add(seatIndex);
    currentAssignments.push(normalizedAssignment);
    occupants.push({
      displayName: normalizedAssignment.guestLabel?.trim() || "Гость",
      id: normalizedAssignment.id,
      initials: normalizedAssignment.guestInitials?.trim() || "?",
      isRabbiHead:
        seatIndex === geometry.headIndex && Boolean(geometry.seats[seatIndex]?.isRabbiTable),
      registrationId: normalizedAssignment.registrationId,
      seatIndex,
      seatKey: normalizedAssignment.seatKey,
      type: normalizedAssignment.type,
    });
  });

  occupants.sort((a, b) => a.seatIndex - b.seatIndex);

  return {
    currentAssignments,
    invalidAssignments,
    occupiedCount: occupants.filter(
      (occupant) => occupant.type === "guest" && occupant.registrationId,
    ).length,
    occupants,
    unassignedGuests: filterUnassignedGuests(guestPool, currentAssignments),
  };
}

export function seatingSeatKey(seat: ComputedSeat, seatIndex: number): string {
  return `${seat.tableId}:${seatStablePart(seat) ?? `legacy:${seatIndex}`}`;
}

export function seatIndexFromSeatKey(
  seatKey: string | null | undefined,
  geometry?: SeatingGeometryResult,
): number | null {
  if (!seatKey) {
    return null;
  }

  const stableSeatIndex = stableSeatIndexFromSeatKey(seatKey, geometry);
  if (stableSeatIndex !== null) {
    return stableSeatIndex;
  }

  return legacySeatIndexFromSeatKey(seatKey, geometry);
}

export function isExplicitRabbiGuest(
  guest: SeatingGuestPoolItem,
  rabbiGuestKeys: readonly string[] = [],
): boolean {
  const keys = new Set(rabbiGuestKeys);
  if (keys.has(guest.key) || keys.has(guest.id)) {
    return true;
  }

  const marker = guest as SeatingGuestPoolItem & RabbiMarkerRecord;
  if (marker.isRabbi === true || marker.isRabbiGuest === true) {
    return true;
  }

  return [
    marker.assignmentType,
    marker.marker,
    marker.role,
    marker.roleCode,
    marker.source,
  ].some(isRabbiMarkerValue) || isRabbiTagList(marker.tags);
}

function blockedRabbiSeatIndexes(
  geometry: SeatingGeometryResult,
  tables: readonly SeatingTable[],
): number[] {
  const indexes = rabbiSeatIndexes(geometry.seats);
  const headIndex = resolveHeadIndex(geometry, tables);

  if (indexes.size === 0 && headIndex >= 0) {
    indexes.add(headIndex);
  }

  return Array.from(indexes).sort((a, b) => a - b);
}

function countAssignableRegularSeats(
  geometry: SeatingGeometryResult,
  blockedSeats: Set<number>,
): number {
  let count = 0;
  geometry.seats.forEach((_, index) => {
    if (!blockedSeats.has(index)) {
      count += 1;
    }
  });
  return count;
}

function guestToAssignmentEntry(
  guest: SeatingGuestPoolItem,
  seatKey: string | null,
): SeatingAssignmentEntry {
  return {
    initials: guest.initials,
    name: guest.displayName,
    registrationId: guest.registrationId,
    seatKey,
    type: "guest",
  };
}

function assignmentFromGuest(
  guest: SeatingGuestPoolItem,
  seatKey: string | null,
): SeatingAssignment {
  return {
    guestInitials: guest.initials,
    guestLabel: guest.displayName,
    id: `auto:${guest.key}:${seatKey ?? "pool"}`,
    layoutId: "",
    registrationId: guest.registrationId,
    seatKey,
    type: "guest",
  };
}

function normalizeAssignmentDisplay(
  assignment: SeatingAssignment,
  fallbackGuest: SeatingGuestPoolItem | null,
): SeatingAssignment {
  return {
    ...assignment,
    guestInitials: assignment.guestInitials?.trim() || fallbackGuest?.initials || null,
    guestLabel: assignment.guestLabel?.trim() || fallbackGuest?.displayName || null,
  };
}

function filterUnassignedGuests(
  guestPool: readonly SeatingGuestPoolItem[],
  assignments: readonly SeatingAssignment[],
): SeatingGuestPoolItem[] {
  const assignedCounts = new Map<string, number>();
  const assignedRegistrationFallbackCounts = new Map<string, number>();

  assignments.forEach((assignment) => {
    if (!assignment.seatKey || assignment.type !== "guest") {
      return;
    }

    if (!assignment.guestLabel && !assignment.guestInitials && assignment.registrationId) {
      assignedRegistrationFallbackCounts.set(
        assignment.registrationId,
        (assignedRegistrationFallbackCounts.get(assignment.registrationId) ?? 0) + 1,
      );
      return;
    }

    const signature = assignmentGuestSignature(
      assignment.registrationId,
      assignment.guestLabel,
      assignment.guestInitials,
    );
    assignedCounts.set(signature, (assignedCounts.get(signature) ?? 0) + 1);
  });

  return guestPool.filter((guest) => {
    const signature = assignmentGuestSignature(
      guest.registrationId,
      guest.displayName,
      guest.initials,
    );
    const count = assignedCounts.get(signature) ?? 0;

    if (count > 0) {
      assignedCounts.set(signature, count - 1);
      return false;
    }

    const registrationCount = guest.registrationId
      ? assignedRegistrationFallbackCounts.get(guest.registrationId) ?? 0
      : 0;

    if (registrationCount > 0 && guest.registrationId) {
      assignedRegistrationFallbackCounts.set(
        guest.registrationId,
        registrationCount - 1,
      );
      return false;
    }

    return true;
  });
}

function findGuestPoolFallback(
  guestPool: readonly SeatingGuestPoolItem[],
  assignment: SeatingAssignment,
): SeatingGuestPoolItem | null {
  const signature = assignmentGuestSignature(
    assignment.registrationId,
    assignment.guestLabel,
    assignment.guestInitials,
  );

  return (
    guestPool.find(
      (guest) =>
        assignmentGuestSignature(
          guest.registrationId,
          guest.displayName,
          guest.initials,
        ) === signature,
    ) ??
    guestPool.find((guest) => guest.registrationId === assignment.registrationId) ??
    null
  );
}

function assignmentGuestSignature(
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

function seatStablePart(seat: ComputedSeat): string | null {
  if (seat.kind === "side" && seat.edge && typeof seat.slot === "number") {
    return `side:${seat.edge}:${seat.slot}`;
  }

  if (seat.kind === "end" && seat.end) {
    return `end:${seat.end}`;
  }

  return null;
}

function stableSeatIndexFromSeatKey(
  seatKey: string,
  geometry?: SeatingGeometryResult,
): number | null {
  if (!geometry) {
    return null;
  }

  const sideMatch = /^(.*):side:([ab]):(\d+)$/.exec(seatKey);
  if (sideMatch) {
    const [, tableId, edge, rawSlot] = sideMatch;
    const slot = Number(rawSlot);
    if (!Number.isInteger(slot) || slot < 0) {
      return null;
    }

    return findSeatIndex(geometry, (seat) =>
      seat.tableId === tableId &&
      seat.kind === "side" &&
      seat.edge === edge &&
      seat.slot === slot,
    );
  }

  const endMatch = /^(.*):end:([ab])$/.exec(seatKey);
  if (endMatch) {
    const [, tableId, end] = endMatch;
    return findSeatIndex(geometry, (seat) =>
      seat.tableId === tableId && seat.kind === "end" && seat.end === end,
    );
  }

  return null;
}

function legacySeatIndexFromSeatKey(
  seatKey: string,
  geometry?: SeatingGeometryResult,
): number | null {
  if (seatKey.includes(":side:") || seatKey.includes(":end:")) {
    return null;
  }

  const match = /^(.*):(\d+)$/.exec(seatKey);
  if (!match) {
    return null;
  }

  const tableId = match[1];
  const seatIndex = Number(match[2]);
  if (!Number.isInteger(seatIndex) || seatIndex < 0) {
    return null;
  }

  if (!geometry) {
    return seatIndex;
  }

  const seat = geometry.seats[seatIndex];
  if (seat?.tableId === tableId) {
    return seatIndex;
  }

  // PR 14 originally saved `${tableId}:${globalSeatIndex}`. Reopened layouts may
  // be ordered differently by the read RPC, so recover the occupant on the same
  // table instead of dropping a valid saved assignment.
  const sameTableIndexes = geometry.seats
    .map((candidate, index) => ({ candidate, index }))
    .filter(({ candidate }) => candidate.tableId === tableId)
    .map(({ index }) => index);

  if (sameTableIndexes.length === 0) {
    return null;
  }

  return sameTableIndexes[seatIndex % sameTableIndexes.length] ?? null;
}

function findSeatIndex(
  geometry: SeatingGeometryResult,
  predicate: (seat: ComputedSeat) => boolean,
): number | null {
  const index = geometry.seats.findIndex(predicate);
  return index >= 0 ? index : null;
}

function isActiveAssignmentGuest(guest: SeatingGuestPoolItem): boolean {
  const status = guest.status?.toLowerCase();
  return !status || !INACTIVE_ASSIGNMENT_STATUSES.has(status);
}

function isGuestInSlot(
  guest: SeatingGuestPoolItem,
  capacityUnitId: string | undefined,
  occurrenceId: string | null | undefined,
): boolean {
  if (capacityUnitId && guest.capacityUnitId !== capacityUnitId) {
    return false;
  }

  if (occurrenceId !== undefined && (guest.occurrenceId ?? null) !== occurrenceId) {
    return false;
  }

  return true;
}

function uniqueAssignmentGuests(
  guests: readonly SeatingGuestPoolItem[],
): SeatingGuestPoolItem[] {
  const seen = new Set<string>();
  const out: SeatingGuestPoolItem[] = [];

  guests.forEach((guest) => {
    const key = assignmentGuestKey(guest);
    if (seen.has(key)) {
      return;
    }

    seen.add(key);
    out.push(guest);
  });

  return out;
}

function assignmentGuestKey(guest: SeatingGuestPoolItem): string {
  return [
    guest.registrationId,
    guest.capacityUnitId,
    guest.occurrenceId ?? "",
    guest.source,
    guest.guestIndex ?? 0,
    guest.key,
  ].join("|");
}

function isRabbiMarkerValue(value: unknown): boolean {
  if (typeof value !== "string") {
    return false;
  }

  return RABBI_MARKERS.has(value.trim().toLowerCase());
}

function isRabbiTagList(value: unknown): boolean {
  return Array.isArray(value) && value.some(isRabbiMarkerValue);
}

function resolveHeadIndex(
  geometry: SeatingGeometryResult,
  tables: readonly SeatingTable[],
): number {
  if (geometry.seats.length === 0) {
    return -1;
  }

  const hint =
    geometry.seats[geometry.headIndex] ??
    geometry.seats.find((seat) => seat.isRabbiTable) ??
    geometry.seats[0];

  return pickRabbiHeadIndex([...tables], geometry.seats, hint);
}
