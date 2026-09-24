import {
  computeTableSeats,
  pickRabbiHeadIndex,
  rabbiSeatIndexes,
} from "./seatingGeometry";
import {
  createSeatingGuestIndex,
  resolveSeatingAssignmentGuests,
  type SeatingGuestIndex,
} from "./seatingGuestIndex";
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
  guestIndex?: SeatingGuestIndex;
  guestPool: readonly SeatingGuestPoolItem[];
  /**
   * PR 15: assignments that must be preserved by a repeat auto seating. Their
   * seats are treated as occupied (blocked) and their guests are excluded from
   * the queue, so auto seating only fills the remaining empty seats with the
   * still-unassigned pool guests. The locked assignments themselves are NOT
   * returned in `assignedSeats`; the caller keeps them and merges the new
   * assignments on top (see `SeatingLayoutEditor.handleAutoAssign`).
   */
  lockedAssignments?: readonly SeatingAssignment[];
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
  resolvedGuests: Array<SeatingGuestPoolItem | null>;
};

export type SeatingSeatIndex = ReadonlyMap<string, number>;

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

type LockedPlacements = {
  guestKeys: Set<string>;
  seatIndexes: Set<number>;
  tableIdsByRegistration: Map<string, string[]>;
};

type AutoSeatingParty = {
  anchorTableIds: string[];
  members: SeatingGuestPoolItem[];
  registrationId: string;
};

