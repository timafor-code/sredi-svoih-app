#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const Module = require('node:module');
const ts = require('typescript');

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const nativeStubState = {
  requestedRandomByteCount: null,
  secureStoreWrites: [],
};

registerNativeModuleStubs();
registerTypeScriptRequireHook();

const {
  createSqlCipherKeyPragma,
  generateAndStoreDatabaseKey,
  normalizeDatabaseKey,
} = require(path.join(repoRoot, 'src/local-data/keyStore.ts'));
const {
  decideLocalDatabaseBootstrap,
  isSqlCipherRuntimeAvailable,
} = require(path.join(repoRoot, 'src/local-data/types.ts'));
const {
  runLocalMigrations,
  validateAndSortMigrations,
} = require(path.join(repoRoot, 'src/local-data/migrations/runner.ts'));

await validateKeyMaterial();
validateRecoveryDecisions();
validateSqlCipherRuntimeDecision();
await validateMigrations();

console.log('Local data foundation validation passed');

async function validateKeyMaterial() {
  const validKey = 'ab'.repeat(32);
  const upperCaseKey = validKey.toUpperCase();

  assertEqual(normalizeDatabaseKey(validKey), validKey, 'valid key accepted');
  assertEqual(normalizeDatabaseKey(upperCaseKey), validKey, 'key normalized to lowercase');
  assertEqual(normalizeDatabaseKey('ab'.repeat(31)), null, 'wrong key length rejected');
  assertEqual(normalizeDatabaseKey(`${'ab'.repeat(31)}zz`), null, 'non-hex key rejected');

  const pragma = createSqlCipherKeyPragma(validKey);
  assertEqual(
    /^PRAGMA key = "x'[0-9a-f]{64}'"$/.test(pragma),
    true,
    'raw SQLCipher key format',
  );

  const arbitraryText = `not-hex-'";SELECT sensitive_value`;
  let malformedKeyError = null;

  try {
    createSqlCipherKeyPragma(arbitraryText);
  } catch (error) {
    malformedKeyError = error;
  }

  assertEqual(
    malformedKeyError instanceof Error,
    true,
    'arbitrary key material rejected before PRAGMA construction',
  );
  assertEqual(
    String(malformedKeyError).includes(arbitraryText),
    false,
    'malformed key omitted from validation errors',
  );

  const generatedKey = await generateAndStoreDatabaseKey();
  assertEqual(generatedKey.status, 'stored', 'generated key persisted');
  assertEqual(nativeStubState.requestedRandomByteCount, 32, 'exact random byte count');
  assertEqual(nativeStubState.secureStoreWrites.length, 1, 'key stored once');
  assertEqual(
    /^[0-9a-f]{64}$/.test(nativeStubState.secureStoreWrites[0].value),
    true,
    'stored key normalized as 64-character hex',
  );
  assertEqual(
    nativeStubState.secureStoreWrites[0].options.keychainAccessible,
    1,
    'device-only keychain accessibility',
  );
  assertEqual(
    nativeStubState.secureStoreWrites[0].options.requireAuthentication,
    false,
    'database key does not require biometric authentication',
  );
}

function validateRecoveryDecisions() {
  const cases = [
    [false, 'missing', 'create_new_database', 'no database and no key'],
    [false, 'valid', 'reuse_key_for_new_database', 'no database and valid key'],
    [true, 'valid', 'open_existing_database', 'database and valid key'],
    [true, 'missing', 'missing_key_for_existing_database', 'database and missing key'],
    [true, 'invalid', 'missing_key_for_existing_database', 'database and malformed key'],
    [true, 'unavailable', 'secure_store_unavailable', 'database and unavailable key store'],
  ];

  for (const [databaseExists, keyState, expected, description] of cases) {
    assertEqual(
      decideLocalDatabaseBootstrap(databaseExists, keyState),
      expected,
      description,
    );
  }
}

function validateSqlCipherRuntimeDecision() {
  const cases = [
    [{ cipher_version: '4.6.1 community' }, true, 'non-empty SQLCipher version'],
    [{ cipher_version: '' }, false, 'empty SQLCipher version'],
    [{ cipher_version: '   \t' }, false, 'whitespace-only SQLCipher version'],
    [{ cipher_version: null }, false, 'null SQLCipher version'],
    [{ cipher_version: undefined }, false, 'undefined SQLCipher version'],
    [{}, false, 'missing cipher_version field'],
    [null, false, 'missing PRAGMA result'],
    [undefined, false, 'undefined PRAGMA result'],
  ];

  for (const [result, expected, description] of cases) {
    assertEqual(isSqlCipherRuntimeAvailable(result), expected, description);
  }
}

