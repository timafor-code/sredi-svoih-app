import {
  mapApiDeviceTokenResponse,
  sanitizeExpoPushTokenErrorText,
} from '../pushToken';

let passed = 0;
const failures: string[] = [];

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function assertEqual<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${String(expected)}, got ${String(actual)}`);
  }
}

function test(name: string, fn: () => void): void {
  try {
    fn();
    passed += 1;
    console.log(`  ok ${name}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    failures.push(`${name} - ${message}`);
    console.error(`  fail ${name} - ${message}`);
  }
}

test('API token metadata maps to the public row without raw token or owner id', () => {
  const row = mapApiDeviceTokenResponse({
    app_version: '1.2.3',
    build_version: '42',
    created_at: '2026-07-15T10:00:00Z',
    device_id: 'device-1',
    environment: 'preview',
    id: 'token-id',
    is_active: true,
    last_seen_at: '2026-07-15T10:01:00Z',
    platform: 'ios',
    push_provider: 'expo',
    updated_at: '2026-07-15T10:01:00Z',
  });

  assertEqual(row.id, 'token-id', 'id');
  assertEqual(row.environment, 'preview', 'environment');
  assertEqual(row.platform, 'ios', 'platform');
  assertEqual(row.build_version, '42', 'build version');
  assertEqual('expo_push_token' in row, false, 'raw token is not mapped');
  assertEqual('user_id' in row, false, 'owner id is not mapped');
});

test('push-token error text redacts known and Expo-formatted tokens', () => {
  const knownToken = 'ExponentPushToken[known-token]';
  const message = sanitizeExpoPushTokenErrorText(
    new Error(`Failed for ${knownToken} and ExpoPushToken[other-token]`),
    knownToken,
  );

  assert(!message.includes('known-token'), 'known token must be redacted');
  assert(!message.includes('other-token'), 'pattern token must be redacted');
  assert(message.includes('[redacted push token]'), 'redaction marker is present');
});

console.log(`\nPush-token API tests: ${passed} passed, ${failures.length} failed`);

if (failures.length > 0) {
  throw new Error(`${failures.length} push-token API test(s) failed`);
}
