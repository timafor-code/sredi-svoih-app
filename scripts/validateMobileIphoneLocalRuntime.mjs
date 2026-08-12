import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  createDockerEnvironment,
  createExpoEnvironment,
  loadMobileIphoneEnv,
  parseMobileIphoneEnv,
  resolveMobileIphoneRuntime,
  startMobileIphoneLocal,
} from './startMobileIphoneLocal.mjs';

const VALID_ACCOUNT_ENV = `
EXPO_PUBLIC_API_URL=http://192.168.50.25:8000
EXPO_PUBLIC_APP_ACCESS_MODE=account
EXPO_PUBLIC_EVENT_REGISTRATION_MODE=account
BACKEND_ONLY_SECRET=must-not-leak
EXPO_PUBLIC_UNEXPECTED_SECRET=must-not-leak
`;

function assertRejectsApiUrl(apiUrl, expectedPattern) {
  const env = parseMobileIphoneEnv(
    VALID_ACCOUNT_ENV.replace('http://192.168.50.25:8000', apiUrl),
  );

  assert.throws(() => resolveMobileIphoneRuntime(env), expectedPattern);
}

async function run() {
  const tempDirectory = await mkdtemp(path.join(tmpdir(), 'sredi-mobile-iphone-'));
  const envFilePath = path.join(tempDirectory, '.env.local');

  try {
    await writeFile(envFilePath, VALID_ACCOUNT_ENV, 'utf8');

    const accountEnv = await loadMobileIphoneEnv(envFilePath);
    assert.deepEqual(accountEnv, {
      EXPO_PUBLIC_API_URL: 'http://192.168.50.25:8000',
      EXPO_PUBLIC_APP_ACCESS_MODE: 'account',
      EXPO_PUBLIC_EVENT_REGISTRATION_MODE: 'account',
    });
    assert.equal('BACKEND_ONLY_SECRET' in accountEnv, false);
    assert.equal('EXPO_PUBLIC_UNEXPECTED_SECRET' in accountEnv, false);

    const accountRuntime = resolveMobileIphoneRuntime(accountEnv);
    assert.equal(accountRuntime.lanHost, '192.168.50.25');
    assert.equal(accountRuntime.storagePublicUrl, 'http://192.168.50.25:59000');

    const guestEnv = parseMobileIphoneEnv(`
EXPO_PUBLIC_API_URL=https://iphone-dev.lan:8443/api
EXPO_PUBLIC_APP_ACCESS_MODE=guest_only
EXPO_PUBLIC_EVENT_REGISTRATION_MODE=disabled
`);
    const guestRuntime = resolveMobileIphoneRuntime(guestEnv);
    assert.equal(guestRuntime.mobileEnv.EXPO_PUBLIC_APP_ACCESS_MODE, 'guest_only');
    assert.equal(guestRuntime.mobileEnv.EXPO_PUBLIC_EVENT_REGISTRATION_MODE, 'disabled');
    assert.equal(guestRuntime.storagePublicUrl, 'http://iphone-dev.lan:59000');

    assertRejectsApiUrl('http://localhost:8000', /LAN hostname\/IP/);
    assertRejectsApiUrl('http://127.0.0.1:8000', /LAN hostname\/IP/);
    assertRejectsApiUrl('ftp://192.168.50.25:8000', /absolute http\/https URL/);
    assertRejectsApiUrl('not-a-url', /absolute http\/https URL/);

    const staleShellEnv = {
      API_OBJECT_STORAGE_HOST_BIND: '127.0.0.1',
      API_OBJECT_STORAGE_PUBLIC_ENDPOINT_URL: 'http://127.0.0.1:59000',
      EXPO_PUBLIC_API_URL: 'http://127.0.0.1:8000',
      EXPO_PUBLIC_APP_ACCESS_MODE: 'guest_only',
      EXPO_PUBLIC_EVENT_REGISTRATION_MODE: 'disabled',
      PATH: 'test-path',
    };
    const expoEnv = createExpoEnvironment(staleShellEnv, accountRuntime);
    assert.equal(expoEnv.EXPO_PUBLIC_API_URL, 'http://192.168.50.25:8000');
    assert.equal(expoEnv.EXPO_PUBLIC_APP_ACCESS_MODE, 'account');
    assert.equal(expoEnv.EXPO_PUBLIC_EVENT_REGISTRATION_MODE, 'account');
    assert.equal(expoEnv.EXPO_NO_DOTENV, '1');
    assert.equal('API_OBJECT_STORAGE_HOST_BIND' in expoEnv, false);
    assert.equal('API_OBJECT_STORAGE_PUBLIC_ENDPOINT_URL' in expoEnv, false);
    assert.equal('BACKEND_ONLY_SECRET' in expoEnv, false);
    assert.equal('EXPO_PUBLIC_UNEXPECTED_SECRET' in expoEnv, false);

    const dockerEnv = createDockerEnvironment(staleShellEnv, accountRuntime);
    assert.equal(dockerEnv.API_OBJECT_STORAGE_HOST_BIND, '0.0.0.0');
    assert.equal(
      dockerEnv.API_OBJECT_STORAGE_PUBLIC_ENDPOINT_URL,
      'http://192.168.50.25:59000',
    );

    let childProcessCalls = 0;
    const logs = [];
    await startMobileIphoneLocal({
      args: ['--check'],
      baseEnv: staleShellEnv,
      envFilePath,
      logger: { log: (message) => logs.push(message) },
      runCommand: async () => {
        childProcessCalls += 1;
      },
    });
    assert.equal(childProcessCalls, 0);
    assert.ok(logs.some((message) => message.includes('were not started')));
  } finally {
    await rm(tempDirectory, { force: true, recursive: true });
  }

  console.log('Mobile iPhone local runtime validation passed.');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
