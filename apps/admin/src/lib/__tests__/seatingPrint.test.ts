import {
  buildPrintSeatNumberBySeatIndex,
  buildSeatingPrintModel,
} from "../seatingPrint";
import { computeTableSeats, TABLE_H, TABLE_W } from "../seatingGeometry";
import type {
  SeatingGuestPoolItem,
  SeatingSeatOccupant,
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

function makeGuest(over: Partial<SeatingGuestPoolItem> = {}): SeatingGuestPoolItem {
  return {
    capacityReservationIds: [],
    capacityUnitId: "unit-1",
    displayName: "Не рассаженный Гость",
    email: "secret@example.test",
    guestIndex: null,
    guestName: null,
    id: "guest-unseated",
    initials: "НГ",
    key: "guest-unseated",
    occurrenceId: null,
    optionIds: [],
    optionTitles: [],
    participantDisplayName: "Не рассаженный Гость",
    participantUserId: null,
    paymentStatus: null,
    phone: "+79990000000",
    registrationId: "00000000-0000-4000-8000-000000000001",
    seatObligationSource: "reservation",
    source: "participant",
    sourceLabel: "Participant",
    status: "confirmed",
    ...over,
  };
}

function makeOccupant(
  over: Partial<SeatingSeatOccupant> & Pick<SeatingSeatOccupant, "id" | "seatIndex">,
): SeatingSeatOccupant {
  const { id, seatIndex, ...rest } = over;
  return {
    displayName: "Тимур Губайдуллин",
    id,
    initials: "ТГ",
    registrationId: "00000000-0000-4000-8000-000000000002",
    seatIndex,
    seatKey: `seat:${seatIndex}`,
    type: "guest",
    ...rest,
  };
}

test("uses visual table-based print seat numbers in scheme and legend", () => {
  const topTable = makeTable({ id: "rabbi", cx: 100, cy: 100, isRabbiTable: true });
  const bottomTable = makeTable({ id: "regular", cx: 100, cy: 340 });
  const tables = [bottomTable, topTable];
  const geometry = computeTableSeats({ tables });
  const topSeatIndexes = geometry.seats
    .map((seat, index) => ({ index, seat }))
    .filter(({ seat }) => seat.tableId === topTable.id)
    .map(({ index }) => index);
  const bottomSeatIndexes = geometry.seats
    .map((seat, index) => ({ index, seat }))
    .filter(({ seat }) => seat.tableId === bottomTable.id)
    .map(({ index }) => index);
  const printSeatNumberBySeatIndex = buildPrintSeatNumberBySeatIndex({
    geometry,
    tables,
  });
  const topSeatIndex = topSeatIndexes[0];
  const bottomSeatIndex = bottomSeatIndexes[0];
  const occupants: SeatingSeatOccupant[] = [
    makeOccupant({
      displayName: "Андрей Александров",
      id: "guest-bottom",
      initials: "АА",
      seatIndex: bottomSeatIndex,
    }),
    makeOccupant({
      displayName: "Гость раввина",
      id: "reserve-top",
      initials: "Рз",
      registrationId: null,
      seatIndex: topSeatIndex,
      type: "reserve",
    }),
  ];

  const model = buildSeatingPrintModel({
    capacityBucketTitle: "Шаббатний ужин",
    eventTitle: "Среди своих",
    geometry,
    occupants,
    occurrenceSubtitle: "Пятница · dinner",
    printedAt: new Date("2026-06-29T10:15:00Z"),
    tables,
  });

  const topPrintNumber = printSeatNumberBySeatIndex[topSeatIndex];
  const bottomPrintNumber = printSeatNumberBySeatIndex[bottomSeatIndex];

  assertEqual(topPrintNumber, 1, "top table starts print numbering");
  assert(bottomPrintNumber > topSeatIndexes.length, "bottom table prints after top table");
  assertEqual(
    bottomPrintNumber,
    model.canvas.seats[bottomSeatIndex].seatNumber,
    "model uses print number map",
  );
  assertArrayEqual(
    model.legend.map((item) => item.seatNumber),
    [topPrintNumber, bottomPrintNumber],
    "legend sorted by seat number",
  );
  assertEqual(
    model.canvas.seats[bottomSeatIndex].occupant?.schemeLabel,
    `АА ${bottomPrintNumber}`,
    "scheme label",
  );
  assert(
    model.legend[0]?.legendLabel.startsWith("Резерв:"),
    "placed reserve is explicitly labelled",
  );
});

test("keeps disabled chairs visible but unnumbered and excludes stale occupants", () => {
  const table = makeTable({
    disabledSeats: ["side:a:0"],
    id: "disabled-table",
    isRabbiTable: true,
  });
  const tables = [table];
  const geometry = computeTableSeats({ tables });
  const disabledSeatIndex = geometry.seats.findIndex((seat) => seat.isDisabled);
  const activeSeatIndex = geometry.seats.findIndex((seat) => !seat.isDisabled);
  const printSeatNumberBySeatIndex = buildPrintSeatNumberBySeatIndex({
    geometry,
    tables,
  });

  assert(disabledSeatIndex >= 0, "disabled seat exists");
  assert(activeSeatIndex >= 0, "active seat exists");
  assertEqual(
    printSeatNumberBySeatIndex[disabledSeatIndex],
    undefined,
    "disabled seat has no print number",
  );
  assertArrayEqual(
    Object.values(printSeatNumberBySeatIndex).sort((a, b) => a - b),
    Array.from({ length: geometry.physicalSeatCount }, (_, index) => index + 1),
    "active print numbers are contiguous",
  );
  assertEqual(
    Object.keys(printSeatNumberBySeatIndex).length,
    geometry.physicalSeatCount,
    "only physical seats receive print numbers",
  );

  const model = buildSeatingPrintModel({
    capacityBucketTitle: "Шаббатний ужин",
    eventTitle: "Среди своих",
    geometry,
    occupants: [
      makeOccupant({ id: "guest-disabled", seatIndex: disabledSeatIndex }),
      makeOccupant({ id: "guest-active", seatIndex: activeSeatIndex }),
    ],
    occurrenceSubtitle: "Пятница · dinner",
    printedAt: new Date("2026-06-29T10:15:00Z"),
    tables,
  });
  const disabledPrintSeat = model.canvas.seats[disabledSeatIndex];
  const activePrintSeat = model.canvas.seats[activeSeatIndex];

  assertEqual(model.canvas.seats.length, geometry.seats.length, "all chairs remain on canvas");
  assertEqual(disabledPrintSeat.isDisabled, true, "disabled chair is explicit in print model");
  assertEqual(disabledPrintSeat.seatNumber, null, "disabled chair has null print number");
  assertEqual(disabledPrintSeat.occupant, null, "disabled chair has no print occupant");
  assert(!model.legend.some((item) => item.id === "guest-disabled"), "stale occupant omitted from legend");
  assert(
    !model.canvas.seats.some((seat) => seat.occupant?.id === "guest-disabled"),
    "stale occupant omitted from scheme",
  );
  assert(activePrintSeat.seatNumber !== null, "active occupant has a print number");
  assertEqual(activePrintSeat.occupant?.seatNumber, activePrintSeat.seatNumber, "scheme number matches occupant");
  assertEqual(
    model.legend.find((item) => item.id === "guest-active")?.seatNumber,
    activePrintSeat.seatNumber,
    "legend number matches scheme",
  );
});

test("unseated section omits email and phone", () => {
  const tables = [makeTable({ id: "rabbi", isRabbiTable: true })];
  const geometry = computeTableSeats({ tables });
  const model = buildSeatingPrintModel({
    capacityBucketTitle: "VIP",
    eventTitle: "Среди своих",
    geometry,
    occupants: [],
    occurrenceSubtitle: "Без отдельного сеанса",
    printedAt: new Date("2026-06-29T10:15:00Z"),
    tables,
    unseatedGuests: [makeGuest()],
    unseatedReserves: [{ id: "reserve-1", initials: "Рз", label: "Резерв 1" }],
  });
  const serialized = JSON.stringify(model);

  assertEqual(model.unseated.length, 2, "guest + reserve shown");
  assert(!serialized.includes("secret@example.test"), "email is not present");
  assert(!serialized.includes("+79990000000"), "phone is not present");
  assert(
    model.unseated.some((item) => item.type === "reserve" && item.displayName === "Резерв 1"),
    "unseated reserve is labelled",
  );
});

console.log(
  `\nSeating print tests: ${passed} passed, ${failures.length} failed`,
);
if (failures.length) {
  throw new Error(`${failures.length} seating print test(s) failed`);
}
