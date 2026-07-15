import {
  normalizeMobileApiProvider,
  runApiProviderOperation,
} from '../api';

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
  await test('unset provider selects Supabase', () => {
    assertEqual(normalizeMobileApiProvider(undefined), 'supabase', 'unset provider');
  });

  await test('explicit Supabase provider selects Supabase', () => {
    assertEqual(normalizeMobileApiProvider('supabase'), 'supabase', 'supabase provider');
  });

  await test('explicit API provider selects API', () => {
    assertEqual(normalizeMobileApiProvider('api'), 'api', 'api provider');
  });

  await test('unsupported provider selects Supabase safely', () => {
    assertEqual(normalizeMobileApiProvider(' API '), 'supabase', 'unsupported provider');
  });

  await test('an API failure does not invoke the Supabase operation', async () => {
    let supabaseWrites = 0;

    await runApiProviderOperation('api', {
      api: async () => {
        throw new Error('api failed');
      },
      supabase: async () => {
        supabaseWrites += 1;
        return 'legacy write';
      },
    }).catch(() => undefined);

    assertEqual(supabaseWrites, 0, 'Supabase writes after API failure');
  });

  console.log(`\nAPI provider tests: ${passed} passed, ${failures.length} failed`);

  if (failures.length > 0) {
    throw new Error(`${failures.length} API provider test(s) failed`);
  }
}

void run();
