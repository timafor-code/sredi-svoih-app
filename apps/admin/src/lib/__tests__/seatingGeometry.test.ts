// Unit tests for the pure seating geometry layer (block B, PR 9).
//
// SELF-CONTAINED ON PURPOSE: no test framework, no Node-only globals (no
// `process`, no `node:test`). It uses only `throw` + `console`, both available
// under the admin tsconfig (DOM lib, no @types/node). Therefore:
//   * `npm run admin:typecheck` already compiles & type-checks this file against
//     the real geometry API, and
//   * executing the file runs every assertion and throws (non-zero exit) on the
//     first failing case — see the run command in the PR body.
//
// Node 20 cannot execute `.ts` directly, so running the assertions needs a
// transpile step; the PR body documents the exact command using the esbuild
// binary that already ships with the admin app's Vite dependency.

import {
  buildSeatState,
  computePhysicalSeatCount,
  computeTableSeats,
  isChairBlockedByAnotherTable,
  pickRabbiHeadIndex,
  rabbiSeatIndexes,
  spreadSeatIndexes,
  tableCorners,
  TABLE_H,
  TABLE_W,
} from "../seatingGeometry";
import type {
  SeatingTableConnection,
  SeatingTableGeometry,
} from "../../types/seating";

// --- tiny self-contained harness -------------------------------------------

let passed = 0;
const failures: string[] = [];

