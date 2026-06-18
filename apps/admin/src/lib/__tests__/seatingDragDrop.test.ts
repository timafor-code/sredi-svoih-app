import { applySeatingDragDrop } from "../seatingDragDrop";
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
  const registrationId = over.registrationId ?? `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
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

function placedAssignment(
  guest: SeatingGuestPoolItem,
  geometry: SeatingGeometryResult,
  seatIndex: number,
): SeatingAssignment {
  return {
    guestInitials: guest.initials,
    guestLabel: guest.displayName,
    id: `saved:${guest.key}`,
    layoutId: "layout-1",
    registrationId: guest.registrationId,
    seatKey: seatingSeatKey(geometry.seats[seatIndex], seatIndex),
    type: "guest",
  };
}

function placedSeatIndexes(
  assignments: SeatingAssignment[],
  geometry: SeatingGeometryResult,
): number[] {
  return assignments
    .filter((assignment) => assignment.seatKey)
    .map((assignment) => geometry.seats.findIndex((seat, index) =>
      seatingSeatKey(seat, index) === assignment.seatKey,
    ));
}

test("pool -> empty seat places the guest as a manual, locked assignment", () => {
  const geometry = defaultGeometry();
  const guest = makeGuest(1);
  const targetIndex = regularSeatIndexes(geometry)[0];
  const result = applySeatingDragDrop({
    assignments: [],
    geometry,
    guestPool: [guest],
    source: { kind: "pool", guestKey: guest.key },
    target: { kind: "seat", seatIndex: targetIndex },
  });

  assert(result.changed, "drop changed state");
  assertEqual(result.assignments.length, 1, "one assignment created");
  const placed = result.assignments[0];
  assertEqual(placed.seatKey, seatingSeatKey(geometry.seats[targetIndex], targetIndex), "seat key");
  assertEqual(placed.locked, true, "manual placement is locked");
  assertEqual(placed.placementSource, "manual", "manual placement source");
  assert(
    (placed.seatKey ?? "").includes(":side:") || (placed.seatKey ?? "").includes(":end:"),
    "seat key is stable (client_table_id based)",
  );
});

test("seat -> empty seat moves the occupant", () => {
  const geometry = defaultGeometry();
  const guest = makeGuest(1);
  const [from, to] = regularSeatIndexes(geometry);
  const result = applySeatingDragDrop({
    assignments: [placedAssignment(guest, geometry, from)],
    geometry,
    guestPool: [guest],
    source: { kind: "seat", seatIndex: from },
    target: { kind: "seat", seatIndex: to },
  });

  assert(result.changed, "move changed state");
  assertEqual(result.assignments.length, 1, "still one assignment");
  assertEqual(
    result.assignments[0].seatKey,
    seatingSeatKey(geometry.seats[to], to),
    "occupant moved to target seat",
  );
});

test("seat -> occupied seat swaps the two guests", () => {
  const geometry = defaultGeometry();
  const [a, b] = regularSeatIndexes(geometry);
  const guestA = makeGuest(1);
  const guestB = makeGuest(2);
  const result = applySeatingDragDrop({
    assignments: [
      placedAssignment(guestA, geometry, a),
      placedAssignment(guestB, geometry, b),
    ],
    geometry,
    guestPool: [guestA, guestB],
    source: { kind: "seat", seatIndex: a },
    target: { kind: "seat", seatIndex: b },
  });

  assert(result.changed, "swap changed state");
  const byGuest = new Map(
    result.assignments.map((assignment) => [assignment.registrationId, assignment.seatKey]),
  );
  assertEqual(byGuest.get(guestA.registrationId), seatingSeatKey(geometry.seats[b], b), "A took B");
  assertEqual(byGuest.get(guestB.registrationId), seatingSeatKey(geometry.seats[a], a), "B took A");
});

test("pool -> occupied seat returns the displaced guest to the pool", () => {
  const geometry = defaultGeometry();
  const seated = makeGuest(1);
  const incoming = makeGuest(2);
  const seatIndex = regularSeatIndexes(geometry)[0];
  const result = applySeatingDragDrop({
    assignments: [placedAssignment(seated, geometry, seatIndex)],
    geometry,
    guestPool: [seated, incoming],
    source: { kind: "pool", guestKey: incoming.key },
    target: { kind: "seat", seatIndex },
  });

  assert(result.changed, "drop changed state");
  const seatKey = seatingSeatKey(geometry.seats[seatIndex], seatIndex);
  const onSeat = result.assignments.filter((assignment) => assignment.seatKey === seatKey);
  assertEqual(onSeat.length, 1, "exactly one guest on the seat");
  assertEqual(onSeat[0].registrationId, incoming.registrationId, "incoming guest seated");
  const displaced = result.assignments.find(
    (assignment) => assignment.registrationId === seated.registrationId,
  );
  assertEqual(displaced?.seatKey ?? "null", "null", "displaced guest returned to pool");
});

test("seat -> pool unassigns the guest", () => {
  const geometry = defaultGeometry();
  const guest = makeGuest(1);
  const seatIndex = regularSeatIndexes(geometry)[0];
  const result = applySeatingDragDrop({
    assignments: [placedAssignment(guest, geometry, seatIndex)],
    geometry,
    guestPool: [guest],
    source: { kind: "seat", seatIndex },
    target: { kind: "pool" },
  });

  assert(result.changed, "unassign changed state");
  assertEqual(result.assignments[0].seatKey, null, "seat key cleared");
  assertEqual(result.assignments[0].locked, false, "pooled guest is unlocked");
});

test("dropping on the same seat is a no-op", () => {
  const geometry = defaultGeometry();
  const guest = makeGuest(1);
  const seatIndex = regularSeatIndexes(geometry)[0];
  const result = applySeatingDragDrop({
    assignments: [placedAssignment(guest, geometry, seatIndex)],
    geometry,
    guestPool: [guest],
    source: { kind: "seat", seatIndex },
    target: { kind: "seat", seatIndex },
  });

  assert(!result.changed, "no change");
  assertEqual(result.rejection, "noop", "rejection reason");
});

test("ordinary guest cannot be dropped on a rabbi-reserved seat", () => {
  const geometry = defaultGeometry();
  const guest = makeGuest(1);
  const result = applySeatingDragDrop({
    assignments: [],
    geometry,
    guestPool: [guest],
    source: { kind: "pool", guestKey: guest.key },
    target: { kind: "seat", seatIndex: rabbiSeatIndex(geometry) },
  });

  assert(!result.changed, "drop rejected");
  assertEqual(result.rejection, "rabbi_reserved_seat", "rejection reason");
  assertEqual(result.assignments.length, 0, "no assignment created");
});

test("explicit rabbi guest may be placed on a rabbi-reserved seat", () => {
  const geometry = defaultGeometry();
  const rabbi = { ...makeGuest(1), isRabbi: true } as SeatingGuestPoolItem;
  const headIndex = geometry.headIndex;
  const result = applySeatingDragDrop({
    assignments: [],
    geometry,
    guestPool: [rabbi],
    source: { kind: "pool", guestKey: rabbi.key },
    target: { kind: "seat", seatIndex: headIndex },
  });

  assert(result.changed, "rabbi placement allowed");
  assertEqual(
    result.assignments[0].seatKey,
    seatingSeatKey(geometry.seats[headIndex], headIndex),
    "rabbi seated at head",
  );
});

test("an out-of-range seat index is rejected", () => {
  const geometry = defaultGeometry();
  const guest = makeGuest(1);
  const result = applySeatingDragDrop({
    assignments: [],
    geometry,
    guestPool: [guest],
    source: { kind: "pool", guestKey: guest.key },
    target: { kind: "seat", seatIndex: geometry.seats.length + 5 },
  });

  assert(!result.changed, "drop rejected");
  assertEqual(result.rejection, "seat_out_of_range", "rejection reason");
});

test("a guest already seated cannot be placed again from the pool", () => {
  const geometry = defaultGeometry();
  const guest = makeGuest(1);
  const [first, second] = regularSeatIndexes(geometry);
  const result = applySeatingDragDrop({
    assignments: [placedAssignment(guest, geometry, first)],
    geometry,
    guestPool: [guest],
    source: { kind: "pool", guestKey: guest.key },
    target: { kind: "seat", seatIndex: second },
  });

  assert(!result.changed, "duplicate drop rejected");
  assertEqual(result.rejection, "duplicate_guest", "rejection reason");
});

test("dragging a seat onto a missing occupant is rejected", () => {
  const geometry = defaultGeometry();
  const emptyIndex = regularSeatIndexes(geometry)[0];
  const result = applySeatingDragDrop({
    assignments: [],
    geometry,
    guestPool: [],
    source: { kind: "seat", seatIndex: emptyIndex },
    target: { kind: "seat", seatIndex: regularSeatIndexes(geometry)[1] },
  });

  assert(!result.changed, "rejected");
  assertEqual(result.rejection, "missing_source_occupant", "rejection reason");
});

test("each occupied seat holds at most one assignment after a swap", () => {
  const geometry = defaultGeometry();
  const [a, b] = regularSeatIndexes(geometry);
  const guestA = makeGuest(1);
  const guestB = makeGuest(2);
  const result = applySeatingDragDrop({
    assignments: [
      placedAssignment(guestA, geometry, a),
      placedAssignment(guestB, geometry, b),
    ],
    geometry,
    guestPool: [guestA, guestB],
    source: { kind: "seat", seatIndex: a },
    target: { kind: "seat", seatIndex: b },
  });

  const occupied = placedSeatIndexes(result.assignments, geometry);
  assertEqual(new Set(occupied).size, occupied.length, "no seat double-booked");
  assertEqual(occupied.length, 2, "both guests still seated");
});

function pooledReserve(id: string, label = "Резерв"): SeatingAssignment {
  return {
    guestInitials: "Рез",
    guestLabel: label,
    id,
    layoutId: "layout-1",
    registrationId: null,
    seatKey: null,
    type: "reserve",
  };
}

function seatedReserve(
  id: string,
  geometry: SeatingGeometryResult,
  seatIndex: number,
  label = "Резерв",
): SeatingAssignment {
  return {
    ...pooledReserve(id, label),
    seatKey: seatingSeatKey(geometry.seats[seatIndex], seatIndex),
  };
}

test("reserve pool -> empty seat places the reserve and keeps its type", () => {
  const geometry = defaultGeometry();
  const targetIndex = regularSeatIndexes(geometry)[0];
  const result = applySeatingDragDrop({
    assignments: [pooledReserve("res-1", "Гость раввина")],
    geometry,
    guestPool: [],
    source: { kind: "reserve", reserveId: "res-1" },
    target: { kind: "seat", seatIndex: targetIndex },
  });

  assert(result.changed, "reserve placed");
  assertEqual(result.assignments.length, 1, "still one assignment");
  const placed = result.assignments[0];
  assertEqual(placed.type, "reserve", "type preserved");
  assertEqual(placed.registrationId, null, "reserve has no registration");
  assertEqual(
    placed.seatKey,
    seatingSeatKey(geometry.seats[targetIndex], targetIndex),
    "seat key set",
  );
  assertEqual(placed.locked, true, "manual placement is locked");
});

test("reserve seat -> empty seat moves the reserve", () => {
  const geometry = defaultGeometry();
  const [from, to] = regularSeatIndexes(geometry);
  const result = applySeatingDragDrop({
    assignments: [seatedReserve("res-1", geometry, from)],
    geometry,
    guestPool: [],
    source: { kind: "seat", seatIndex: from },
    target: { kind: "seat", seatIndex: to },
  });

  assert(result.changed, "reserve moved");
  assertEqual(result.assignments[0].type, "reserve", "type preserved");
  assertEqual(
    result.assignments[0].seatKey,
    seatingSeatKey(geometry.seats[to], to),
    "reserve at target seat",
  );
});

test("reserve seat -> pool returns the reserve to the pool", () => {
  const geometry = defaultGeometry();
  const seatIndex = regularSeatIndexes(geometry)[0];
  const result = applySeatingDragDrop({
    assignments: [seatedReserve("res-1", geometry, seatIndex)],
    geometry,
    guestPool: [],
    source: { kind: "seat", seatIndex },
    target: { kind: "pool" },
  });

  assert(result.changed, "reserve unassigned");
  assertEqual(result.assignments[0].seatKey, null, "seat cleared");
  assertEqual(result.assignments[0].type, "reserve", "still a reserve");
});

test("reserve / guest swap exchanges the two seats", () => {
  const geometry = defaultGeometry();
  const [a, b] = regularSeatIndexes(geometry);
  const guest = makeGuest(1);
  const result = applySeatingDragDrop({
    assignments: [
      seatedReserve("res-1", geometry, a),
      placedAssignment(guest, geometry, b),
    ],
    geometry,
    guestPool: [guest],
    source: { kind: "seat", seatIndex: a },
    target: { kind: "seat", seatIndex: b },
  });

  assert(result.changed, "swap changed state");
  const reserve = result.assignments.find((assignment) => assignment.type === "reserve");
  const seated = result.assignments.find((assignment) => assignment.type === "guest");
  assertEqual(reserve?.seatKey, seatingSeatKey(geometry.seats[b], b), "reserve took guest seat");
  assertEqual(seated?.seatKey, seatingSeatKey(geometry.seats[a], a), "guest took reserve seat");
});

test("reserve pool -> occupied seat returns the displaced guest to the pool", () => {
  const geometry = defaultGeometry();
  const seated = makeGuest(1);
  const seatIndex = regularSeatIndexes(geometry)[0];
  const result = applySeatingDragDrop({
    assignments: [placedAssignment(seated, geometry, seatIndex), pooledReserve("res-1")],
    geometry,
    guestPool: [seated],
    source: { kind: "reserve", reserveId: "res-1" },
    target: { kind: "seat", seatIndex },
  });

  assert(result.changed, "reserve placed on occupied seat");
  const seatKey = seatingSeatKey(geometry.seats[seatIndex], seatIndex);
  const onSeat = result.assignments.filter((assignment) => assignment.seatKey === seatKey);
  assertEqual(onSeat.length, 1, "exactly one occupant on the seat");
  assertEqual(onSeat[0].type, "reserve", "reserve now seated");
  const displaced = result.assignments.find(
    (assignment) => assignment.registrationId === seated.registrationId,
  );
  assertEqual(displaced?.seatKey ?? "null", "null", "displaced guest returned to pool");
});

test("a reserve cannot be placed on two seats at once", () => {
  const geometry = defaultGeometry();
  const [first, second] = regularSeatIndexes(geometry);
  // The reserve is already seated; there is no pooled entry to place again.
  const result = applySeatingDragDrop({
    assignments: [seatedReserve("res-1", geometry, first)],
    geometry,
    guestPool: [],
    source: { kind: "reserve", reserveId: "res-1" },
    target: { kind: "seat", seatIndex: second },
  });

  assert(!result.changed, "duplicate reserve placement rejected");
  assertEqual(result.rejection, "missing_reserve", "rejection reason");
});

test("a reserve may be placed on a rabbi-reserved seat", () => {
  const geometry = defaultGeometry();
  const result = applySeatingDragDrop({
    assignments: [pooledReserve("res-1", "Гость раввина")],
    geometry,
    guestPool: [],
    source: { kind: "reserve", reserveId: "res-1" },
    target: { kind: "seat", seatIndex: rabbiSeatIndex(geometry) },
  });

  assert(result.changed, "reserve allowed on rabbi seat");
  assertEqual(result.assignments[0].type, "reserve", "reserve seated");
});

test("the source assignments array is not mutated", () => {
  const geometry = defaultGeometry();
  const guest = makeGuest(1);
  const seatIndex = regularSeatIndexes(geometry)[0];
  const original = [placedAssignment(guest, geometry, seatIndex)];
  const snapshot = JSON.stringify(original);
  applySeatingDragDrop({
    assignments: original,
    geometry,
    guestPool: [guest],
    source: { kind: "seat", seatIndex },
    target: { kind: "pool" },
  });

  assertEqual(JSON.stringify(original), snapshot, "input untouched (pure helper)");
});

console.log(`\nSeating drag/drop tests: ${passed} passed, ${failures.length} failed`);
if (failures.length) {
  throw new Error(`${failures.length} seating drag/drop test(s) failed`);
}
