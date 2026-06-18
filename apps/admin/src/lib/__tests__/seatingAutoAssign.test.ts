import {
  autoAssignResultToAssignments,
  autoAssignResultToPayloadEntries,
  autoAssignSeating,
  deriveSeatingAssignmentRestoreState,
  seatIndexFromSeatKey,
} from "../seatingAutoAssign";
import { reconcileSeatingAssignments } from "../seatingAssignmentReconcile";
import { TABLE_H, TABLE_W, computeTableSeats } from "../seatingGeometry";
import type {
  SeatingAssignment,
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

function assertArrayEqual(actual: unknown[], expected: unknown[], msg = ""): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${msg} expected ${e}, got ${a}`.trim());
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

test("deterministic spread: same input produces same assignments", () => {
  const tables = defaultTables();
  const guests = Array.from({ length: 4 }, (_, i) => makeGuest(i + 1));
  const first = autoAssignSeating({ guestPool: guests, tables });
  const second = autoAssignSeating({ guestPool: guests, tables });

  assertArrayEqual(
    first.assignedSeats.map((seat) => `${seat.guest.key}@${seat.seatKey}`),
    second.assignedSeats.map((seat) => `${seat.guest.key}@${seat.seatKey}`),
    "stable assignments",
  );
  assert(
    JSON.stringify(first.assignedSeats.map((seat) => seat.seatIndex)) !==
      JSON.stringify([8, 9, 10, 11]),
    "regular seats must be spread, not first N",
  );
});

test("more guests than seats leaves overflow unassigned", () => {
  const tables = defaultTables();
  const guests = Array.from({ length: 9 }, (_, i) => makeGuest(i + 1));
  const result = autoAssignSeating({ guestPool: guests, tables });
  const regularSeatCount = computeTableSeats({ tables }).seats.filter(
    (seat) => !seat.isRabbiTable,
  ).length;

  assertEqual(result.assignedSeats.length, regularSeatCount, "assigned count");
  assertEqual(result.remainingUnassignedGuests.length, 1, "overflow count");
  assertEqual(result.warning?.code, "not_enough_physical_seats", "warning code");
});

test("regular guests are not placed at the rabbi table", () => {
  const tables = defaultTables();
  const result = autoAssignSeating({
    guestPool: Array.from({ length: 5 }, (_, i) => makeGuest(i + 1)),
    tables,
  });

  result.assignedSeats.forEach((assigned) => {
    assert(
      !result.geometry.seats[assigned.seatIndex].isRabbiTable,
      `seat ${assigned.seatIndex} must not be a rabbi-table seat`,
    );
  });
});

test("explicit rabbi guest is placed at the head seat only", () => {
  const tables = defaultTables();
  const rabbi = makeGuest(1, { key: "rabbi-guest", id: "rabbi-guest" });
  const result = autoAssignSeating({
    guestPool: [rabbi, makeGuest(2), makeGuest(3)],
    rabbiGuestKeys: ["rabbi-guest"],
    tables,
  });
  const rabbiSeat = result.assignedSeats.find((seat) => seat.guest.key === "rabbi-guest");

  assert(rabbiSeat != null, "rabbi guest assigned");
  assert(rabbiSeat?.isRabbiHead === true, "rabbi assignment marked as head");
  assertEqual(rabbiSeat?.seatIndex ?? -1, result.geometry.headIndex, "head index");
});

test("no tables does not crash and leaves all guests unassigned", () => {
  const guests = [makeGuest(1), makeGuest(2)];
  const result = autoAssignSeating({ guestPool: guests, tables: [] });

  assertEqual(result.assignedSeats.length, 0, "no assignments");
  assertEqual(result.remainingUnassignedGuests.length, guests.length, "all unassigned");
  assertEqual(result.warning?.code, "no_tables", "warning code");
});

test("empty guest pool does not crash and creates no assignments", () => {
  const result = autoAssignSeating({ guestPool: [], tables: defaultTables() });

  assertEqual(result.assignedSeats.length, 0, "no assignments");
  assertEqual(result.remainingUnassignedGuests.length, 0, "no unassigned guests");
  assertEqual(result.warning?.code, "empty_guest_pool", "warning code");
});

test("assigned seat keys are unique and parse back to seat indexes", () => {
  const result = autoAssignSeating({
    guestPool: Array.from({ length: 6 }, (_, i) => makeGuest(i + 1)),
    tables: defaultTables(),
  });
  const seatKeys = result.assignedSeats.map((seat) => seat.seatKey);
  const unique = new Set(seatKeys);

  assertEqual(unique.size, seatKeys.length, "unique seat keys");
  result.assignedSeats.forEach((seat) => {
    assert(
      seat.seatKey.includes(":side:") || seat.seatKey.includes(":end:"),
      "seat key is stable within a table",
    );
    assertEqual(
      seatIndexFromSeatKey(seat.seatKey, result.geometry),
      seat.seatIndex,
      "seat key parses",
    );
  });
});

test("stable seat keys survive table order changes on reopen", () => {
  const tables = defaultTables();
  const result = autoAssignSeating({
    guestPool: [makeGuest(1), makeGuest(2), makeGuest(3)],
    tables,
  });
  const reopenedGeometry = computeTableSeats({
    tables: [...tables].reverse(),
  });

  result.assignedSeats.forEach((seat) => {
    const reopenedIndex = seatIndexFromSeatKey(seat.seatKey, reopenedGeometry);
    const tableId = seat.seatKey.split(":")[0];

    assert(reopenedIndex !== null, "stable key restores after reorder");
    assertEqual(
      reopenedGeometry.seats[reopenedIndex ?? -1]?.tableId,
      tableId,
      "restored seat stays on the same table",
    );
  });
});

test("legacy global seat keys recover on the saved table after reorder", () => {
  const tables = defaultTables();
  const result = autoAssignSeating({
    guestPool: [makeGuest(1), makeGuest(2), makeGuest(3)],
    tables,
  });
  const reopenedGeometry = computeTableSeats({
    tables: [...tables].reverse(),
  });

  result.assignedSeats.forEach((seat) => {
    const legacyKey = `${result.geometry.seats[seat.seatIndex].tableId}:${seat.seatIndex}`;
    const reopenedIndex = seatIndexFromSeatKey(legacyKey, reopenedGeometry);

    assert(reopenedIndex !== null, "legacy key restores after reorder");
    assertEqual(
      reopenedGeometry.seats[reopenedIndex ?? -1]?.tableId,
      result.geometry.seats[seat.seatIndex].tableId,
      "legacy restore stays on the same table",
    );
  });
});

test("payload entries keep placed chairs and overflow pool entries separate", () => {
  const result = autoAssignSeating({
    guestPool: Array.from({ length: 9 }, (_, i) => makeGuest(i + 1)),
    tables: defaultTables(),
  });
  const payload = autoAssignResultToPayloadEntries(result);

  assertEqual(payload.chairs.length, result.assignedSeats.length, "chairs length");
  assertEqual(payload.pool.length, result.remainingUnassignedGuests.length, "pool length");
  assert(payload.chairs.every((entry) => entry.seatKey), "chairs have seat keys");
  assert(payload.pool.every((entry) => entry.seatKey === null), "pool has null seat keys");
});

test("hydrate saved assignments restores occupied seats after reopen", () => {
  const tables = defaultTables();
  const guests = Array.from({ length: 5 }, (_, i) => makeGuest(i + 1));
  const autoResult = autoAssignSeating({ guestPool: guests, tables });
  const savedAssignments = autoAssignResultToAssignments(autoResult);
  const reopenedGeometry = computeTableSeats({ tables });
  const restored = deriveSeatingAssignmentRestoreState({
    assignments: savedAssignments,
    geometry: reopenedGeometry,
    guestPool: guests,
  });

  assertEqual(restored.invalidAssignments.length, 0, "no invalid saved seats");
  assertEqual(restored.occupants.length, autoResult.assignedSeats.length, "occupants restored");
  assertEqual(restored.occupiedCount, restored.occupants.length, "status count matches occupants");
  assertEqual(restored.unassignedGuests.length, 0, "panel has no hidden unassigned guests");
  restored.occupants.forEach((occupant) => {
    assert(
      occupant.seatKey.includes(":side:") || occupant.seatKey.includes(":end:"),
      "restored occupant keeps stable seat key",
    );
    assertEqual(
      reopenedGeometry.seats[occupant.seatIndex]?.tableId,
      occupant.seatKey.split(":")[0],
      "restored occupant maps to canvas seat",
    );
  });
});

test("saved assignment with missing seat key returns guest to unassigned pool", () => {
  const tables = defaultTables();
  const guest = makeGuest(1);
  const restored = deriveSeatingAssignmentRestoreState({
    assignments: [
      {
        guestInitials: guest.initials,
        guestLabel: guest.displayName,
        id: "saved-1",
        layoutId: "layout-1",
        registrationId: guest.registrationId,
        seatKey: "missing-table:side:a:0",
        type: "guest",
      },
    ],
    geometry: computeTableSeats({ tables }),
    guestPool: [guest],
  });

  assertEqual(restored.occupants.length, 0, "invalid seat is not rendered");
  assertEqual(restored.occupiedCount, 0, "invalid seat is not counted occupied");
  assertEqual(restored.invalidAssignments.length, 1, "invalid assignment warning source");
  assert(restored.currentAssignments[0]?.seatKey === null, "invalid chair becomes pool");
  assertArrayEqual(
    restored.unassignedGuests.map((item) => item.key),
    [guest.key],
    "guest returns to unassigned panel",
  );
});

test("guests from another capacity unit or occurrence are excluded", () => {
  const result = autoAssignSeating({
    capacityUnitId: "friday_dinner",
    guestPool: [
      makeGuest(1, { capacityUnitId: "friday_dinner", occurrenceId: "occ-1" }),
      makeGuest(2, { capacityUnitId: "shabbat_lunch", occurrenceId: "occ-1" }),
      makeGuest(3, { capacityUnitId: "friday_dinner", occurrenceId: "occ-2" }),
    ],
    occurrenceId: "occ-1",
    tables: defaultTables(),
  });

  assertArrayEqual(
    result.assignedSeats.map((seat) => seat.guest.key),
    ["guest-1"],
    "only current slot guest assigned",
  );
  assertEqual(result.remainingUnassignedGuests.length, 0, "no foreign overflow");
});

test("duplicate guest item is not emitted twice in assignment payload", () => {
  const duplicated = makeGuest(1, {
    capacityUnitId: "friday_dinner",
    key: "registration-1:friday_dinner:participant:0",
  });
  const result = autoAssignSeating({
    capacityUnitId: "friday_dinner",
    guestPool: [duplicated, { ...duplicated }],
    occurrenceId: null,
    tables: defaultTables(),
  });
  const payload = autoAssignResultToPayloadEntries(result);

  assertEqual(result.assignedSeats.length, 1, "single assigned duplicate");
  assertEqual(payload.chairs.length + payload.pool.length, 1, "single payload entry");
});

test("save then reopen with stable client_table_id keeps guests seated", () => {
  const tables = defaultTables();
  const guests = Array.from({ length: 6 }, (_, i) => makeGuest(i + 1));
  const result = autoAssignSeating({ guestPool: guests, tables });
  // The save payload persists each seat_key as `${client_table_id}:side|end:…`.
  // On reopen the service must return tables identified by that same
  // client_table_id, so the reopened geometry re-keys to identical ids.
  const savedAssignments = autoAssignResultToAssignments(result);
  const reopened = deriveSeatingAssignmentRestoreState({
    assignments: savedAssignments,
    geometry: computeTableSeats({ tables }),
    guestPool: guests,
  });

  assertEqual(reopened.invalidAssignments.length, 0, "no false invalid-seat warning");
  assertEqual(
    reopened.occupiedCount,
    result.assignedSeats.length,
    "status line keeps occupied count after reopen",
  );
  assertEqual(
    reopened.occupants.length,
    result.assignedSeats.length,
    "canvas occupants match placed chairs",
  );
  assertEqual(
    reopened.unassignedGuests.length,
    result.remainingUnassignedGuests.length,
    "panel unassigned matches overflow only",
  );
});

test("reopen keyed by volatile table ids orphans saved seats (identity must be client_table_id)", () => {
  const tables = defaultTables();
  const guests = Array.from({ length: 3 }, (_, i) => makeGuest(i + 1));
  const savedAssignments = autoAssignResultToAssignments(
    autoAssignSeating({ guestPool: guests, tables }),
  );
  // Regression guard for the normalizeTable bug: the read RPC returns
  // `to_jsonb(st.*)` carrying BOTH the volatile DB `id` uuid and the stable
  // `client_table_id`. If a reopen re-keys tables to the uuid, every saved
  // seat_key (built from client_table_id) is orphaned — exactly the failure the
  // service fix prevents.
  const reKeyedTables = tables.map((table, index) => ({
    ...table,
    id: `db-uuid-${index}`,
  }));
  const restored = deriveSeatingAssignmentRestoreState({
    assignments: savedAssignments,
    geometry: computeTableSeats({ tables: reKeyedTables }),
    guestPool: guests,
  });

  assert(restored.invalidAssignments.length > 0, "volatile ids orphan saved seats");
  assertEqual(restored.occupiedCount, 0, "no occupied seats once table ids drift");
  assertEqual(
    restored.unassignedGuests.length,
    guests.length,
    "orphaned guests fall back to the unassigned panel",
  );
});

test("repeat auto seating preserves locked placements and only seats the pool", () => {
  const tables = defaultTables();
  const geometry = computeTableSeats({ tables });
  const guests = Array.from({ length: 4 }, (_, i) => makeGuest(i + 1));
  // Guest 1 is manually locked onto a specific non-rabbi seat.
  const lockedSeatIndex = geometry.seats.findIndex((seat) => !seat.isRabbiTable);
  const lockedSeatKey = `${geometry.seats[lockedSeatIndex].tableId}:${seatStable(
    geometry,
    lockedSeatIndex,
  )}`;
  const lockedAssignments = [
    {
      guestInitials: guests[0].initials,
      guestLabel: guests[0].displayName,
      id: "locked-1",
      layoutId: "layout-1",
      locked: true,
      placementSource: "manual" as const,
      registrationId: guests[0].registrationId,
      seatKey: lockedSeatKey,
      type: "guest" as const,
    },
  ];

  const result = autoAssignSeating({ guestPool: guests, lockedAssignments, tables });

  // The locked seat is not reused by auto seating, and its guest is not re-seated.
  assert(
    result.assignedSeats.every((seat) => seat.seatIndex !== lockedSeatIndex),
    "locked seat is left untouched by auto",
  );
  assert(
    result.assignedSeats.every((seat) => seat.guest.registrationId !== guests[0].registrationId),
    "locked guest is excluded from the auto queue",
  );
  // The other three pool guests are seated.
  assertEqual(result.assignedSeats.length, 3, "remaining pool guests seated");
});

test("repeat auto seating treats a locked reserve seat as blocked and never seats reserves", () => {
  const tables = defaultTables();
  const geometry = computeTableSeats({ tables });
  const guests = Array.from({ length: 3 }, (_, i) => makeGuest(i + 1));
  // A reserve is manually placed on a non-rabbi seat (no registration).
  const reserveSeatIndex = geometry.seats.findIndex((seat) => !seat.isRabbiTable);
  const reserveSeatKey = `${geometry.seats[reserveSeatIndex].tableId}:${seatStable(
    geometry,
    reserveSeatIndex,
  )}`;
  const lockedAssignments = [
    {
      guestInitials: "Рез",
      guestLabel: "Гость раввина",
      id: "reserve-1",
      layoutId: "layout-1",
      locked: true,
      placementSource: "manual" as const,
      registrationId: null,
      seatKey: reserveSeatKey,
      type: "reserve" as const,
    },
  ];

  const result = autoAssignSeating({ guestPool: guests, lockedAssignments, tables });

  // The reserve seat is blocked: auto never reuses it.
  assert(
    result.assignedSeats.every((seat) => seat.seatIndex !== reserveSeatIndex),
    "reserve seat is left untouched by auto",
  );
  // Auto only seats registration guests; every assigned seat carries a registration.
  assert(
    result.assignedSeats.every((seat) => seat.guest.registrationId !== null),
    "auto seats only registration guests, never reserves",
  );
  assertEqual(result.assignedSeats.length, 3, "all registration guests seated");
});

test("a placed reserve does not count as an occupied registration seat", () => {
  const tables = defaultTables();
  const geometry = computeTableSeats({ tables });
  const guest = makeGuest(1);
  const guestSeatIndex = geometry.seats.findIndex((seat) => !seat.isRabbiTable);
  const reserveSeatIndex = geometry.seats.findIndex(
    (seat, index) => !seat.isRabbiTable && index !== guestSeatIndex,
  );
  const assignments = [
    {
      guestInitials: guest.initials,
      guestLabel: guest.displayName,
      id: "guest-1",
      layoutId: "layout-1",
      registrationId: guest.registrationId,
      seatKey: `${geometry.seats[guestSeatIndex].tableId}:${seatStable(geometry, guestSeatIndex)}`,
      type: "guest" as const,
    },
    {
      guestInitials: "Рез",
      guestLabel: "Резерв 1",
      id: "reserve-1",
      layoutId: "layout-1",
      registrationId: null,
      seatKey: `${geometry.seats[reserveSeatIndex].tableId}:${seatStable(geometry, reserveSeatIndex)}`,
      type: "reserve" as const,
    },
  ];

  const state = deriveSeatingAssignmentRestoreState({
    assignments,
    geometry,
    guestPool: [guest],
  });

  // Two physical seats occupied, but only the one registration guest counts.
  assertEqual(state.occupants.length, 2, "both occupants placed on canvas");
  assertEqual(state.occupiedCount, 1, "reserve excluded from registration occupied count");
  assertEqual(
    state.occupants.filter((occupant) => occupant.type === "reserve").length,
    1,
    "reserve rendered as an occupant",
  );
});

test("repeat auto after geometry reconcile preserves locked/manual/reserve placements", () => {
  const tables = defaultTables();
  const geometry = computeTableSeats({ tables });
  const guests = Array.from({ length: 4 }, (_, i) => makeGuest(i + 1));
  const regularIndexes = geometry.seats
    .map((seat, index) => ({ seat, index }))
    .filter(({ seat }) => !seat.isRabbiTable)
    .map(({ index }) => index);
  const manualIndex = regularIndexes[0];
  const reserveIndex = regularIndexes[1];

  const preserved: SeatingAssignment[] = [
    {
      guestInitials: guests[0].initials,
      guestLabel: guests[0].displayName,
      id: "manual-1",
      layoutId: "layout-1",
      locked: true,
      placementSource: "manual",
      registrationId: guests[0].registrationId,
      seatKey: `${geometry.seats[manualIndex].tableId}:${seatStable(geometry, manualIndex)}`,
      type: "guest",
    },
    {
      guestInitials: "Рез",
      guestLabel: "Гость раввина",
      id: "reserve-1",
      layoutId: "layout-1",
      locked: true,
      placementSource: "manual",
      registrationId: null,
      seatKey: `${geometry.seats[reserveIndex].tableId}:${seatStable(geometry, reserveIndex)}`,
      type: "reserve",
    },
  ];

  // The "regular" table is moved (same client_table_id) — seat keys still resolve.
  const movedGeometry = computeTableSeats({
    tables: [
      makeTable({ id: "rabbi", cx: 100, cy: 100, isRabbiTable: true }),
      makeTable({ id: "regular", cx: 380, cy: 360, isRabbiTable: false }),
    ],
  });

  // 1) Reconcile preserves both placements; 2) auto only fills the rest.
  const reconcile = reconcileSeatingAssignments({
    assignments: preserved,
    geometry: movedGeometry,
    guestPool: guests,
  });
  assertEqual(reconcile.counts.keptCount, 2, "manual guest + reserve preserved");
  assertEqual(reconcile.counts.returnedCount, 0, "nothing returned on a pure move");

  const result = autoAssignSeating({
    geometry: movedGeometry,
    guestPool: guests,
    lockedAssignments: reconcile.keptAssignments,
    tables: [
      makeTable({ id: "rabbi", cx: 100, cy: 100, isRabbiTable: true }),
      makeTable({ id: "regular", cx: 380, cy: 360, isRabbiTable: false }),
    ],
  });

  // Locked seats are not reused, and neither the manual guest nor the reserve is
  // re-seated by auto (auto seats only the remaining registration guests).
  assert(
    result.assignedSeats.every(
      (seat) => seat.seatIndex !== manualIndex && seat.seatIndex !== reserveIndex,
    ),
    "locked manual/reserve seats are left untouched",
  );
  assert(
    result.assignedSeats.every(
      (seat) => seat.guest.registrationId !== guests[0].registrationId,
    ),
    "manually locked guest is excluded from the auto queue",
  );
  assert(
    result.assignedSeats.every((seat) => seat.guest.registrationId !== null),
    "auto never seats reserves",
  );
});

function seatStable(geometry: ReturnType<typeof computeTableSeats>, index: number): string {
  const seat = geometry.seats[index];
  if (seat.kind === "side" && seat.edge && typeof seat.slot === "number") {
    return `side:${seat.edge}:${seat.slot}`;
  }
  if (seat.kind === "end" && seat.end) {
    return `end:${seat.end}`;
  }
  return `legacy:${index}`;
}

console.log(
  `\nSeating auto-assign tests: ${passed} passed, ${failures.length} failed`,
);
if (failures.length) {
  throw new Error(`${failures.length} seating auto-assign test(s) failed`);
}