export function autoAssignSeating({
  blockedSeatIndexes = [],
  capacityUnitId,
  connections = [],
  geometry: providedGeometry,
  guestIndex: providedGuestIndex,
  guestPool,
  lockedAssignments = [],
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

  // PR 15: keep locked/manual placements where they are. Their seats are blocked
  // and their guests are dropped from the queue, so auto only fills the rest.
  const guestIndex = providedGuestIndex ?? createSeatingGuestIndex(guestPool);
  const locked = resolveLockedPlacements(
    lockedAssignments,
    geometry,
    resolveSeatingAssignmentGuests(lockedAssignments, guestIndex),
  );
  const headIndex = resolveHeadIndex(geometry, tables);
  const blockedRabbiSeats = blockedRabbiSeatIndexes(geometry, tables);
  const blockedSeats = new Set([
    ...blockedRabbiSeats,
    ...blockedSeatIndexes,
    ...geometry.seats.flatMap((seat, index) => (seat.isDisabled ? [index] : [])),
    ...locked.seatIndexes,
  ]);
  const queueGuests = excludeLockedGuests(activeGuests, locked.guestKeys);
  const rabbiGuest = queueGuests.find((guest) =>
    isExplicitRabbiGuest(guest, rabbiGuestKeys),
  );
  const assignedSeats: SeatingAutoAssignedSeat[] = [];
  const queue = queueGuests.filter((guest) => guest !== rabbiGuest);

  if (
    rabbiGuest &&
    headIndex >= 0 &&
    geometry.seats[headIndex] &&
    !geometry.seats[headIndex].isDisabled &&
    !locked.seatIndexes.has(headIndex)
  ) {
    assignedSeats.push({
      guest: rabbiGuest,
      isRabbiHead: true,
      seatIndex: headIndex,
      seatKey: seatingSeatKey(geometry.seats[headIndex], headIndex),
    });
  }

  const tableOrder = buildStableTableOrder(tables, geometry);
  const tableRank = new Map(tableOrder.map((tableId, index) => [tableId, index]));
  const freeSeatsByTable = buildEligibleSeatsByTable(geometry, blockedSeats);
  const adjacency = buildConnectionAdjacency(tableOrder, connections);
  const parties = buildAutoSeatingParties(
    queue,
    locked.tableIdsByRegistration,
  );
  const unassignedPartyGuests = parties.flatMap((party) =>
    placeParty({
      adjacency,
      assignedSeats,
      freeSeatsByTable,
      geometry,
      party,
      tableOrder,
      tableRank,
    }),
  );

  const remainingUnassignedGuests = [
    ...(rabbiGuest && !assignedSeats.some((seat) => seat.guest === rabbiGuest)
      ? [rabbiGuest]
      : []),
    ...unassignedPartyGuests,
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

/**
 * Returns whether an existing placement must survive a repeat automatic run.
 *
 * Manual drag/drop decisions carry the lock in the live editor session. Reserves
 * have always occupied a physical chair independently of registration seating,
 * so they remain protected as well. System-generated placements deliberately do
 * not match this predicate and may be recalculated.
 */
export function isProtectedSeatingAssignment(assignment: SeatingAssignment): boolean {
  return assignment.type === "reserve" || Boolean(assignment.locked) || assignment.placementSource === "manual";
}

/**
 * Assignment lock metadata is intentionally not part of the persisted API
 * contract. On a layout reload we therefore preserve every existing placement
 * conservatively: the editor cannot know whether it came from a prior automatic
 * run or from a manual admin decision. New system placements remain unlocked in
 * the active editor session and can still be recalculated.
 */
export function protectPersistedSeatingAssignments(
  assignments: readonly SeatingAssignment[],
): SeatingAssignment[] {
  return assignments.map((assignment) =>
    assignment.seatKey && !isProtectedSeatingAssignment(assignment)
      ? { ...assignment, locked: true }
      : { ...assignment },
  );
}

export function deriveSeatingAssignmentRestoreState({
  assignments,
  geometry,
  guestPool,
  guestIndex = createSeatingGuestIndex(guestPool),
  resolvedGuests = resolveSeatingAssignmentGuests(assignments, guestIndex),
  seatIndex = createSeatingSeatIndex(geometry),
}: {
  assignments: readonly SeatingAssignment[];
  geometry: SeatingGeometryResult;
  guestPool: readonly SeatingGuestPoolItem[];
  guestIndex?: SeatingGuestIndex;
  resolvedGuests?: readonly (SeatingGuestPoolItem | null)[];
  seatIndex?: SeatingSeatIndex;
}): SeatingAssignmentRestoreState {
  const usedSeatIndexes = new Set<number>();
  const currentAssignments: SeatingAssignment[] = [];
  const invalidAssignments: SeatingAssignment[] = [];
  const occupants: SeatingSeatOccupant[] = [];
  const assignedGuestKeys = new Set<string>();

  assignments.forEach((assignment, order) => {
    const fallbackGuest = resolvedGuests[order] ?? null;
    const normalizedAssignment = normalizeAssignmentDisplay(assignment, fallbackGuest);
    const resolvedSeatIndex = seatIndexFromSeatKey(normalizedAssignment.seatKey, geometry, seatIndex);

    if (!normalizedAssignment.seatKey) {
      currentAssignments.push(normalizedAssignment);
      return;
    }

    if (resolvedSeatIndex === null || geometry.seats[resolvedSeatIndex]?.isDisabled || usedSeatIndexes.has(resolvedSeatIndex)) {
      invalidAssignments.push(normalizedAssignment);
      currentAssignments.push(unplaceAssignment(normalizedAssignment));
      return;
    }

    usedSeatIndexes.add(resolvedSeatIndex);
    if (fallbackGuest) assignedGuestKeys.add(fallbackGuest.key);
    currentAssignments.push(normalizedAssignment);
    occupants.push({
      displayName: normalizedAssignment.guestLabel?.trim() || "Гость",
      id: normalizedAssignment.id,
      initials: normalizedAssignment.guestInitials?.trim() || "?",
      isRabbiHead:
        resolvedSeatIndex === geometry.headIndex && Boolean(geometry.seats[resolvedSeatIndex]?.isRabbiTable),
      locked: normalizedAssignment.locked,
      placementSource: normalizedAssignment.placementSource,
      registrationId: normalizedAssignment.registrationId,
      seatIndex: resolvedSeatIndex,
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
    unassignedGuests: guestPool.filter((guest) => !assignedGuestKeys.has(guest.key)),
    resolvedGuests: [...resolvedGuests],
  };
}

export function seatingSeatKey(seat: ComputedSeat, seatIndex: number): string {
  return `${seat.tableId}:${seatStablePart(seat) ?? `legacy:${seatIndex}`}`;
}

function unplaceAssignment(assignment: SeatingAssignment): SeatingAssignment {
  return {
    ...assignment,
    locked: false,
    placementSource: undefined,
    seatKey: null,
  };
}

export function seatIndexFromSeatKey(
  seatKey: string | null | undefined,
  geometry?: SeatingGeometryResult,
  seatIndex?: SeatingSeatIndex,
): number | null {
  if (!seatKey) {
    return null;
  }

  const stableSeatIndex = seatIndex?.get(seatKey) ?? stableSeatIndexFromSeatKey(seatKey, geometry);
  if (stableSeatIndex !== null) {
    return stableSeatIndex;
  }

  return legacySeatIndexFromSeatKey(seatKey, geometry);
}

export function createSeatingSeatIndex(geometry: SeatingGeometryResult): SeatingSeatIndex {
  return new Map(geometry.seats.map((seat, index) => [seatingSeatKey(seat, index), index]));
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

function buildStableTableOrder(
  tables: readonly SeatingTable[],
  geometry: SeatingGeometryResult,
): string[] {
  const seen = new Set<string>();
  const tableOrder: string[] = [];

  const add = (tableId: string) => {
    if (seen.has(tableId)) return;
    seen.add(tableId);
    tableOrder.push(tableId);
  };

  tables.forEach((table) => add(table.id));
  geometry.seats.forEach((seat) => add(seat.tableId));
  return tableOrder;
}

function buildEligibleSeatsByTable(
  geometry: SeatingGeometryResult,
  blockedSeats: ReadonlySet<number>,
): Map<string, number[]> {
  const seatsByTable = new Map<string, number[]>();

  geometry.seats.forEach((seat, seatIndex) => {
    if (blockedSeats.has(seatIndex)) return;
    const indexes = seatsByTable.get(seat.tableId) ?? [];
    indexes.push(seatIndex);
    seatsByTable.set(seat.tableId, indexes);
  });

  return seatsByTable;
}

function buildConnectionAdjacency(
  tableOrder: readonly string[],
  connections: readonly SeatingConnection[],
): Map<string, string[]> {
  const adjacency = new Map(tableOrder.map((tableId) => [tableId, [] as string[]]));

  connections.forEach((connection) => {
    const a = adjacency.get(connection.aTableId);
    const b = adjacency.get(connection.bTableId);
    if (!a || !b) return;
    if (!a.includes(connection.bTableId)) a.push(connection.bTableId);
    if (!b.includes(connection.aTableId)) b.push(connection.aTableId);
  });

  const rank = new Map(tableOrder.map((tableId, index) => [tableId, index]));
  adjacency.forEach((neighbors) => {
    neighbors.sort((a, b) => tableRankOf(a, rank) - tableRankOf(b, rank));
  });
  return adjacency;
}

function buildAutoSeatingParties(
  guests: readonly SeatingGuestPoolItem[],
  tableIdsByRegistration: ReadonlyMap<string, readonly string[]>,
): AutoSeatingParty[] {
  const parties = new Map<string, SeatingGuestPoolItem[]>();

  guests.forEach((guest) => {
    const members = parties.get(guest.registrationId) ?? [];
    members.push(guest);
    parties.set(guest.registrationId, members);
  });

  return Array.from(parties, ([registrationId, members]) => ({
    anchorTableIds: [...(tableIdsByRegistration.get(registrationId) ?? [])],
    members: [...members].sort(comparePartyMembers),
    registrationId,
  }));
}

function comparePartyMembers(
  a: SeatingGuestPoolItem,
  b: SeatingGuestPoolItem,
): number {
  const sourceOrder = Number(a.source === "guest") - Number(b.source === "guest");
  if (sourceOrder !== 0) return sourceOrder;

  const guestIndexOrder =
    (a.guestIndex ?? Number.MAX_SAFE_INTEGER) -
    (b.guestIndex ?? Number.MAX_SAFE_INTEGER);
  if (guestIndexOrder !== 0) return guestIndexOrder;

  return compareStableStrings(a.key, b.key) || compareStableStrings(a.id, b.id);
}

function placeParty({
  adjacency,
  assignedSeats,
  freeSeatsByTable,
  geometry,
  party,
  tableOrder,
  tableRank,
}: {
  adjacency: ReadonlyMap<string, readonly string[]>;
  assignedSeats: SeatingAutoAssignedSeat[];
  freeSeatsByTable: Map<string, number[]>;
  geometry: SeatingGeometryResult;
  party: AutoSeatingParty;
  tableOrder: readonly string[];
  tableRank: ReadonlyMap<string, number>;
}): SeatingGuestPoolItem[] {
  if (party.members.length === 0) return [];

  const anchorTableIds = party.anchorTableIds.filter((tableId) =>
    tableRank.has(tableId),
  );
  let selectedTableIds: string[] | null = null;

  if (anchorTableIds.length > 0) {
    const anchorTable = chooseWholePartyTable(
      anchorTableIds,
      party.members.length,
      freeSeatsByTable,
      tableRank,
    );
    if (anchorTable) {
      selectedTableIds = [anchorTable];
    } else {
      selectedTableIds = chooseConnectedTableSet({
        adjacency,
        anchorTableIds,
        freeSeatsByTable,
        requiredSeats: party.members.length,
        tableOrder,
        tableRank,
      });
    }
  }

  if (!selectedTableIds) {
    const wholeTable = chooseWholePartyTable(
      tableOrder,
      party.members.length,
      freeSeatsByTable,
      tableRank,
    );
    if (wholeTable) {
      selectedTableIds = [wholeTable];
    }
  }

  if (!selectedTableIds) {
    selectedTableIds = chooseConnectedTableSet({
      adjacency,
      anchorTableIds: [],
      freeSeatsByTable,
      requiredSeats: party.members.length,
      tableOrder,
      tableRank,
    });
  }

  let assignedCount = 0;
  if (selectedTableIds) {
    assignedCount = assignPartyMembers({
      anchorTableIds,
      assignedSeats,
      freeSeatsByTable,
      geometry,
      members: party.members,
      tableIds: selectedTableIds,
      tableRank,
    });
  }

  if (assignedCount < party.members.length) {
    const fallbackTableIds = buildFragmentationOrder({
      adjacency,
      anchorTableIds,
      freeSeatsByTable,
      requiredSeats: party.members.length - assignedCount,
      tableOrder,
      tableRank,
    });
    assignedCount += assignPartyMembers({
      anchorTableIds,
      assignedSeats,
      freeSeatsByTable,
      geometry,
      members: party.members.slice(assignedCount),
      tableIds: fallbackTableIds,
      tableRank,
    });
  }

  return party.members.slice(assignedCount);
}

function chooseWholePartyTable(
  tableIds: readonly string[],
  partySize: number,
  freeSeatsByTable: ReadonlyMap<string, readonly number[]>,
  tableRank: ReadonlyMap<string, number>,
): string | null {
  const candidates = tableIds.filter(
    (tableId) => (freeSeatsByTable.get(tableId)?.length ?? 0) >= partySize,
  );

  candidates.sort((a, b) => {
    const aSeats = freeSeatsByTable.get(a) ?? [];
    const bSeats = freeSeatsByTable.get(b) ?? [];
    return (
      aSeats.length - partySize - (bSeats.length - partySize) ||
      compactSeatSpan(aSeats, partySize) - compactSeatSpan(bSeats, partySize) ||
      tableRankOf(a, tableRank) - tableRankOf(b, tableRank)
    );
  });

  return candidates[0] ?? null;
}

function chooseCompactSeats(
  availableSeatIndexes: readonly number[],
  count: number,
): number[] {
  if (count <= 0) return [];
  if (count >= availableSeatIndexes.length) return [...availableSeatIndexes];

  let bestStart = 0;
  let bestSpan = Number.POSITIVE_INFINITY;
  for (let start = 0; start + count <= availableSeatIndexes.length; start += 1) {
    const span =
      availableSeatIndexes[start + count - 1] - availableSeatIndexes[start];
    if (span < bestSpan) {
      bestSpan = span;
      bestStart = start;
    }
  }
  return availableSeatIndexes.slice(bestStart, bestStart + count);
}

function compactSeatSpan(
  availableSeatIndexes: readonly number[],
  count: number,
): number {
  const selected = chooseCompactSeats(availableSeatIndexes, count);
  if (selected.length < 2) return 0;
  return selected[selected.length - 1] - selected[0];
}

function chooseConnectedTableSet({
  adjacency,
  anchorTableIds,
  freeSeatsByTable,
  requiredSeats,
  tableOrder,
  tableRank,
}: {
  adjacency: ReadonlyMap<string, readonly string[]>;
  anchorTableIds: readonly string[];
  freeSeatsByTable: ReadonlyMap<string, readonly number[]>;
  requiredSeats: number;
  tableOrder: readonly string[];
  tableRank: ReadonlyMap<string, number>;
}): string[] | null {
  const roots =
    anchorTableIds.length > 0
      ? anchorTableIds
      : tableOrder.filter((tableId) => (freeSeatsByTable.get(tableId)?.length ?? 0) > 0);
  const queue: string[][] = [];
  const seen = new Set<string>();

  roots.forEach((root) => {
    if (!adjacency.has(root)) return;
    const key = connectedSetKey([root], tableRank);
    if (seen.has(key)) return;
    seen.add(key);
    queue.push([root]);
  });

  let best: string[] | null = null;
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const current = queue[cursor];
    if (best && current.length > best.length) break;

    const capacity = connectedSetCapacity(current, freeSeatsByTable);
    if (current.length > 1 && capacity >= requiredSeats) {
      if (
        !best ||
        compareConnectedSets(
          current,
          best,
          requiredSeats,
          freeSeatsByTable,
          tableRank,
        ) < 0
      ) {
        best = current;
      }
      continue;
    }

    const nextTableIds = new Set<string>();
    current.forEach((tableId) => {
      (adjacency.get(tableId) ?? []).forEach((neighbor) => {
        if (!current.includes(neighbor)) nextTableIds.add(neighbor);
      });
    });

    Array.from(nextTableIds)
      .sort((a, b) => tableRankOf(a, tableRank) - tableRankOf(b, tableRank))
      .forEach((nextTableId) => {
        const expanded = [...current, nextTableId].sort(
          (a, b) => tableRankOf(a, tableRank) - tableRankOf(b, tableRank),
        );
        if (best && expanded.length > best.length) return;
        const key = connectedSetKey(expanded, tableRank);
        if (seen.has(key)) return;
        seen.add(key);
        queue.push(expanded);
      });
  }

  return best;
}

function compareConnectedSets(
  a: readonly string[],
  b: readonly string[],
  requiredSeats: number,
  freeSeatsByTable: ReadonlyMap<string, readonly number[]>,
  tableRank: ReadonlyMap<string, number>,
): number {
  return (
    a.length - b.length ||
    connectedSetCapacity(a, freeSeatsByTable) - requiredSeats -
      (connectedSetCapacity(b, freeSeatsByTable) - requiredSeats) ||
    compareTableIdLists(a, b, tableRank)
  );
}

function connectedSetCapacity(
  tableIds: readonly string[],
  freeSeatsByTable: ReadonlyMap<string, readonly number[]>,
): number {
  return tableIds.reduce(
    (total, tableId) => total + (freeSeatsByTable.get(tableId)?.length ?? 0),
    0,
  );
}

function connectedSetKey(
  tableIds: readonly string[],
  tableRank: ReadonlyMap<string, number>,
): string {
  return [...tableIds]
    .sort((a, b) => tableRankOf(a, tableRank) - tableRankOf(b, tableRank))
    .join("\u0000");
}

function compareTableIdLists(
  a: readonly string[],
  b: readonly string[],
  tableRank: ReadonlyMap<string, number>,
): number {
  for (let index = 0; index < Math.min(a.length, b.length); index += 1) {
    const difference = tableRankOf(a[index], tableRank) - tableRankOf(b[index], tableRank);
    if (difference !== 0) return difference;
  }
  return a.length - b.length;
}

function assignPartyMembers({
  anchorTableIds,
  assignedSeats,
  freeSeatsByTable,
  geometry,
  members,
  tableIds,
  tableRank,
}: {
  anchorTableIds: readonly string[];
  assignedSeats: SeatingAutoAssignedSeat[];
  freeSeatsByTable: Map<string, number[]>;
  geometry: SeatingGeometryResult;
  members: readonly SeatingGuestPoolItem[];
  tableIds: readonly string[];
  tableRank: ReadonlyMap<string, number>;
}): number {
  const anchorSet = new Set(anchorTableIds);
  const orderedTableIds = [...new Set(tableIds)]
    .filter((tableId) => (freeSeatsByTable.get(tableId)?.length ?? 0) > 0)
    .sort((a, b) => {
      const anchorOrder = Number(anchorSet.has(b)) - Number(anchorSet.has(a));
      if (anchorOrder !== 0) return anchorOrder;
      const capacityOrder =
        (freeSeatsByTable.get(b)?.length ?? 0) -
        (freeSeatsByTable.get(a)?.length ?? 0);
      return capacityOrder || tableRankOf(a, tableRank) - tableRankOf(b, tableRank);
    });

  let assignedCount = 0;
  orderedTableIds.forEach((tableId) => {
    if (assignedCount >= members.length) return;
    const available = freeSeatsByTable.get(tableId) ?? [];
    const selected = chooseCompactSeats(
      available,
      Math.min(available.length, members.length - assignedCount),
    );
    const selectedSet = new Set(selected);

    selected.forEach((seatIndex) => {
      const guest = members[assignedCount];
      const seat = geometry.seats[seatIndex];
      if (!guest || !seat) return;
      assignedSeats.push({
        guest,
        isRabbiHead: false,
        seatIndex,
        seatKey: seatingSeatKey(seat, seatIndex),
      });
      assignedCount += 1;
    });
    freeSeatsByTable.set(
      tableId,
      available.filter((seatIndex) => !selectedSet.has(seatIndex)),
    );
  });

  return assignedCount;
}

function buildFragmentationOrder({
  adjacency,
  anchorTableIds,
  freeSeatsByTable,
  requiredSeats,
  tableOrder,
  tableRank,
}: {
  adjacency: ReadonlyMap<string, readonly string[]>;
  anchorTableIds: readonly string[];
  freeSeatsByTable: ReadonlyMap<string, readonly number[]>;
  requiredSeats: number;
  tableOrder: readonly string[];
  tableRank: ReadonlyMap<string, number>;
}): string[] {
  const anchorSet = new Set(anchorTableIds);
  const distances = connectionDistances(anchorTableIds, adjacency);
  const eligibleAnchorTableIds = tableOrder
    .filter(
      (tableId) =>
        anchorSet.has(tableId) &&
        (freeSeatsByTable.get(tableId)?.length ?? 0) > 0,
    )
    .sort((a, b) => tableRankOf(a, tableRank) - tableRankOf(b, tableRank));
  const anchorCapacity = connectedSetCapacity(
    eligibleAnchorTableIds,
    freeSeatsByTable,
  );
  const remainingSeats = Math.max(0, requiredSeats - anchorCapacity);
  const additionalTableIds = tableOrder.filter(
    (tableId) =>
      !anchorSet.has(tableId) &&
      (freeSeatsByTable.get(tableId)?.length ?? 0) > 0,
  );

  return [
    ...eligibleAnchorTableIds,
    ...selectMinimumAdditionalTables({
      distances,
      freeSeatsByTable,
      requiredSeats: remainingSeats,
      tableIds: additionalTableIds,
      tableRank,
    }),
  ];
}

function selectMinimumAdditionalTables({
  distances,
  freeSeatsByTable,
  requiredSeats,
  tableIds,
  tableRank,
}: {
  distances: ReadonlyMap<string, number>;
  freeSeatsByTable: ReadonlyMap<string, readonly number[]>;
  requiredSeats: number;
  tableIds: readonly string[];
  tableRank: ReadonlyMap<string, number>;
}): string[] {
  const totalCapacity = connectedSetCapacity(tableIds, freeSeatsByTable);
  const targetSeats = Math.min(requiredSeats, totalCapacity);
  if (targetSeats <= 0) return [];

  // Final fallback only: capacity establishes the minimum added-table count.
  // Proximity may choose among feasible sets of that size, but cannot increase it.
  const capacitiesDescending = tableIds
    .map((tableId) => freeSeatsByTable.get(tableId)?.length ?? 0)
    .sort((a, b) => b - a);
  let minimumTableCount = 0;
  let accumulatedCapacity = 0;
  while (
    minimumTableCount < capacitiesDescending.length &&
    accumulatedCapacity < targetSeats
  ) {
    accumulatedCapacity += capacitiesDescending[minimumTableCount];
    minimumTableCount += 1;
  }

  const preferredTableIds = [...tableIds]
    .sort((a, b) => {
      const connectedOrder = Number(distances.has(b)) - Number(distances.has(a));
      if (connectedOrder !== 0) return connectedOrder;
      if (distances.has(a) && distances.has(b)) {
        const distanceOrder = (distances.get(a) ?? 0) - (distances.get(b) ?? 0);
        if (distanceOrder !== 0) return distanceOrder;
      }
      const capacityOrder =
        (freeSeatsByTable.get(a)?.length ?? 0) -
        (freeSeatsByTable.get(b)?.length ?? 0);
      return capacityOrder || tableRankOf(a, tableRank) - tableRankOf(b, tableRank);
    });

  const selected: string[] = [];
  let selectedCapacity = 0;
  preferredTableIds.forEach((tableId, index) => {
    if (selected.length >= minimumTableCount) return;
    const slotsAfterSelection = minimumTableCount - selected.length - 1;
    const remainingCandidates = preferredTableIds.slice(index + 1);
    if (remainingCandidates.length < slotsAfterSelection) return;

    const maximumRemainingCapacity = remainingCandidates
      .map((candidateId) => freeSeatsByTable.get(candidateId)?.length ?? 0)
      .sort((a, b) => b - a)
      .slice(0, slotsAfterSelection)
      .reduce((total, capacity) => total + capacity, 0);
    const capacity = freeSeatsByTable.get(tableId)?.length ?? 0;
    if (
      selectedCapacity + capacity + maximumRemainingCapacity <
      targetSeats
    ) {
      return;
    }

    selected.push(tableId);
    selectedCapacity += capacity;
  });

  return selected;
}

function connectionDistances(
  roots: readonly string[],
  adjacency: ReadonlyMap<string, readonly string[]>,
): Map<string, number> {
  const distances = new Map<string, number>();
  const queue: string[] = [];

  roots.forEach((root) => {
    if (!adjacency.has(root) || distances.has(root)) return;
    distances.set(root, 0);
    queue.push(root);
  });

  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const tableId = queue[cursor];
    const distance = distances.get(tableId) ?? 0;
    (adjacency.get(tableId) ?? []).forEach((neighbor) => {
      if (distances.has(neighbor)) return;
      distances.set(neighbor, distance + 1);
      queue.push(neighbor);
    });
  }

  return distances;
}

function tableRankOf(
  tableId: string,
  tableRank: ReadonlyMap<string, number>,
): number {
  return tableRank.get(tableId) ?? Number.MAX_SAFE_INTEGER;
}

function compareStableStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function guestToAssignmentEntry(
  guest: SeatingGuestPoolItem,
  seatKey: string | null,
): SeatingAssignmentEntry {
  return {
    guestIndex: guest.guestIndex,
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
    guestIndex: guest.source === "guest" ? guest.guestIndex : null,
    seatKey,
    type: "guest",
    userId: guest.source === "participant" ? guest.participantUserId : null,
  };
}

function normalizeAssignmentDisplay(
  assignment: SeatingAssignment,
  fallbackGuest: SeatingGuestPoolItem | null,
): SeatingAssignment {
  return {
    ...assignment,
    guestIndex: assignment.guestIndex ?? (fallbackGuest?.source === "guest" ? fallbackGuest.guestIndex : null),
    userId: assignment.userId ?? (fallbackGuest?.source === "participant" ? fallbackGuest.participantUserId : null),
    guestInitials: assignment.guestInitials?.trim() || fallbackGuest?.initials || null,
    guestLabel: assignment.guestLabel?.trim() || fallbackGuest?.displayName || null,
  };
}

function excludeLockedGuests(
  guests: readonly SeatingGuestPoolItem[],
  lockedGuestKeys: ReadonlySet<string>,
): SeatingGuestPoolItem[] {
  return guests.filter((guest) => !lockedGuestKeys.has(guest.key));
}

/**
 * PR 15: resolve the seats and guests that a repeat auto seating must preserve.
 * Only placed assignments whose `seat_key` resolves to a valid seat in the
 * current geometry are kept; unresolved ones are ignored so they do not block a
 * phantom seat.
 */
function resolveLockedPlacements(
  lockedAssignments: readonly SeatingAssignment[],
  geometry: SeatingGeometryResult,
  resolvedGuests: readonly (SeatingGuestPoolItem | null)[],
): LockedPlacements {
  const seatIndexes = new Set<number>();
  const guestKeys = new Set<string>();
  const tableIdsByRegistration = new Map<string, string[]>();

  lockedAssignments.forEach((assignment, order) => {
    if (!assignment.seatKey || !isProtectedSeatingAssignment(assignment)) {
      return;
    }

    const seatIndex = seatIndexFromSeatKey(assignment.seatKey, geometry);
    if (seatIndex === null || geometry.seats[seatIndex]?.isDisabled || seatIndexes.has(seatIndex)) {
      return;
    }

    seatIndexes.add(seatIndex);
    if (assignment.type !== "guest" || !assignment.registrationId) return;

    const guest = resolvedGuests[order];
    if (guest) guestKeys.add(guest.key);

    const tableId = geometry.seats[seatIndex]?.tableId;
    if (!tableId) return;
    const tableIds = tableIdsByRegistration.get(assignment.registrationId) ?? [];
    if (!tableIds.includes(tableId)) tableIds.push(tableId);
    tableIdsByRegistration.set(assignment.registrationId, tableIds);
  });

  return { guestKeys, seatIndexes, tableIdsByRegistration };
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
