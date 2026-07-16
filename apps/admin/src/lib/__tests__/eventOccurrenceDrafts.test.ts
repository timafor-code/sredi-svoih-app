import {
  buildOccurrencePayloadFields,
  normalizeOccurrenceCapacityFromApi,
  normalizeOccurrenceCapacityForDraft,
} from "../eventOccurrenceDrafts";

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
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

test("legacy occurrence capacity=0 and null inherit the event limit", () => {
  assertEqual(normalizeOccurrenceCapacityForDraft(0), "");
  assertEqual(normalizeOccurrenceCapacityForDraft(null), "");
  assertEqual(normalizeOccurrenceCapacityForDraft(20), "20");
});

test("API occurrence capacity=0 is normalized to an inherited limit", () => {
  assertEqual(normalizeOccurrenceCapacityFromApi(0), null);
});

test("archiving an inherited occurrence sends archived status and null capacity", () => {
  assertEqual(
    buildOccurrencePayloadFields(normalizeOccurrenceCapacityForDraft(0), "archived"),
    { capacity: null, error: null, status: "archived" },
  );
});

test("a positive occurrence capacity remains explicit", () => {
  assertEqual(
    buildOccurrencePayloadFields("24", "active"),
    { capacity: 24, error: null, status: "active" },
  );
});

console.log(`Occurrence draft tests: ${passed} passed, ${failures.length} failed`);
if (failures.length) {
  throw new Error(failures.join("\n"));
}
