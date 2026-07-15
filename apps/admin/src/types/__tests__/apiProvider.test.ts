import {
  ADMIN_API_PROVIDER_KEYS,
  normalizeAdminApiProvider,
} from "../api";
import { runApiProviderOperation } from "../../../../../src/types/api";
import type { AdminApiProviderKey } from "../api";

let passed = 0;
const failures: string[] = [];

function assertEqual<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${String(expected)}, got ${String(actual)}`);
  }
}

async function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
    passed += 1;
    console.log(`  ok ${name}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    failures.push(`${name} - ${message}`);
    console.error(`  fail ${name} - ${message}`);
  }
}

async function run(): Promise<void> {
  await test("unset provider selects API", () => {
    assertEqual(normalizeAdminApiProvider(undefined), "api", "unset provider");
  });

  await test("empty provider selects API", () => {
    assertEqual(normalizeAdminApiProvider(""), "api", "empty provider");
  });

  await test("unsupported provider selects API", () => {
    assertEqual(normalizeAdminApiProvider("backend"), "api", "unsupported provider");
  });

  await test("explicit API provider selects API", () => {
    assertEqual(normalizeAdminApiProvider("api"), "api", "api provider");
  });

  await test("explicit Supabase provider selects Supabase", () => {
    assertEqual(normalizeAdminApiProvider(" SuPaBaSe "), "supabase", "supabase provider");
  });

  await test("all PR 37 admin provider variables default to API", () => {
    const providerVariables: Record<AdminApiProviderKey, string> = {
      auth: "VITE_AUTH_PROVIDER",
      events: "VITE_ADMIN_EVENTS_PROVIDER",
      registrations: "VITE_ADMIN_REGISTRATIONS_PROVIDER",
      members: "VITE_ADMIN_MEMBERS_PROVIDER",
      invites: "VITE_ADMIN_INVITES_PROVIDER",
      seating: "VITE_ADMIN_SEATING_PROVIDER",
      import: "VITE_ADMIN_IMPORT_PROVIDER",
      feedback: "VITE_ADMIN_FEEDBACK_PROVIDER",
      community: "VITE_ADMIN_COMMUNITY_PROVIDER",
    };

    ADMIN_API_PROVIDER_KEYS.forEach((provider) => {
      assertEqual(
        normalizeAdminApiProvider(undefined),
        "api",
        `${providerVariables[provider]} unset provider`,
      );
    });
  });

  await test("an API failure does not invoke the Supabase operation", async () => {
    let supabaseWrites = 0;

    await runApiProviderOperation(normalizeAdminApiProvider("api"), {
      api: async () => {
        throw new Error("api failed");
      },
      supabase: async () => {
        supabaseWrites += 1;
        return "legacy write";
      },
    }).catch(() => undefined);

    assertEqual(supabaseWrites, 0, "Supabase writes after API failure");
  });

  console.log(`\nAdmin API provider tests: ${passed} passed, ${failures.length} failed`);

  if (failures.length > 0) {
    throw new Error(`${failures.length} admin API provider test(s) failed`);
  }
}

void run();
