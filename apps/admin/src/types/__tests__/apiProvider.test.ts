import {
  ADMIN_API_PROVIDER_KEYS,
  normalizeAdminApiProvider,
} from "../api";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
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

  await test("admin provider selection occurs before the request without fallback", () => {
    const testDirectory = dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(
      resolve(testDirectory, "../../services/adminEventsService.ts"),
      "utf8",
    ).replace(/\r\n/g, "\n");
    const functionStart = source.indexOf("export async function listAdminEvents");
    const nextFunction = source.indexOf("\nexport async function", functionStart + 1);
    const listAdminEventsSource = source.slice(
      functionStart,
      nextFunction === -1 ? source.length : nextFunction,
    );

    assertEqual(
      listAdminEventsSource.includes(
        'if (isAdminApiProviderEnabled("events")) {\n    return listAdminEventsViaApi();\n  }\n\n  const supabase = requireSupabaseClient();',
      ),
      true,
      "direct admin provider branch before Supabase request",
    );
    assertEqual(
      listAdminEventsSource.includes("catch"),
      false,
      "API-error catch that could invoke Supabase",
    );
  });

  console.log(`\nAdmin API provider tests: ${passed} passed, ${failures.length} failed`);

  if (failures.length > 0) {
    throw new Error(`${failures.length} admin API provider test(s) failed`);
  }
}

void run();
