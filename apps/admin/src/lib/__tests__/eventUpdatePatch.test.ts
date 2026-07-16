import { buildEventUpdateInput, type EventUpdateFormState } from "../eventUpdatePatch";
import type { AdminEvent, AdminEventMutationInput } from "../../types/events";

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

const baseForm: EventUpdateFormState = {
  title: "Existing event",
  eventKind: "single",
  shortDescription: "",
  description: "",
  category: "legacy_category",
  startDate: "2026-08-01",
  startTime: "10:00",
  isPermanent: false,
  endDate: "",
  endTime: "",
  timezone: "Europe/Moscow",
  locationName: "",
  address: "",
  imageUrl: "",
  status: "draft",
  visibility: "hidden",
  registrationMode: "none",
  registrationUrl: "",
  capacity: "",
};

function makeEvent(overrides: Partial<AdminEvent> = {}): AdminEvent {
  return {
    id: "event-id",
    communityId: "community-id",
    eventKind: "single",
    title: "Existing event",
    subtitle: null,
    shortDescription: null,
    description: null,
    startsAt: "2026-08-01T07:00:00.000Z",
    endsAt: null,
    isPermanent: false,
    timezone: "Europe/Moscow",
    locationName: null,
    address: null,
    imageUrl: null,
    category: "legacy_category",
    audience: null,
    visibility: "hidden",
    status: "draft",
    sourceType: "manual",
    sourceUrl: null,
    sourceExternalId: null,
    manualOverride: false,
    registrationMode: "none",
    registrationUrl: null,
    capacity: null,
    waitlistEnabled: true,
    requiresApproval: true,
    priceAmount: 500,
    priceCurrency: "RUB",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    publishedAt: null,
    ...overrides,
  };
}

function makeInput(overrides: Partial<AdminEventMutationInput> = {}): AdminEventMutationInput {
  return {
    title: "Existing event",
    eventKind: "single",
    subtitle: null,
    shortDescription: null,
    description: null,
    startsAt: "2026-08-01T07:00:00.000Z",
    endsAt: null,
    isPermanent: false,
    timezone: "Europe/Moscow",
    locationName: null,
    address: null,
    imageUrl: null,
    category: "legacy_category",
    audience: null,
    visibility: "hidden",
    status: "draft",
    registrationMode: "none",
    registrationUrl: null,
    capacity: null,
    waitlistEnabled: false,
    requiresApproval: false,
    priceAmount: null,
    priceCurrency: "RUB",
    ...overrides,
  };
}

test("legacy capacity=0 and null stay omitted when only the title changes", () => {
  for (const capacity of [0, null]) {
    const initial = { ...baseForm, capacity: "" };
    const form = { ...initial, title: "Renamed" };
    assertEqual(
      buildEventUpdateInput(makeEvent({ capacity }), initial, form, makeInput({ title: "Renamed" })),
      { title: "Renamed" },
    );
  }
});

test("clearing and setting a positive capacity are explicit PATCH changes", () => {
  const initial = { ...baseForm, capacity: "12" };
  assertEqual(
    buildEventUpdateInput(makeEvent({ capacity: 12 }), initial, { ...initial, capacity: "" }, makeInput()),
    { capacity: null },
  );
  const empty = { ...baseForm, capacity: "" };
  assertEqual(
    buildEventUpdateInput(makeEvent({ capacity: null }), empty, { ...empty, capacity: "15" }, makeInput({ capacity: 15 })),
    { capacity: 15 },
  );
});

test("hidden settings and an unchanged legacy category are never overwritten", () => {
  const initial = { ...baseForm, capacity: "" };
  const form = { ...initial, title: "Renamed" };
  const patch = buildEventUpdateInput(
    makeEvent({ capacity: 0 }),
    initial,
    form,
    makeInput({ title: "Renamed" }),
  );
  assertEqual(patch, { title: "Renamed" });
});

test("equal instants with different ISO offsets are not PATCHed", () => {
  const initial = { ...baseForm };
  const form = { ...initial, startTime: "07:00" };
  assertEqual(
    buildEventUpdateInput(
      makeEvent(),
      initial,
      form,
      makeInput({ startsAt: "2026-08-01T10:00:00+03:00" }),
    ),
    {},
  );
});

console.log(`Event update patch tests: ${passed} passed, ${failures.length} failed`);
if (failures.length) {
  throw new Error(failures.join("\n"));
}
