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
  SeatingConnection,
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

function makeParty(
  registrationId: string,
  size: number,
  firstGuestNumber: number,
): SeatingGuestPoolItem[] {
  return Array.from({ length: size }, (_, memberIndex) =>
    makeGuest(firstGuestNumber + memberIndex, {
      guestIndex: memberIndex === 0 ? null : memberIndex - 1,
      guestName: memberIndex === 0 ? null : `Party guest ${memberIndex}`,
      registrationId,
      source: memberIndex === 0 ? "participant" : "guest",
      sourceLabel: memberIndex === 0 ? "Participant" : "Guest",
    }),
  );
}

function makeSyntheticLayout(
  specs: Array<{ id: string; isRabbiTable?: boolean; seatCount: number }>,
): { geometry: SeatingGeometryResult; tables: SeatingTable[] } {
  const tables = specs.map((spec, index) =>
    makeTable({
      cx: 100 + index * 240,
      id: spec.id,
      isRabbiTable: spec.isRabbiTable ?? false,
    }),
  );
  const tableById = new Map(tables.map((table) => [table.id, table]));
  const seats = specs.flatMap((spec) =>
    Array.from({ length: spec.seatCount }, (_, slot) => {
      const table = tableById.get(spec.id)!;
      return {
        anchor: { x: table.cx + slot, y: table.cy },
        edge: "a" as const,
        isRabbiTable: table.isRabbiTable,
        kind: "side" as const,
        slot,
        tableId: table.id,
        x: table.cx + slot,
        y: table.cy - 40,
      };
    }),
  );
  const rabbiTableSeats = seats
    .map((seat, seatIndex) => ({ seat, seatIndex }))
    .filter(({ seat }) => seat.isRabbiTable);
  const rabbiHeadIndex =
    rabbiTableSeats[Math.floor(rabbiTableSeats.length / 2)]?.seatIndex ?? 0;
  return {
    geometry: {
      headIndex: rabbiHeadIndex,
      height: 640,
      physicalSeatCount: seats.length,
      seats,
      seams: [],
      width: 980,
    },
    tables,
  };
}

function makeConnection(aTableId: string, bTableId: string): SeatingConnection {
  return {
    aEnd: "b",
    aTableId,
    bEnd: "a",
    bTableId,
    x: 0,
    y: 0,
  };
}

function tableSeatIndexes(
  geometry: SeatingGeometryResult,
  tableId: string,
): number[] {
  return geometry.seats
    .map((seat, seatIndex) => ({ seat, seatIndex }))
    .filter(({ seat }) => seat.tableId === tableId)
    .map(({ seatIndex }) => seatIndex);
}

function lockedGuestAssignment(
  guest: SeatingGuestPoolItem,
  geometry: SeatingGeometryResult,
  tableId: string,
  localSeatIndex = 0,
): SeatingAssignment {
  const seatIndex = tableSeatIndexes(geometry, tableId)[localSeatIndex];
  return {
    guestInitials: guest.initials,
    guestLabel: guest.displayName,
    id: `locked:${guest.key}`,
    layoutId: "layout-1",
    locked: true,
    placementSource: "manual",
    registrationId: guest.registrationId,
    seatKey: `${tableId}:${seatStable(geometry, seatIndex)}`,
    type: "guest",
  };
}

function assignedTableIds(
  result: ReturnType<typeof autoAssignSeating>,
  registrationId: string,
): string[] {
  return result.assignedSeats
    .filter((assigned) => assigned.guest.registrationId === registrationId)
    .map((assigned) => result.geometry.seats[assigned.seatIndex].tableId);
}

