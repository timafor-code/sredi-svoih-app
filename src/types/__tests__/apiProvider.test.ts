import {
  MOBILE_API_PROVIDER_KEYS,
  normalizeMobileApiProvider,
  runApiProviderOperation,
} from '../api';
import type { MobileApiProviderKey } from '../api';

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
  await test('unset provider selects API', () => {
    assertEqual(normalizeMobileApiProvider(undefined), 'api', 'unset provider');
  });

  await test('empty provider selects API', () => {
    assertEqual(normalizeMobileApiProvider(''), 'api', 'empty provider');
  });

  await test('explicit Supabase provider selects Supabase', () => {
    assertEqual(normalizeMobileApiProvider(' SuPaBaSe '), 'supabase', 'supabase provider');
  });

  await test('explicit API provider selects API', () => {
    assertEqual(normalizeMobileApiProvider('api'), 'api', 'api provider');
  });

  await test('unsupported provider selects API safely', () => {
    assertEqual(normalizeMobileApiProvider('backend'), 'api', 'unsupported provider');
  });

  await test('all PR 37 mobile provider variables default to API', () => {
    const providerVariables: Record<MobileApiProviderKey, string> = {
      auth: 'EXPO_PUBLIC_AUTH_PROVIDER',
      events: 'EXPO_PUBLIC_EVENTS_PROVIDER',
      registrations: 'EXPO_PUBLIC_REGISTRATIONS_PROVIDER',
      prayer: 'EXPO_PUBLIC_PRAYER_PROVIDER',
      contacts: 'EXPO_PUBLIC_CONTACTS_PROVIDER',
      avatar: 'EXPO_PUBLIC_AVATAR_PROVIDER',
      privacy: 'EXPO_PUBLIC_PRIVACY_PROVIDER',
      device: 'EXPO_PUBLIC_DEVICE_PROVIDER',
    };

    MOBILE_API_PROVIDER_KEYS.forEach((provider) => {
      assertEqual(
        normalizeMobileApiProvider(undefined),
        'api',
        `${providerVariables[provider]} unset provider`,
      );
    });
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

  await test('explicit Supabase selection does not invoke the API operation', async () => {
    let apiWrites = 0;

    await runApiProviderOperation('supabase', {
      api: async () => {
        apiWrites += 1;
        return 'api write';
      },
      supabase: async () => 'legacy write',
    });

    assertEqual(apiWrites, 0, 'API writes after explicit Supabase selection');
  });

  console.log(`\nAPI provider tests: ${passed} passed, ${failures.length} failed`);

  if (failures.length > 0) {
    throw new Error(`${failures.length} API provider test(s) failed`);
  }
}

void run();