async function validateMigrations() {
  const orderedCalls = [];
  const orderingDatabase = createFakeMigrationDatabase();
  const unorderedMigrations = [3, 1, 2].map((version) => ({
    version,
    async up() {
      orderedCalls.push(version);
    },
  }));

  await runLocalMigrations(orderingDatabase, unorderedMigrations, fixedNow);
  assertDeepEqual(orderedCalls, [1, 2, 3], 'migrations execute in ascending order');

  assertThrows(
    () => validateAndSortMigrations([
      { version: 1, async up() {} },
      { version: 1, async up() {} },
    ]),
    'duplicate migration versions rejected',
  );

  const applicationCounts = new Map();
  const reusableDatabase = createFakeMigrationDatabase([1]);
  const reusableMigrations = [1, 2].map((version) => ({
    version,
    async up() {
      applicationCounts.set(version, (applicationCounts.get(version) ?? 0) + 1);
    },
  }));

  await runLocalMigrations(reusableDatabase, reusableMigrations, fixedNow);
  await runLocalMigrations(reusableDatabase, reusableMigrations, fixedNow);
  assertEqual(applicationCounts.get(1) ?? 0, 0, 'previously applied migration skipped');
  assertEqual(applicationCounts.get(2), 1, 'pending migration applied once');
  assertEqual(reusableDatabase.finalizedStatementCount, 1, 'prepared statement finalized');

  const failingDatabase = createFakeMigrationDatabase();
  let failed = false;

  try {
    await runLocalMigrations(failingDatabase, [{
      version: 4,
      async up() {
        throw new Error('expected validation failure');
      },
    }], fixedNow);
  } catch {
    failed = true;
  }

  assertEqual(failed, true, 'failed migration reported');
  assertEqual(failingDatabase.appliedVersions.has(4), false, 'failed migration not recorded');
}

function createFakeMigrationDatabase(initialVersions = []) {
  const appliedVersions = new Set(initialVersions);
  const database = {
    appliedVersions,
    finalizedStatementCount: 0,
    async execAsync() {},
    async getAllAsync() {
      return [...appliedVersions]
        .sort((left, right) => left - right)
        .map((version) => ({ version }));
    },
    async withExclusiveTransactionAsync(task) {
      const transactionVersions = new Set(appliedVersions);
      const transaction = {
        async execAsync() {},
        async prepareAsync() {
          let finalized = false;

          return {
            async executeAsync([version]) {
              if (finalized) {
                throw new Error('statement already finalized');
              }

              transactionVersions.add(version);
            },
            async finalizeAsync() {
              finalized = true;
              database.finalizedStatementCount += 1;
            },
          };
        },
      };

      await task(transaction);
      appliedVersions.clear();
      for (const version of transactionVersions) {
        appliedVersions.add(version);
      }
    },
  };

  return database;
}

function fixedNow() {
  return '2026-08-09T00:00:00.000Z';
}

function assertEqual(actual, expected, description) {
  if (actual !== expected) {
    throw new Error(
      `Local data validation failed for ${description}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
}

function assertDeepEqual(actual, expected, description) {
  assertEqual(JSON.stringify(actual), JSON.stringify(expected), description);
}

function assertThrows(action, description) {
  let threw = false;

  try {
    action();
  } catch {
    threw = true;
  }

  assertEqual(threw, true, description);
}

function registerNativeModuleStubs() {
  const originalLoad = Module._load;

  Module._load = function loadWithNativeStubs(request, parent, isMain) {
    if (request === 'expo-crypto') {
      return {
        async getRandomBytesAsync(byteCount) {
          nativeStubState.requestedRandomByteCount = byteCount;
          return Uint8Array.from({ length: byteCount }, (_, index) => index);
        },
      };
    }

    if (request === 'expo-secure-store') {
      return {
        WHEN_UNLOCKED_THIS_DEVICE_ONLY: 1,
        async isAvailableAsync() {
          return true;
        },
        async setItemAsync(key, value, options) {
          nativeStubState.secureStoreWrites.push({ key, value, options });
        },
      };
    }

    return originalLoad.call(this, request, parent, isMain);
  };
}

function registerTypeScriptRequireHook() {
  Module._extensions['.ts'] = function compileTypeScriptModule(module, filename) {
    const source = fs.readFileSync(filename, 'utf8');
    const { outputText } = ts.transpileModule(source, {
      compilerOptions: {
        esModuleInterop: true,
        module: ts.ModuleKind.CommonJS,
        moduleResolution: ts.ModuleResolutionKind.NodeJs,
        target: ts.ScriptTarget.ES2020,
      },
      fileName: filename,
    });

    module._compile(outputText, filename);
  };
}
