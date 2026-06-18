import { computeSeatingCapacitySummary } from "../seatingCapacity";

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

function assertEqual<T>(actual: T, expected: T, msg = ""): void {
  if (actual !== expected) {
    throw new Error(`${msg} expected ${String(expected)}, got ${String(actual)}`.trim());
  }
}

// limit 70 / physical 80 / occupied 55 / reserves 0
// → spare physical seats above the limit, nothing missing.
test("limit 70, physical 80, occupied 55: overflow + free seats", () => {
  const summary = computeSeatingCapacitySummary({
    physicalSeatCount: 80,
    capacityLimit: 70,
    occupiedSeats: 55,
  });

  assertEqual(summary.physicalSeatCount, 80, "physical");
  assertEqual(summary.capacityLimit, 70, "limit");
  assertEqual(summary.occupiedSeats, 55, "occupied");
  assertEqual(summary.reserveSeats, 0, "reserves default 0");
  assertEqual(summary.freeByLimit, 15, "70 - 55");
  assertEqual(summary.freePhysical, 25, "80 - 55 - 0");
  assertEqual(summary.missingPhysical, 0, "no shortage");
  assertEqual(summary.physicalOverflow, 10, "80 - 70");
});

// limit 70 / physical 60 / occupied 68 / reserves 0
// → operational shortage: more guests than chairs.
test("limit 70, physical 60, occupied 68: missing physical seats", () => {
  const summary = computeSeatingCapacitySummary({
    physicalSeatCount: 60,
    capacityLimit: 70,
    occupiedSeats: 68,
  });

  assertEqual(summary.freeByLimit, 2, "70 - 68");
  assertEqual(summary.freePhysical, 0, "clamped, not negative");
  assertEqual(summary.missingPhysical, 8, "68 - 60");
  assertEqual(summary.physicalOverflow, 0, "physical < limit");
});

// capacityLimit null → "без лимита": freeByLimit null, no overflow, no NaN.
test("capacityLimit null: free-by-limit is null, overflow is 0", () => {
  const summary = computeSeatingCapacitySummary({
    physicalSeatCount: 80,
    capacityLimit: null,
    occupiedSeats: 55,
  });

  assertEqual(summary.freeByLimit, null, "no limit → null, not a number");
  assertEqual(summary.physicalOverflow, 0, "nothing to overflow without a limit");
  assertEqual(summary.missingPhysical, 0, "80 >= 55, computed as usual");
  assertEqual(summary.freePhysical, 25, "80 - 55 - 0");
  // Guard against NaN leaking through any of the numeric fields.
  assertEqual(Number.isNaN(summary.freePhysical), false, "freePhysical not NaN");
  assertEqual(Number.isNaN(summary.missingPhysical), false, "missingPhysical not NaN");
  assertEqual(Number.isNaN(summary.physicalOverflow), false, "overflow not NaN");
});

// Reserves take physical seats but are NOT registration occupancy.
test("reserves reduce freePhysical but not occupiedSeats", () => {
  const base = computeSeatingCapacitySummary({
    physicalSeatCount: 80,
    capacityLimit: 70,
    occupiedSeats: 55,
    reserveSeats: 0,
  });
  const withReserves = computeSeatingCapacitySummary({
    physicalSeatCount: 80,
    capacityLimit: 70,
    occupiedSeats: 55,
    reserveSeats: 5,
  });

  assertEqual(withReserves.occupiedSeats, base.occupiedSeats, "occupied unchanged by reserves");
  assertEqual(withReserves.freeByLimit, base.freeByLimit, "limit math ignores reserves");
  assertEqual(withReserves.freePhysical, 20, "80 - 55 - 5");
  assertEqual(base.freePhysical, 25, "80 - 55 - 0");
  assertEqual(withReserves.reserveSeats, 5, "reserves reported");
  // Reserves do feed the physical shortage check.
  const tight = computeSeatingCapacitySummary({
    physicalSeatCount: 60,
    capacityLimit: 70,
    occupiedSeats: 58,
    reserveSeats: 5,
  });
  assertEqual(tight.missingPhysical, 3, "58 + 5 - 60");
});

// physicalOverflow must stay 0 with a null limit even when physical > occupied.
test("physicalOverflow is not computed against a null limit", () => {
  const summary = computeSeatingCapacitySummary({
    physicalSeatCount: 120,
    capacityLimit: null,
    occupiedSeats: 10,
    reserveSeats: 2,
  });

  assertEqual(summary.physicalOverflow, 0, "no limit → no overflow");
  assertEqual(summary.freeByLimit, null, "no limit → null");
  assertEqual(summary.freePhysical, 108, "120 - 10 - 2");
});

// Defensive: bad/NaN-ish inputs never leak NaN or negatives.
test("non-finite and negative inputs are sanitised", () => {
  const summary = computeSeatingCapacitySummary({
    physicalSeatCount: Number.NaN,
    capacityLimit: Number.NaN,
    occupiedSeats: -5,
    reserveSeats: Number.POSITIVE_INFINITY,
  });

  assertEqual(summary.physicalSeatCount, 0, "NaN physical → 0");
  assertEqual(summary.capacityLimit, null, "NaN limit → null");
  assertEqual(summary.occupiedSeats, 0, "negative occupied → 0");
  assertEqual(summary.reserveSeats, 0, "infinite reserves → 0");
  assertEqual(summary.freeByLimit, null, "no limit → null");
  assertEqual(summary.freePhysical, 0, "0 - 0 - 0");
  assertEqual(summary.missingPhysical, 0, "0 needed");
  assertEqual(summary.physicalOverflow, 0, "no limit");
});

// A zero or non-positive limit is "без лимита", not a real limit of 0.
test("non-positive limit collapses to no-limit", () => {
  const summary = computeSeatingCapacitySummary({
    physicalSeatCount: 40,
    capacityLimit: 0,
    occupiedSeats: 10,
  });

  assertEqual(summary.capacityLimit, null, "0 limit → null");
  assertEqual(summary.freeByLimit, null, "no limit → null");
  assertEqual(summary.physicalOverflow, 0, "no overflow");
});

console.log(`\nSeating capacity tests: ${passed} passed, ${failures.length} failed`);
if (failures.length) {
  throw new Error(`${failures.length} seating capacity test(s) failed`);
}