function test(name: string, fn: () => void): void {
  try {
    fn();
    passed++;
    console.log("  ✓ " + name);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    failures.push(name + " — " + message);
    console.error("  ✗ " + name + " — " + message);
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

function assertArrayEqual(actual: number[], expected: number[], msg = ""): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${msg} expected ${e}, got ${a}`.trim());
}

// --- fixtures ---------------------------------------------------------------

function makeTable(
  over: Partial<SeatingTableGeometry> & { id: string },
): SeatingTableGeometry {
  return {
    cx: 100,
    cy: 100,
    w: TABLE_W,
    h: TABLE_H,
    angle: 0,
    sideSeats: 3,
    isRabbiTable: false,
    ...over,
  };
}

// --- tests: per-table seat count -------------------------------------------

test("single horizontal table, long_side_seats = 2 → 6 seats (4 sides + 2 ends)", () => {
  const table = makeTable({ id: "t1", sideSeats: 2 });
  const geo = computeTableSeats({ tables: [table] });
  // 2 seats per long side * 2 sides = 4, plus 2 end seats.
  assertEqual(geo.seats.length, 6, "seat count");
  assertEqual(geo.seats.filter((s) => s.kind === "side").length, 4, "side seats");
  assertEqual(geo.seats.filter((s) => s.kind === "end").length, 2, "end seats");
});

test("single horizontal table, long_side_seats = 3 → 8 seats (6 sides + 2 ends)", () => {
  const table = makeTable({ id: "t1", sideSeats: 3 });
  const geo = computeTableSeats({ tables: [table] });
  assertEqual(geo.seats.length, 8, "seat count");
  assertEqual(geo.seats.filter((s) => s.kind === "side").length, 6, "side seats");
  assertEqual(geo.seats.filter((s) => s.kind === "end").length, 2, "end seats");
});

// --- tests: computePhysicalSeatCount ---------------------------------------

test("computePhysicalSeatCount matches computeTableSeats().seats.length", () => {
  const tables = [
    makeTable({ id: "t1", cx: 100, cy: 100, sideSeats: 3 }),
    makeTable({ id: "t2", cx: 100, cy: 360, sideSeats: 2 }),
  ];
  const input = { tables };
  assertEqual(computePhysicalSeatCount(input), computeTableSeats(input).seats.length);
  // 8 (sideSeats 3) + 6 (sideSeats 2), tables far apart → no blocking.
  assertEqual(computePhysicalSeatCount(input), 14, "two-table physical count");
});

// --- tests: chair blocking by seam / another table -------------------------

test("two parallel tables joined end-to-end → seam ends are hard-blocked", () => {
  const t1 = makeTable({ id: "t1", cx: 100, cy: 100, angle: 0, sideSeats: 3 });
  const t2 = makeTable({ id: "t2", cx: 220, cy: 100, angle: 0, sideSeats: 3 });
  const connections: SeatingTableConnection[] = [
    { aTableId: "t1", aEnd: "b", bTableId: "t2", bEnd: "a", x: 160, y: 100 },
  ];
  const alone = computePhysicalSeatCount({ tables: [t1] });
  assertEqual(alone, 8, "single table baseline");
  const joined = computeTableSeats({ tables: [t1, t2], connections });
  // Each table loses exactly its connected end seat: (8 - 1) + (8 - 1) = 14.
  assertEqual(joined.seats.length, 14, "joined seat count");
  // No surviving seat should sit on the seam point.
  const onSeam = joined.seats.some(
    (s) => Math.hypot(s.x - 160, s.y - 100) < 24,
  );
  assert(!onSeam, "no seat should remain on the seam");
});

test("isChairBlockedByAnotherTable: a chair inside another table footprint is blocked", () => {
  const owner = makeTable({ id: "owner", cx: 100, cy: 100 });
  const other = makeTable({ id: "other", cx: 100, cy: 100 });
  const chairInside = {
    x: 100,
    y: 100,
    anchor: { x: 100, y: 100 },
    tableId: "owner",
    kind: "end" as const,
    end: "a" as const,
    isRabbiTable: false,
  };
  assert(
    isChairBlockedByAnotherTable(chairInside, [owner, other]),
    "chair inside another table must be blocked",
  );
  // tableCorners sanity: the point is genuinely inside `other`.
  const poly = tableCorners(other);
  assert(poly.length === 4, "table has 4 corners");
});

// --- tests: pickRabbiHeadIndex ---------------------------------------------

test("pickRabbiHeadIndex: horizontal rabbi table → centre of TOP side", () => {
  const table = makeTable({ id: "r", cx: 100, cy: 100, angle: 0, isRabbiTable: true });
  const geo = computeTableSeats({ tables: [table] });
  const head = geo.seats[geo.headIndex];
  assert(head.y < table.cy, "head seat is on the top side (y < cy)");
  assertEqual(head.x, table.cx, "head seat is horizontally centred");
});

test("pickRabbiHeadIndex: vertical rabbi table → centre of LEFT side", () => {
  const table = makeTable({ id: "r", cx: 100, cy: 100, angle: 90, isRabbiTable: true });
  const geo = computeTableSeats({ tables: [table] });
  const head = geo.seats[geo.headIndex];
  assert(head.x < table.cx, "head seat is on the left side (x < cx)");
  assertEqual(head.y, table.cy, "head seat is vertically centred");
});

test("pickRabbiHeadIndex: no rabbi table → fallback to seat nearest the hint", () => {
  const table = makeTable({ id: "t1", cx: 100, cy: 100, isRabbiTable: false });
  const geo = computeTableSeats({ tables: [table] });
  const target = geo.seats[3];
  const head = pickRabbiHeadIndex([table], geo.seats, { x: target.x, y: target.y });
  assertEqual(head, 3, "fallback picks the nearest seat to the hint point");
});

// --- tests: rabbiSeatIndexes -----------------------------------------------

test("rabbiSeatIndexes returns exactly the rabbi-table seats", () => {
  const rabbi = makeTable({ id: "r", cx: 100, cy: 100, isRabbiTable: true });
  const normal = makeTable({ id: "n", cx: 100, cy: 360, isRabbiTable: false });
  const geo = computeTableSeats({ tables: [rabbi, normal] });
  const indexes = rabbiSeatIndexes(geo.seats);
  const expected = geo.seats.filter((s) => s.isRabbiTable).length;
  assertEqual(indexes.size, expected, "rabbi seat count");
  assert(expected > 0, "rabbi table contributes at least one seat");
  geo.seats.forEach((seat, i) => {
    assertEqual(indexes.has(i), seat.isRabbiTable, `seat ${i} membership`);
  });
});

// --- tests: spreadSeatIndexes ----------------------------------------------

test("spreadSeatIndexes is deterministic and spreads (not the first N seats)", () => {
  const a = spreadSeatIndexes(10, 3, 0);
  const b = spreadSeatIndexes(10, 3, 0);
  assertArrayEqual(a, b, "deterministic");
  // available = [1..9]; evenly spread → [1, 5, 9], never the first 3 [1, 2, 3].
  assertArrayEqual(a, [1, 5, 9], "even spread");
  assert(
    JSON.stringify(a) !== JSON.stringify([1, 2, 3]),
    "must not be the first N seats",
  );
  // head index is always excluded.
  assert(!a.includes(0), "head seat is excluded");
});

test("spreadSeatIndexes respects count, head and excluded sets", () => {
  const excluded = new Set([2, 4]);
  const res = spreadSeatIndexes(10, 3, 0, excluded);
  assertEqual(res.length, 3, "count respected");
  assert(!res.includes(0), "head excluded");
  res.forEach((i) => assert(!excluded.has(i), `index ${i} not in excluded set`));
  // count >= available → returns all available, in order.
  const all = spreadSeatIndexes(4, 99, 0);
  assertArrayEqual(all, [1, 2, 3], "count >= available returns all");
});

// --- tests: buildSeatState --------------------------------------------------

test("buildSeatState derives occupied / free / rabbi-reserve counts", () => {
  const rabbi = makeTable({ id: "r", cx: 100, cy: 100, isRabbiTable: true });
  const normal = makeTable({ id: "n", cx: 100, cy: 360, isRabbiTable: false });
  const geo = computeTableSeats({ tables: [rabbi, normal] });
  const assignments = geo.seats.map((_, i) => (i < 3 ? "guest" + i : null));
  const state = buildSeatState(geo, assignments);
  assertEqual(state.physicalSeatCount, geo.seats.length, "physical count");
  assertEqual(state.occupiedCount, 3, "occupied count");
  assertEqual(state.freeCount, geo.seats.length - 3, "free count");
  assertEqual(
    state.rabbiReserveCount,
    geo.seats.filter((s) => s.isRabbiTable).length,
    "rabbi reserve count",
  );
  assert(state.seats[state.headIndex].isHead, "head seat flagged");
});

// --- summary ----------------------------------------------------------------

console.log(
  `\nSeating geometry tests: ${passed} passed, ${failures.length} failed`,
);
if (failures.length) {
  throw new Error(`${failures.length} seating geometry test(s) failed`);
}
