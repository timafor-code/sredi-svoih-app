import { reconcileSeatingAssignments } from "../seatingAssignmentReconcile";
import { seatingSeatKey } from "../seatingAutoAssign";
import { TABLE_H, TABLE_W, computeTableSeats } from "../seatingGeometry";
import type {
  SeatingAssignment,
  SeatingGeometryResult,
  SeatingGuestPoolItem,
  SeatingTable,
} from "../../types/seating";

let passed = 0;
const failures: string[] = [];

function test(name: string, fn: () => void): void {
  try {
    fn();
    passed++;
    console.log("  ok " + name);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    failures.push(name + " - " + message);
    console.error("  fail " + name + " - " + message);
  }
}

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

function assertEqual<T>(actual: T, expected: T, msg = ""): void {
  if (actual !== expected) {
    throw new Error(`${msg} expected ${String(expected)}, got ${String(actual)}`.trim());
  }
}

function makeTable(over: Partial<SeatingTable> & { id: string }): SeatingTable {
  return {
    angle: 0,
    cx: 100,
    cy: 100,
    h: TABLE_H,
    isRabbiTable: false,
    sideSeats: 3,
    w: TABLE_W,
    ...over,
  };
}

function makeGuest(index: number, over: Partial<SeatingGuestPoolItem> = {}): SeatingGuestPoolItem {
  const registrationId =
    over.registrationId ?? `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
  return {
    capacityUnitId: "unit-1",
    capacityReservationIds: [],
    displayName: `Guest ${index}`,
    email: null,
    guestIndex: null,
    guestName: null,
    id: `guest-${index}`,
    initials: `G${index}`,
    key: `guest-${index}`,
    occurrenceId: null,
    optionIds: [],
    optionTitles: [],
    participantDisplayName: `Guest ${index}`,
    participantUserId: null,
    paymentStatus: null,
    phone: null,
    registrationId,
    seatObligationSource: "reservation",
    source: "participant",
    sourceLabel: "Participant",
    status: "confirmed",
    ...over,
  };
}

function defaultTables(): SeatingTable[] {
  return [
    makeTable({ id: "rabbi", cx: 100, cy: 100, isRabbiTable: true }),
    makeTable({ id: "regular", cx: 100, cy: 340, isRabbiTable: false }),
  ];
}

function defaultGeometry(): SeatingGeometryResult {
  return computeTableSeats({ tables: defaultTables() });
}

function regularSeatIndexes(geometry: SeatingGeometryResult): number[] {
  return geometry.seats
    .map((seat, index) => ({ seat, index }))
    .filter(({ seat }) => !seat.isRabbiTable)
    .map(({ index }) => index);
}

function rabbiSeatIndex(geometry: SeatingGeometryResult): number {
  const index = geometry.seats.findIndex((seat) => seat.isRabbiTable);
  if (index < 0) throw new Error("expected a rabbi-reserved seat in the fixture");
  return index;
}

function placedGuest(
  guest: SeatingGuestPoolItem,
  geometry: SeatingGeometryResult,
  seatIndex: number,
  over: Partial<SeatingAssignment> = {},
): SeatingAssignment {
  return {
    guestInitials: guest.initials,
    guestLabel: guest.displayName,
    id: `saved:${guest.key}`,
    layoutId: "layout-1",
    registrationId: guest.registrationId,
    seatKey: seatingSeatKey(geometry.seats[seatIndex], seatIndex),
    type: "guest",
    ...over,
  };
}

function placedReserve(
  id: string,
  geometry: SeatingGeometryResult,
  seatIndex: number,
  over: Partial<SeatingAssignment> = {},
): SeatingAssignment {
  return {
    guestInitials: "Рез",
    guestLabel: "Гость раввина",
    id,
    layoutId: "layout-1",
    registrationId: null,
    seatKey: seatingSeatKey(geometry.seats[seatIndex], seatIndex),
    type: "reserve",
    ...over,
  };
}

test("seat still exists (table moved) -> assignment is kept", () => {
  const geometry = defaultGeometry();
  const guest = makeGuest(1);
  const seatIndex = regularSeatIndexes(geometry)[0];
  const assignment = placedGuest(guest, geometry, seatIndex);

  // New geometry with the regular table moved — same client_table_id, same seat key.
  const movedGeometry = computeTableSeats({
    tables: [
      makeTable({ id: "rabbi", cx: 100, cy: 100, isRabbiTable: true }),
      makeTable({ id: "regular", cx: 380, cy: 360, isRabbiTable: false }),
    ],
  });

  const result = reconcileSeatingAssignments({
    assignments: [assignment],
    geometry: movedGeometry,
  });

  assertEqual(result.counts.keptCount, 1, "kept count");
  assertEqual(result.counts.returnedCount, 0, "returned count");
  assertEqual(result.keptAssignments.length, 1, "kept array");
  assert(result.assignments[0].seatKey !== null, "kept placement still seated");
});

test("seat disappeared -> occupant returns to the pool", () => {
  const geometry = defaultGeometry();
  const guest = makeGuest(1);
  const seatIndex = regularSeatIndexes(geometry)[0];
  const assignment = placedGuest(guest, geometry, seatIndex);

  // New geometry without the "regular" table — the saved seat key cannot resolve.
  const reducedGeometry = computeTableSeats({
    tables: [makeTable({ id: "rabbi", cx: 100, cy: 100, isRabbiTable: true })],
  });

  const result = reconcileSeatingAssignments({
    assignments: [assignment],
    geometry: reducedGeometry,
  });

  assertEqual(result.counts.keptCount, 0, "nothing kept");
  assertEqual(result.counts.missingSeatCount, 1, "missing seat counted");
  assertEqual(result.counts.returnedCount, 1, "returned count");
  assertEqual(result.assignments.length, 1, "occupant carried as pooled");
  assertEqual(result.assignments[0].seatKey, null, "returned occupant has no seat");
});

test("seat became rabbi-reserved -> ordinary guest returns to the pool", () => {
  const geometry = defaultGeometry();
  const guest = makeGuest(1);
  // Place the guest directly on a rabbi-reserved seat to model the table flipping.
  const assignment = placedGuest(guest, geometry, rabbiSeatIndex(geometry));

  const result = reconcileSeatingAssignments({
    assignments: [assignment],
    geometry,
  });

  assertEqual(result.counts.keptCount, 0, "ordinary guest evicted");
  assertEqual(result.counts.blockedSeatCount, 1, "blocked seat counted");
  assertEqual(result.assignments[0].seatKey, null, "guest returned to pool");
});

test("explicit blocked seat index -> occupant returns to the pool", () => {
  const geometry = defaultGeometry();
  const guest = makeGuest(1);
  const seatIndex = regularSeatIndexes(geometry)[0];
  const assignment = placedGuest(guest, geometry, seatIndex);

  const result = reconcileSeatingAssignments({
    assignments: [assignment],
    blockedSeatIndexes: [seatIndex],
    geometry,
  });

  assertEqual(result.counts.blockedSeatCount, 1, "blocked seat counted");
  assertEqual(result.assignments[0].seatKey, null, "guest returned to pool");
});

test("reserve on a rabbi-reserved seat remains valid (PR 16 behaviour)", () => {
  const geometry = defaultGeometry();
  const reserve = placedReserve("res-1", geometry, rabbiSeatIndex(geometry));

  const result = reconcileSeatingAssignments({
    assignments: [reserve],
    geometry,
  });

  assertEqual(result.counts.keptCount, 1, "reserve kept on rabbi seat");
  assertEqual(result.counts.blockedSeatCount, 0, "not counted as blocked");
  assert(result.assignments[0].seatKey !== null, "reserve still seated");
});

test("explicit rabbi guest keeps a rabbi-reserved seat", () => {
  const geometry = defaultGeometry();
  const rabbi = makeGuest(1, { key: "rabbi-guest", id: "rabbi-guest" });
  const assignment = placedGuest(rabbi, geometry, rabbiSeatIndex(geometry));

  const result = reconcileSeatingAssignments({
    assignments: [assignment],
    geometry,
    guestPool: [rabbi],
    rabbiGuestKeys: ["rabbi-guest"],
  });

  assertEqual(result.counts.keptCount, 1, "rabbi guest kept on head seat");
  assertEqual(result.counts.blockedSeatCount, 0, "rabbi guest not evicted");
});

test("locked/manual placement on a valid seat is preserved", () => {
  const geometry = defaultGeometry();
  const guest = makeGuest(1);
  const seatIndex = regularSeatIndexes(geometry)[0];
  const assignment = placedGuest(guest, geometry, seatIndex, {
    locked: true,
    placementSource: "manual",
  });

  const result = reconcileSeatingAssignments({
    assignments: [assignment],
    geometry,
  });

  assertEqual(result.counts.keptCount, 1, "manual placement kept");
  assertEqual(result.keptAssignments[0].locked, true, "stays locked");
  assertEqual(result.keptAssignments[0].placementSource, "manual", "stays manual");
});

test("manual/locked placement wins a same-seat conflict with an auto placement", () => {
  const geometry = defaultGeometry();
  const manualGuest = makeGuest(1);
  const autoGuest = makeGuest(2);
  const seatIndex = regularSeatIndexes(geometry)[0];

  const result = reconcileSeatingAssignments({
    // Auto placement listed first to prove ordering does not decide the winner.
    assignments: [
      placedGuest(autoGuest, geometry, seatIndex),
      placedGuest(manualGuest, geometry, seatIndex, {
        locked: true,
        placementSource: "manual",
      }),
    ],
    geometry,
  });

  assertEqual(result.counts.keptCount, 1, "one occupant kept");
  assertEqual(result.counts.duplicateCount, 1, "one duplicate resolved");
  assertEqual(
    result.keptAssignments[0].registrationId,
    manualGuest.registrationId,
    "manual/locked occupant kept the seat",
  );
  const returnedAuto = result.assignments.find(
    (assignment) => assignment.registrationId === autoGuest.registrationId,
  );
  assertEqual(returnedAuto?.seatKey ?? "null", "null", "auto occupant returned to pool");
});

test("duplicate same seat (two distinct occupants) returns the lower-priority one", () => {
  const geometry = defaultGeometry();
  const guestA = makeGuest(1);
  const guestB = makeGuest(2);
  const seatIndex = regularSeatIndexes(geometry)[0];

  const result = reconcileSeatingAssignments({
    assignments: [
      placedGuest(guestA, geometry, seatIndex),
      placedGuest(guestB, geometry, seatIndex),
    ],
    geometry,
  });

  assertEqual(result.counts.keptCount, 1, "only one seated");
  assertEqual(result.counts.duplicateCount, 1, "duplicate counted");
  assertEqual(result.counts.returnedCount, 1, "loser returned to pool");
  assertEqual(
    result.keptAssignments[0].registrationId,
    guestA.registrationId,
    "first (stable order) occupant keeps the seat",
  );
});

test("duplicate same guest (two placements) keeps one and drops the redundant", () => {
  const geometry = defaultGeometry();
  const guest = makeGuest(1);
  const [a, b] = regularSeatIndexes(geometry);

  const result = reconcileSeatingAssignments({
    assignments: [
      placedGuest(guest, geometry, a, { locked: true, placementSource: "manual" }),
      placedGuest(guest, geometry, b),
    ],
    geometry,
  });

  assertEqual(result.counts.keptCount, 1, "guest seated once");
  assertEqual(result.counts.duplicateCount, 1, "redundant placement counted");
  assertEqual(result.counts.returnedCount, 0, "duplicate occupant is dropped, not pooled");
  // The reconciled array holds exactly one entry for this guest.
  const forGuest = result.assignments.filter(
    (assignment) => assignment.registrationId === guest.registrationId,
  );
  assertEqual(forGuest.length, 1, "single entry for the guest");
  assertEqual(forGuest[0].seatKey !== null, true, "kept entry stays seated");
});

test("reserve placement is preserved on a valid ordinary seat", () => {
  const geometry = defaultGeometry();
  const seatIndex = regularSeatIndexes(geometry)[0];
  const reserve = placedReserve("res-1", geometry, seatIndex);

  const result = reconcileSeatingAssignments({
    assignments: [reserve],
    geometry,
  });

  assertEqual(result.counts.keptCount, 1, "reserve kept");
  assertEqual(result.keptAssignments[0].type, "reserve", "still a reserve");
  assertEqual(result.keptAssignments[0].registrationId, null, "reserve has no registration");
});

test("orphan guest (registration not in active bucket) is surfaced and dropped", () => {
  const geometry = defaultGeometry();
  const inBucket = makeGuest(1);
  const orphan = makeGuest(2, { registrationId: "00000000-0000-4000-8000-ffffffffffff" });
  const [a, b] = regularSeatIndexes(geometry);

  const result = reconcileSeatingAssignments({
    assignments: [placedGuest(inBucket, geometry, a), placedGuest(orphan, geometry, b)],
    geometry,
    guestPool: [inBucket],
  });

  assertEqual(result.counts.keptCount, 1, "only the active-bucket guest kept");
  assertEqual(result.invalidAssignments.length, 1, "orphan surfaced");
  const stillSeated = result.assignments.some(
    (assignment) => assignment.registrationId === orphan.registrationId,
  );
  assert(!stillSeated, "orphan is dropped, never rendered as occupied");
});

test("mapped 'Весь шабат' obligation present in the bucket stays valid", () => {
  const geometry = defaultGeometry();
  const wholeShabbat = makeGuest(1, {
    optionTitles: ["Весь шабат"],
    seatObligationSource: "mapped_option",
  });
  const seatIndex = regularSeatIndexes(geometry)[0];

  const result = reconcileSeatingAssignments({
    assignments: [placedGuest(wholeShabbat, geometry, seatIndex)],
    geometry,
    guestPool: [wholeShabbat],
  });

  assertEqual(result.counts.keptCount, 1, "mapped obligation kept");
  assertEqual(result.invalidAssignments.length, 0, "not flagged as orphan");
});

test("counts add up across a mixed geometry change", () => {
  const geometry = defaultGeometry();
  const guests = Array.from({ length: 3 }, (_, i) => makeGuest(i + 1));
  const [a, b] = regularSeatIndexes(geometry);

  // guest1 on a valid seat (kept); guest2 on a rabbi seat (blocked);
  // guest3 on a seat that disappears (missing); plus a duplicate-seat conflict.
  const assignments: SeatingAssignment[] = [
    placedGuest(guests[0], geometry, a),
    placedGuest(guests[1], geometry, rabbiSeatIndex(geometry)),
    {
      guestInitials: "G9",
      guestLabel: "Guest 9",
      id: "saved:guest-9",
      layoutId: "layout-1",
      registrationId: "00000000-0000-4000-8000-000000000009",
      seatKey: "ghost-table:side:a:0",
      type: "guest",
    },
    placedGuest(guests[2], geometry, b),
    placedGuest(makeGuest(4), geometry, b), // duplicate seat with guest3
  ];

  const result = reconcileSeatingAssignments({ assignments, geometry });

  assertEqual(result.counts.keptCount, 2, "kept: guest1 on a, guest3 on b");
  assertEqual(result.counts.missingSeatCount, 1, "one missing seat");
  assertEqual(result.counts.blockedSeatCount, 1, "one blocked seat");
  assertEqual(result.counts.duplicateCount, 1, "one duplicate seat");
  assertEqual(
    result.counts.returnedCount,
    result.counts.missingSeatCount +
      result.counts.blockedSeatCount +
      result.counts.duplicateCount,
    "returned == missing + blocked + duplicate-seat",
  );
});

test("pure helper does not mutate the input assignments array", () => {
  const geometry = defaultGeometry();
  const guest = makeGuest(1);
  const assignments = [placedGuest(guest, geometry, rabbiSeatIndex(geometry))];
  const snapshot = JSON.stringify(assignments);

  reconcileSeatingAssignments({ assignments, geometry });

  assertEqual(JSON.stringify(assignments), snapshot, "input untouched");
});

console.log(`\nSeating reconcile tests: ${passed} passed, ${failures.length} failed`);
if (failures.length) {
  throw new Error(`${failures.length} seating reconcile test(s) failed`);
}
