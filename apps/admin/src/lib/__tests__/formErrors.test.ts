import {
  clearFormErrors,
  firstActiveFormErrorKey,
} from "../formErrors";

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

type EventFormErrorKey = "title" | "capacity" | "form";

test("an empty title creates a visible validation warning", () => {
  assertEqual(
    firstActiveFormErrorKey<EventFormErrorKey>(
      { title: "Укажите название события." },
      ["form"],
    ),
    "title",
  );
});

test("correcting the title removes its warning immediately", () => {
  const errors = clearFormErrors<EventFormErrorKey>(
    { title: "Укажите название события." },
    ["title", "form"],
  );
  assertEqual(firstActiveFormErrorKey(errors, ["form"]), null);
});

test("undefined error keys are not active validation errors", () => {
  assertEqual(
    firstActiveFormErrorKey<EventFormErrorKey>({ title: undefined }, ["form"]),
    null,
  );
});

test("the next real error is selected after a cleared title error", () => {
  assertEqual(
    firstActiveFormErrorKey<EventFormErrorKey>(
      { title: undefined, capacity: "Лимит должен быть положительным." },
      ["form"],
    ),
    "capacity",
  );
});

console.log(`Form error tests: ${passed} passed, ${failures.length} failed`);
if (failures.length) {
  throw new Error(failures.join("\n"));
}
