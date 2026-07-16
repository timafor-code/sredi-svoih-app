import {
  retryAfterUnauthenticated,
  SingleFlightRefresh,
} from "../authRequestRecovery";

let passed = 0;
const failures: string[] = [];

async function test(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
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

async function run(): Promise<void> {
  await test("successful refresh retries the original request exactly once", async () => {
    let refreshes = 0;
    let retries = 0;
    let expired = 0;
    const result = await retryAfterUnauthenticated({
      accessToken: "expired-access",
      initial: { result: "initial-401", unauthenticated: true },
      refreshAccessToken: async () => {
        refreshes += 1;
        return "fresh-access";
      },
      request: async () => {
        retries += 1;
        return { result: "retry-success", unauthenticated: false };
      },
      onFinalUnauthenticated: () => { expired += 1; },
    });
    assertEqual(result, "retry-success");
    assertEqual(refreshes, 1);
    assertEqual(retries, 1);
    assertEqual(expired, 0);
  });

  await test("a failed refresh does not retry the original request", async () => {
    let retries = 0;
    const result = await retryAfterUnauthenticated({
      accessToken: "expired-access",
      initial: { result: "initial-401", unauthenticated: true },
      refreshAccessToken: async () => null,
      request: async () => {
        retries += 1;
        return { result: "unexpected", unauthenticated: false };
      },
      onFinalUnauthenticated: () => undefined,
    });
    assertEqual(result, "initial-401");
    assertEqual(retries, 0);
  });

  await test("a second 401 expires the session without an infinite retry loop", async () => {
    let retries = 0;
    let expired = 0;
    await retryAfterUnauthenticated({
      accessToken: "expired-access",
      initial: { result: "initial-401", unauthenticated: true },
      refreshAccessToken: async () => "fresh-access",
      request: async () => {
        retries += 1;
        return { result: "retry-401", unauthenticated: true };
      },
      onFinalUnauthenticated: () => { expired += 1; },
    });
    assertEqual(retries, 1);
    assertEqual(expired, 1);
  });

  await test("parallel requests share a single refresh", async () => {
    const coordinator = new SingleFlightRefresh<string>();
    let refreshes = 0;
    const refresh = () => coordinator.run(async () => {
      refreshes += 1;
      await Promise.resolve();
      return "fresh-access";
    });
    const values = await Promise.all([refresh(), refresh(), refresh()]);
    assertEqual(refreshes, 1);
    assertEqual(values.join(","), "fresh-access,fresh-access,fresh-access");
  });

  console.log(`Auth request recovery tests: ${passed} passed, ${failures.length} failed`);
  if (failures.length) {
    throw new Error(failures.join("\n"));
  }
}

void run();