test("deterministic auto seating: same input produces same assignments", () => {
  const tables = defaultTables();
  const guests = Array.from({ length: 4 }, (_, i) => makeGuest(i + 1));
  const first = autoAssignSeating({ guestPool: guests, tables });
  const second = autoAssignSeating({ guestPool: guests, tables });

  assertArrayEqual(
    first.assignedSeats.map((seat) => `${seat.guest.key}@${seat.seatKey}`),
    second.assignedSeats.map((seat) => `${seat.guest.key}@${seat.seatKey}`),
    "stable assignments",
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
    guestPool: Array.from({ length: 5 }, (_, i) =>
      makeGuest(i + 1, {
        guestIndex: i,
        guestName: `Ordinary guest ${i + 1}`,
        source: "guest",
      }),
    ),
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

test("restore keeps a manual ordinary guest on a rabbi seat", () => {
  const tables = defaultTables();
  const geometry = computeTableSeats({ tables });
  const guest = makeGuest(1, {
    guestIndex: 0,
    guestName: "Ordinary guest",
    source: "guest",
  });
  const rabbiSeatIndex = geometry.seats.findIndex((seat) => seat.isRabbiTable);
  const manualAssignment: SeatingAssignment = {
    guestInitials: guest.initials,
    guestLabel: guest.displayName,
    id: "manual-rabbi-1",
    layoutId: "layout-1",
    locked: true,
    placementSource: "manual",
    registrationId: guest.registrationId,
    seatKey: `${geometry.seats[rabbiSeatIndex].tableId}:${seatStable(
      geometry,
      rabbiSeatIndex,
    )}`,
    type: "guest",
  };

  const restored = deriveSeatingAssignmentRestoreState({
    assignments: [manualAssignment],
    geometry,
    guestPool: [guest],
  });

  assertEqual(restored.invalidAssignments.length, 0, "rabbi seat assignment is valid");
  assertEqual(restored.currentAssignments[0]?.seatKey, manualAssignment.seatKey, "seat retained");
  assertEqual(restored.occupants.length, 1, "ordinary guest remains seated");
  assertEqual(restored.occupants[0]?.seatIndex, rabbiSeatIndex, "occupant remains on rabbi seat");
  assertEqual(restored.occupants[0]?.locked, true, "restored placement remains locked");
  assertEqual(restored.occupants[0]?.placementSource, "manual", "manual source retained");
  assertEqual(restored.unassignedGuests.length, 0, "guest is not returned to pool");
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

test("repeat auto seating preserves a locked ordinary guest on a rabbi seat", () => {
  const tables = defaultTables();
  const geometry = computeTableSeats({ tables });
  const guests = Array.from({ length: 4 }, (_, i) => makeGuest(i + 1));
  const lockedSeatIndex = geometry.seats.findIndex((seat) => seat.isRabbiTable);
  const lockedAssignment: SeatingAssignment = {
    guestInitials: guests[0].initials,
    guestLabel: guests[0].displayName,
    id: "manual-rabbi-1",
    layoutId: "layout-1",
    locked: true,
    placementSource: "manual",
    registrationId: guests[0].registrationId,
    seatKey: `${geometry.seats[lockedSeatIndex].tableId}:${seatStable(
      geometry,
      lockedSeatIndex,
    )}`,
    type: "guest",
  };

  const result = autoAssignSeating({
    guestPool: guests,
    lockedAssignments: [lockedAssignment],
    tables,
  });

  assert(
    result.blockedRabbiSeats.includes(lockedSeatIndex),
    "locked rabbi seat remains protected from auto",
  );
  assert(
    result.assignedSeats.every((seat) => seat.seatIndex !== lockedSeatIndex),
    "locked seat is not reused",
  );
  assert(
    result.assignedSeats.every(
      (seat) => seat.guest.registrationId !== guests[0].registrationId,
    ),
    "locked ordinary guest is excluded from the auto queue",
  );
  assert(
    result.assignedSeats.every((seat) => !geometry.seats[seat.seatIndex].isRabbiTable),
    "remaining ordinary guests use only auto-eligible seats",
  );
  assertEqual(result.assignedSeats.length, 3, "only remaining guests are auto seated");
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

test("party scenario 1: a party of five fits one table in deterministic member order", () => {
  const registrationId = "registration-a";
  const party = makeParty(registrationId, 5, 100);
  const { geometry, tables } = makeSyntheticLayout([
    { id: "rabbi", isRabbiTable: true, seatCount: 2 },
    { id: "party-table", seatCount: 7 },
    { id: "larger-table", seatCount: 8 },
  ]);
  const result = autoAssignSeating({
    geometry,
    guestPool: [party[3], party[0], party[4], party[2], party[1]],
    tables,
  });

  assertArrayEqual(
    assignedTableIds(result, registrationId),
    Array(5).fill("party-table"),
    "complete party uses one exact-fit table",
  );
  assertArrayEqual(
    result.assignedSeats.map((assigned) => assigned.guest.key),
    party.map((guest) => guest.key),
    "participant precedes guests ordered by guestIndex",
  );
  const partySeatIndexes = result.assignedSeats.map((assigned) => assigned.seatIndex);
  assertEqual(
    Math.max(...partySeatIndexes) - Math.min(...partySeatIndexes),
    4,
    "party uses the smallest-span table-local subset",
  );
});

test("party scenario 2: two registrations form independent parties", () => {
  const partyA = makeParty("registration-a", 5, 200);
  const partyB = makeParty("registration-b", 3, 300);
  const { geometry, tables } = makeSyntheticLayout([
    { id: "rabbi", isRabbiTable: true, seatCount: 2 },
    { id: "table-a", seatCount: 5 },
    { id: "table-b", seatCount: 3 },
  ]);
  const result = autoAssignSeating({
    geometry,
    guestPool: [...partyA, ...partyB],
    tables,
  });

  assertArrayEqual(
    assignedTableIds(result, "registration-a"),
    Array(5).fill("table-a"),
    "party A grouped",
  );
  assertArrayEqual(
    assignedTableIds(result, "registration-b"),
    Array(3).fill("table-b"),
    "party B grouped independently",
  );
});

test("party scenario 3: singles do not fragment a party with a fitting table", () => {
  const partyA = makeParty("registration-a", 5, 400);
  const singleB = makeParty("registration-b", 1, 500);
  const singleC = makeParty("registration-c", 1, 600);
  const { geometry, tables } = makeSyntheticLayout([
    { id: "rabbi", isRabbiTable: true, seatCount: 2 },
    { id: "party-table", seatCount: 5 },
    { id: "singles-table", seatCount: 2 },
  ]);
  const result = autoAssignSeating({
    geometry,
    guestPool: [...partyA, ...singleB, ...singleC],
    tables,
  });

  assertArrayEqual(
    assignedTableIds(result, "registration-a"),
    Array(5).fill("party-table"),
    "party A remains whole",
  );
  assertEqual(result.assignedSeats.length, 7, "party and both singles seated");
});

test("party scenario 4: an oversized party prefers a complete connected set", () => {
  const party = makeParty("registration-a", 7, 700);
  const { geometry, tables } = makeSyntheticLayout([
    { id: "rabbi", isRabbiTable: true, seatCount: 2 },
    { id: "connected-a", seatCount: 4 },
    { id: "connected-b", seatCount: 4 },
    { id: "chain-a", seatCount: 3 },
    { id: "chain-b", seatCount: 3 },
    { id: "chain-c", seatCount: 3 },
  ]);
  const result = autoAssignSeating({
    connections: [
      makeConnection("connected-a", "connected-b"),
      makeConnection("chain-a", "chain-b"),
      makeConnection("chain-b", "chain-c"),
    ],
    geometry,
    guestPool: party,
    tables,
  });
  const usedTables = new Set(assignedTableIds(result, "registration-a"));

  assertArrayEqual(
    [...usedTables].sort(),
    ["connected-a", "connected-b"],
    "two connected tables used",
  );
  assertEqual(result.assignedSeats.length, 7, "complete party assigned");
});

test("party scenario 5: a locked member anchors the remainder to the same table", () => {
  const party = makeParty("registration-a", 5, 800);
  const { geometry, tables } = makeSyntheticLayout([
    { id: "rabbi", isRabbiTable: true, seatCount: 2 },
    { id: "anchor", seatCount: 5 },
    { id: "other", seatCount: 4 },
  ]);
  const result = autoAssignSeating({
    geometry,
    guestPool: party,
    lockedAssignments: [lockedGuestAssignment(party[0], geometry, "anchor")],
    tables,
  });

  assertEqual(result.assignedSeats.length, 4, "only unlocked members returned");
  assertArrayEqual(
    assignedTableIds(result, "registration-a"),
    Array(4).fill("anchor"),
    "remainder uses locked member table",
  );
  assert(
    result.assignedSeats.every((assigned) => assigned.guest.key !== party[0].key),
    "locked member is not duplicated",
  );
});

test("party scenario 6: an insufficient locked table expands onto its connection", () => {
  const party = makeParty("registration-a", 5, 900);
  const { geometry, tables } = makeSyntheticLayout([
    { id: "rabbi", isRabbiTable: true, seatCount: 2 },
    { id: "anchor", seatCount: 3 },
    { id: "connected", seatCount: 4 },
    { id: "unrelated", seatCount: 4 },
  ]);
  const lockedAssignment = lockedGuestAssignment(party[0], geometry, "anchor");
  const lockedSeatKey = lockedAssignment.seatKey;
  const result = autoAssignSeating({
    connections: [makeConnection("anchor", "connected")],
    geometry,
    guestPool: party,
    lockedAssignments: [lockedAssignment],
    tables,
  });
  const usedTables = assignedTableIds(result, "registration-a");

  assertEqual(lockedAssignment.seatKey, lockedSeatKey, "locked placement unchanged");
  assertEqual(usedTables.filter((tableId) => tableId === "anchor").length, 2, "anchor free seats used");
  assertEqual(usedTables.filter((tableId) => tableId === "connected").length, 2, "connected fallback used");
  assert(!usedTables.includes("unrelated"), "unrelated table avoided");
});

test("party scenario 7: a manual rabbi-seat lock anchors only eligible connected seats", () => {
  const party = makeParty("registration-a", 5, 1000);
  const { geometry, tables } = makeSyntheticLayout([
    { id: "rabbi", isRabbiTable: true, seatCount: 2 },
    { id: "connected", seatCount: 4 },
    { id: "unrelated", seatCount: 4 },
  ]);
  const lockedAssignment = lockedGuestAssignment(party[0], geometry, "rabbi");
  const lockedSeatIndex = seatIndexFromSeatKey(lockedAssignment.seatKey, geometry);
  const result = autoAssignSeating({
    connections: [makeConnection("rabbi", "connected")],
    geometry,
    guestPool: party,
    lockedAssignments: [lockedAssignment],
    tables,
  });

  assert(
    lockedSeatIndex !== null && result.blockedRabbiSeats.includes(lockedSeatIndex),
    "manual rabbi seat remains occupied/protected",
  );
  assertArrayEqual(
    assignedTableIds(result, "registration-a"),
    Array(4).fill("connected"),
    "remaining party uses connected eligible table",
  );
  assert(
    result.assignedSeats.every((assigned) => !geometry.seats[assigned.seatIndex].isRabbiTable),
    "other protected rabbi seats stay unused",
  );
});

test("party scenario 8: fresh ordinary parties never consume protected rabbi seats", () => {
  const party = makeParty("registration-a", 3, 1100);
  const { geometry, tables } = makeSyntheticLayout([
    { id: "rabbi", isRabbiTable: true, seatCount: 5 },
    { id: "regular", seatCount: 3 },
  ]);
  const result = autoAssignSeating({ geometry, guestPool: party, tables });

  assertArrayEqual(
    assignedTableIds(result, "registration-a"),
    Array(3).fill("regular"),
    "ordinary party uses only regular table",
  );
});

test("party scenario 9: explicit rabbi guest keeps the existing head placement", () => {
  const rabbiGuest = makeGuest(1200, {
    id: "explicit-rabbi",
    key: "explicit-rabbi",
    registrationId: "rabbi-registration",
  });
  const ordinaryParty = makeParty("registration-a", 2, 1210);
  const { geometry, tables } = makeSyntheticLayout([
    { id: "rabbi", isRabbiTable: true, seatCount: 3 },
    { id: "regular", seatCount: 2 },
  ]);
  const result = autoAssignSeating({
    geometry,
    guestPool: [rabbiGuest, ...ordinaryParty],
    rabbiGuestKeys: [rabbiGuest.key],
    tables,
  });
  const rabbiAssignment = result.assignedSeats.find(
    (assigned) => assigned.guest.key === rabbiGuest.key,
  );

  assertEqual(rabbiAssignment?.seatIndex ?? -1, geometry.headIndex, "rabbi head preserved");
  assert(rabbiAssignment?.isRabbiHead === true, "rabbi head marker preserved");
  assertArrayEqual(
    assignedTableIds(result, "registration-a"),
    ["regular", "regular"],
    "ordinary party remains protected",
  );
});

test("party scenario 10: a locked reserve blocks its seat without joining a party", () => {
  const party = makeParty("registration-a", 3, 1300);
  const { geometry, tables } = makeSyntheticLayout([
    { id: "rabbi", isRabbiTable: true, seatCount: 2 },
    { id: "regular", seatCount: 4 },
  ]);
  const reserveSeatIndex = tableSeatIndexes(geometry, "regular")[0];
  const reserve: SeatingAssignment = {
    guestInitials: "R",
    guestLabel: "Reserve",
    id: "reserve-party-regression",
    layoutId: "layout-1",
    locked: true,
    placementSource: "manual",
    registrationId: null,
    seatKey: `regular:${seatStable(geometry, reserveSeatIndex)}`,
    type: "reserve",
  };
  const result = autoAssignSeating({
    geometry,
    guestPool: party,
    lockedAssignments: [reserve],
    tables,
  });

  assertEqual(result.assignedSeats.length, 3, "all registration guests seated");
  assert(
    result.assignedSeats.every((assigned) => assigned.seatIndex !== reserveSeatIndex),
    "reserve seat remains blocked",
  );
});

test("party scenario 11: insufficient seats return exact unresolved members and warning", () => {
  const party = makeParty("registration-a", 5, 1400);
  const { geometry, tables } = makeSyntheticLayout([
    { id: "rabbi", isRabbiTable: true, seatCount: 2 },
    { id: "regular", seatCount: 3 },
  ]);
  const result = autoAssignSeating({ geometry, guestPool: party, tables });

  assertEqual(result.assignedSeats.length, 3, "all eligible physical seats used");
  assertArrayEqual(
    result.remainingUnassignedGuests.map((guest) => guest.key),
    party.slice(3).map((guest) => guest.key),
    "exact unresolved party members returned",
  );
  assertEqual(result.warning?.code, "not_enough_physical_seats", "shortage warning");
  assertEqual(result.warning?.overflowCount, 2, "overflow count");
});

test("party scenario 12: repeated calls preserve assignments and overflow order", () => {
  const partyA = makeParty("registration-a", 5, 1500);
  const partyB = makeParty("registration-b", 2, 1600);
  const { geometry, tables } = makeSyntheticLayout([
    { id: "rabbi", isRabbiTable: true, seatCount: 2 },
    { id: "table-a", seatCount: 4 },
    { id: "table-b", seatCount: 2 },
  ]);
  const input = { geometry, guestPool: [...partyA, ...partyB], tables };
  const first = autoAssignSeating(input);
  const second = autoAssignSeating(input);

  assertArrayEqual(
    first.assignedSeats.map((assigned) => `${assigned.guest.key}@${assigned.seatKey}`),
    second.assignedSeats.map((assigned) => `${assigned.guest.key}@${assigned.seatKey}`),
    "guest-to-seat mapping repeats",
  );
  assertArrayEqual(
    first.remainingUnassignedGuests.map((guest) => guest.key),
    second.remainingUnassignedGuests.map((guest) => guest.key),
    "unassigned order repeats",
  );
});

test("party scenario 13: single-person registrations still auto-seat", () => {
  const singles = [
    ...makeParty("registration-a", 1, 1700),
    ...makeParty("registration-b", 1, 1710),
    ...makeParty("registration-c", 1, 1720),
    ...makeParty("registration-d", 1, 1730),
  ];
  const { geometry, tables } = makeSyntheticLayout([
    { id: "rabbi", isRabbiTable: true, seatCount: 3 },
    { id: "regular-a", seatCount: 2 },
    { id: "regular-b", seatCount: 2 },
  ]);
  const result = autoAssignSeating({ geometry, guestPool: singles, tables });

  assertEqual(result.assignedSeats.length, singles.length, "all singles seated");
  assertEqual(result.remainingUnassignedGuests.length, 0, "no single left behind");
  assert(
    result.assignedSeats.every((assigned) => !geometry.seats[assigned.seatIndex].isRabbiTable),
    "singles do not consume rabbi seats",
  );
});

test("party scenario 14: blocked seats do not count toward whole-table fit", () => {
  const party = makeParty("registration-a", 3, 1800);
  const { geometry, tables } = makeSyntheticLayout([
    { id: "rabbi", isRabbiTable: true, seatCount: 2 },
    { id: "blocked-table", seatCount: 3 },
    { id: "eligible-table", seatCount: 4 },
  ]);
  const blockedSeatIndex = tableSeatIndexes(geometry, "blocked-table")[1];
  const result = autoAssignSeating({
    blockedSeatIndexes: [blockedSeatIndex],
    geometry,
    guestPool: party,
    tables,
  });

  assertArrayEqual(
    assignedTableIds(result, "registration-a"),
    Array(3).fill("eligible-table"),
    "party evaluates genuinely eligible capacity",
  );
  assert(
    result.assignedSeats.every((assigned) => assigned.seatIndex !== blockedSeatIndex),
    "blocked seat unused",
  );
});

test("party scenario 15: exact fit beats a larger eligible table", () => {
  const party = makeParty("registration-a", 5, 1900);
  const { geometry, tables } = makeSyntheticLayout([
    { id: "rabbi", isRabbiTable: true, seatCount: 2 },
    { id: "exact", seatCount: 5 },
    { id: "larger", seatCount: 8 },
  ]);
  const result = autoAssignSeating({ geometry, guestPool: party, tables });

  assertArrayEqual(
    assignedTableIds(result, "registration-a"),
    Array(5).fill("exact"),
    "smallest non-negative excess wins",
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
