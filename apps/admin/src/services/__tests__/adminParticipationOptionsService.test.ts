import { normalizeParticipationOptionRow } from "../adminParticipationOptionsService";
import type { ParticipationOptionRow } from "../../types/participationOptions";

let passed = 0;
const failures: string[] = [];

function test(name: string, fn: () => void): void {
  try {
    fn();
    passed += 1;
  } catch (error) {
    failures.push(`${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function assertEqual(actual: unknown, expected: unknown): void {
  if (actual !== expected) {
    throw new Error(`expected ${String(expected)}, got ${String(actual)}`);
  }
}

function makeRow(overrides: Partial<ParticipationOptionRow> = {}): ParticipationOptionRow {
  return {
    id: "option-id",
    event_id: "event-id",
    title: "Весь шабат",
    description: null,
    price_amount: 1500,
    price_currency: "RUB",
    option_type: "package",
    seat_limit: null,
    allow_quantity: true,
    min_quantity: 1,
    max_quantity: 4,
    is_donation: false,
    counts_toward_capacity: true,
    group_key: null,
    conflicts_with: [],
    sort_order: 2,
    is_active: true,
    created_at: "2026-08-11T00:00:00.000Z",
    updated_at: "2026-08-11T00:00:00.000Z",
    ...overrides,
  };
}

test("keeps null and absent seat limits nullable", () => {
  assertEqual(normalizeParticipationOptionRow(makeRow()).seatLimit, null);
  assertEqual(
    normalizeParticipationOptionRow({ ...makeRow(), seat_limit: undefined }).seatLimit,
    null,
  );
});

test("keeps a positive seat limit", () => {
  assertEqual(normalizeParticipationOptionRow(makeRow({ seat_limit: 25 })).seatLimit, 25);
});

test("keeps a real zero price", () => {
  assertEqual(normalizeParticipationOptionRow(makeRow({ price_amount: 0 })).priceAmount, 0);
});

test("preserves min, max, and sort order normalization", () => {
  const option = normalizeParticipationOptionRow(
    makeRow({ min_quantity: 2, max_quantity: 8, sort_order: 5 }),
  );
  const defaults = normalizeParticipationOptionRow({
    ...makeRow(),
    min_quantity: undefined,
    max_quantity: undefined,
    sort_order: undefined,
  });

  assertEqual(option.minQuantity, 2);
  assertEqual(option.maxQuantity, 8);
  assertEqual(option.sortOrder, 5);
  assertEqual(defaults.minQuantity, 1);
  assertEqual(defaults.maxQuantity, 1);
  assertEqual(defaults.sortOrder, 0);
});

console.log(`Participation option normalization tests: ${passed} passed, ${failures.length} failed`);
if (failures.length) {
  throw new Error(failures.join("\n"));
}
