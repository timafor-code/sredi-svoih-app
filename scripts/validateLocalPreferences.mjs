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

registerNativeModuleStubs();
registerTypeScriptRequireHook();

const {
  CURRENT_PREFERENCE_SCHEMA_VERSION,
  DEVICE_LOCAL_ONLY_PREFERENCE_KEYS,
  LEGACY_SETTINGS_STORAGE_KEY,
  PREFERENCE_KEYS,
  UPSERT_LOCAL_PREFERENCE_SQL,
  assertPreferenceKey,
  createDefaultLocalPreferences,
  deserializePreferenceValue,
  isPreferenceKey,
  migrateLegacySettingsValue,
  normalizePreferenceValue,
  readLocalPreferences,
  serializePreferenceValue,
  setLocalPreference,
} = require(path.join(repoRoot, 'src/local-data/preferencesRepository.ts'));
const {
  CREATE_LOCAL_PREFERENCES_SQL,
  preferencesMigration,
} = require(path.join(repoRoot, 'src/local-data/migrations/preferences.ts'));
const { localMigrations } = require(path.join(repoRoot, 'src/local-data/migrations/index.ts'));
const {
  DEFAULT_NOTIFICATION_PREFERENCES,
} = require(path.join(repoRoot, 'src/types/profile.ts'));

validateSchemaAndAllowlist();
await validateSerialization();
await validateLegacyMigration();
validateDefaultsAndNormalization();
validatePrivacyBoundary();
validateSourceSafety();

console.log('Local preferences validation passed');

function validateSchemaAndAllowlist() {
  assertEqual(preferencesMigration.version, 2, 'preferences migration version');
  assertDeepEqual(
    localMigrations.map(({ version }) => version),
    [1, 2],
    'historical migration order',
  );

  for (const column of ['key', 'value_json', 'updated_at', 'source', 'schema_version']) {
    assertEqual(
      new RegExp(`\\b${column}\\b`).test(CREATE_LOCAL_PREFERENCES_SQL),
      true,
      `schema column ${column}`,
    );
  }

  assertEqual(
    /CREATE TABLE local_preferences\s*\(/.test(CREATE_LOCAL_PREFERENCES_SQL),
    true,
    'local preferences table name',
  );
  assertEqual(CURRENT_PREFERENCE_SCHEMA_VERSION, 1, 'preference schema version');
  assertEqual(PREFERENCE_KEYS.length, 10, 'allowlist size');

  for (const key of PREFERENCE_KEYS) {
    assertEqual(isPreferenceKey(key), true, `allowlisted key ${key}`);
    assertDoesNotThrow(() => assertPreferenceKey(key), `accepted key ${key}`);
  }

  assertEqual(isPreferenceKey('arbitraryPreference'), false, 'unknown key rejected');
  assertThrows(() => assertPreferenceKey('arbitraryPreference'), 'unknown key assertion');
  assertEqual(
    /VALUES\s*\(\?,\s*\?,\s*\?,\s*\?,\s*\?\)/.test(UPSERT_LOCAL_PREFERENCE_SQL),
    true,
    'all row values use bound parameters',
  );
  assertEqual(
    UPSERT_LOCAL_PREFERENCE_SQL.includes('arbitraryPreference'),
    false,
    'arbitrary key absent from SQL',
  );
}

async function validateSerialization() {
  assertEqual(
    deserializePreferenceValue('city', serializePreferenceValue('city', 'Москва')),
    'Москва',
    'primitive value round-trip',
  );
  assertEqual(
    deserializePreferenceValue('gpsCity', serializePreferenceValue('gpsCity', null)),
    null,
    'null value round-trip',
  );

  const notificationPreferences = {
    ...DEFAULT_NOTIFICATION_PREFERENCES,
    events: false,
    news: true,
  };
  assertDeepEqual(
    deserializePreferenceValue(
      'notificationPreferences',
      serializePreferenceValue('notificationPreferences', notificationPreferences),
    ),
    notificationPreferences,
    'notification preferences round-trip',
  );

  const customGpsLocation = {
    city: 'Тестовый город',
    latitude: 0.5,
    longitude: 1.5,
    timezone: 'Etc/UTC',
  };
  assertDeepEqual(
    deserializePreferenceValue(
      'customGpsLocation',
      serializePreferenceValue('customGpsLocation', customGpsLocation),
    ),
    customGpsLocation,
    'custom GPS location round-trip',
  );

  assertEqual(
    deserializePreferenceValue('city', '{malformed'),
    createDefaultLocalPreferences().city,
    'malformed JSON falls back safely',
  );

  const malformedRowDatabase = createFakePreferenceDatabase();
  malformedRowDatabase.rows.set('city', {
    key: 'city',
    value_json: '{malformed',
    updated_at: fixedNow(),
    source: 'local',
    schema_version: 1,
  });
  assertEqual(
    (await readLocalPreferences(malformedRowDatabase)).city,
    createDefaultLocalPreferences().city,
    'malformed stored row does not fail repository load',
  );

  const database = createFakePreferenceDatabase();
  await setLocalPreference(database, 'city', 'Казань');
  const storedCity = database.rows.get('city');

  assertEqual(storedCity.schema_version, 1, 'schema version stored');
  assertEqual(storedCity.source, 'local', 'local source stored');
  assertEqual(storedCity.value_json, JSON.stringify('Казань'), 'JSON value stored');
  assertEqual(database.preparedStatementCount, 1, 'prepared statement used');

  const unknownKeyDatabase = createFakePreferenceDatabase();
  await assertThrowsAsync(
    () => setLocalPreference(unknownKeyDatabase, 'arbitraryPreference', true),
    'unknown key rejected before SQL preparation',
  );
  assertEqual(
    unknownKeyDatabase.preparedStatementCount,
    0,
    'unknown key never reaches SQL',
  );
}

async function validateLegacyMigration() {
  const validLegacyBlob = createLegacyBlob({
    blessingDefaultDisplayMode: 'he',
    city: 'Москва',
    customGpsLocation: {
      city: 'Тестовый город',
      latitude: 10.25,
      longitude: 20.5,
      timezone: 'Etc/UTC',
    },
    gpsCity: 'Казань',
    locationPermissionStatus: 'denied',
    unrecognizedFlag: 'ignored',
    zmanimSource: 'manual',
  });

  const database = createFakePreferenceDatabase();
  let deleteCount = 0;
  const result = await migrateLegacySettingsValue({
    database,
    deleteLegacyValue: async () => {
      deleteCount += 1;
    },
    legacyValue: validLegacyBlob,
    now: fixedNow,
  });

  assertEqual(result.status, 'migrated', 'valid legacy v3 blob migrates');
  assertEqual(deleteCount, 1, 'successful migration deletes legacy key once');
  assertEqual(database.rows.size, PREFERENCE_KEYS.length, 'preferences stored as individual rows');
  assertEqual(database.rows.has('unrecognizedFlag'), false, 'unknown legacy fields ignored');
  assertEqual(
    database.rows.get('city').source,
    'legacy_secure_store',
    'legacy value source stored',
  );
  assertDeepEqual(
    await readLocalPreferences(database),
    {
      ...createDefaultLocalPreferences(),
      blessingDefaultDisplayMode: 'he',
      city: 'Москва',
      customGpsLocation: {
        city: 'Тестовый город',
        latitude: 10.25,
        longitude: 20.5,
        timezone: 'Etc/UTC',
      },
      gpsCity: 'Казань',
      locationPermissionStatus: 'denied',
      zmanimSource: 'manual',
    },
    'legacy values read back after migration',
  );

  const missingDatabase = createFakePreferenceDatabase();
  let missingDeleteCount = 0;
  const missingResult = await migrateLegacySettingsValue({
    database: missingDatabase,
    deleteLegacyValue: async () => {
      missingDeleteCount += 1;
    },
    legacyValue: null,
  });
  assertEqual(missingResult.status, 'no_legacy', 'missing legacy key is a no-op');
  assertEqual(missingDeleteCount, 0, 'missing legacy key is not deleted');
  assertEqual(missingDatabase.rows.size, 0, 'missing legacy key writes no rows');

  const malformedDatabase = createFakePreferenceDatabase();
  let malformedDeleteCount = 0;
  const malformedResult = await migrateLegacySettingsValue({
    database: malformedDatabase,
    deleteLegacyValue: async () => {
      malformedDeleteCount += 1;
    },
    legacyValue: '{malformed',
  });
  assertEqual(malformedResult.status, 'malformed_legacy', 'malformed legacy JSON rejected');
  assertEqual(malformedDeleteCount, 0, 'malformed legacy JSON retained');
  assertEqual(malformedDatabase.rows.size, 0, 'malformed legacy JSON writes no defaults');

  const compatibilityDatabase = createFakePreferenceDatabase();
  const compatibilityResult = await migrateLegacySettingsValue({
    database: compatibilityDatabase,
    deleteLegacyValue: async () => undefined,
    legacyValue: createLegacyBlob({
      city: 'Москва',
      gpsLocation: {
        city: 'Синтетический город',
        latitude: -5.5,
        longitude: 40.5,
      },
    }, 2),
  });
  assertEqual(compatibilityResult.status, 'migrated', 'older legacy blob migrates');
  const compatibilityValues = await readLocalPreferences(compatibilityDatabase);
  assertDeepEqual(
    compatibilityValues.customGpsLocation,
    {
      city: 'Синтетический город',
      latitude: -5.5,
      longitude: 40.5,
    },
    'legacy gpsLocation compatibility',
  );
  assertEqual(
    compatibilityValues.gpsCity,
    'Синтетический город',
    'legacy gpsLocation supplies missing GPS city',
  );

  const transactionFailureDatabase = createFakePreferenceDatabase({ transactionFailure: true });
  let transactionFailureDeleteCount = 0;
  const transactionFailureResult = await migrateLegacySettingsValue({
    database: transactionFailureDatabase,
    deleteLegacyValue: async () => {
      transactionFailureDeleteCount += 1;
    },
    legacyValue: validLegacyBlob,
  });
  assertEqual(transactionFailureResult.status, 'transaction_failed', 'transaction failure reported');
  assertEqual(transactionFailureDeleteCount, 0, 'transaction failure retains legacy key');
  assertEqual(transactionFailureDatabase.rows.size, 0, 'failed transaction rolls back');

  const readBackFailureDatabase = createFakePreferenceDatabase({ readBackFailure: true });
  let readBackFailureDeleteCount = 0;
  const readBackFailureResult = await migrateLegacySettingsValue({
    database: readBackFailureDatabase,
    deleteLegacyValue: async () => {
      readBackFailureDeleteCount += 1;
    },
    legacyValue: validLegacyBlob,
  });
  assertEqual(readBackFailureResult.status, 'read_back_failed', 'read-back failure reported');
  assertEqual(readBackFailureDeleteCount, 0, 'read-back failure retains legacy key');
  assertEqual(
    readBackFailureDatabase.rows.size,
    PREFERENCE_KEYS.length,
    'read-back failure preserves committed preferences',
  );

  const retryDatabase = createFakePreferenceDatabase();
  const cleanupFailureResult = await migrateLegacySettingsValue({
    database: retryDatabase,
    deleteLegacyValue: async () => {
      throw new Error('expected cleanup failure');
    },
    legacyValue: validLegacyBlob,
  });
  assertEqual(cleanupFailureResult.status, 'cleanup_failed', 'cleanup failure is retryable');
  assertEqual(
    retryDatabase.rows.size,
    PREFERENCE_KEYS.length,
    'cleanup failure preserves migrated rows',
  );

  await setLocalPreference(retryDatabase, 'city', 'Казань', 'local', fixedNow);
  let retryDeleteCount = 0;
  const retryResult = await migrateLegacySettingsValue({
    database: retryDatabase,
    deleteLegacyValue: async () => {
      retryDeleteCount += 1;
    },
    legacyValue: validLegacyBlob,
    now: fixedNow,
  });
  assertEqual(retryResult.status, 'migrated', 'cleanup retry succeeds');
  assertEqual(retryDeleteCount, 1, 'cleanup retry deletes legacy key');
  assertEqual(
    (await readLocalPreferences(retryDatabase)).city,
    'Казань',
    'retry does not overwrite newer local value',
  );

  const existingDatabase = createFakePreferenceDatabase();
  await setLocalPreference(existingDatabase, 'city', 'Самара', 'local', fixedNow);
  const existingResult = await migrateLegacySettingsValue({
    database: existingDatabase,
    deleteLegacyValue: async () => undefined,
    legacyValue: validLegacyBlob,
    now: fixedNow,
  });
  assertEqual(existingResult.status, 'migrated', 'legacy fills around existing local values');
  assertEqual(
    (await readLocalPreferences(existingDatabase)).city,
    'Самара',
    'existing local value beats legacy value',
  );
}

function validateDefaultsAndNormalization() {
  const defaults = createDefaultLocalPreferences();

  assertEqual(
    normalizePreferenceValue('city', 'Недоступный город'),
    defaults.city,
    'invalid city falls back safely',
  );
  assertEqual(
    normalizePreferenceValue('zmanimSource', 'automatic'),
    'gps',
    'invalid zmanim source falls back safely',
  );
  assertEqual(
    normalizePreferenceValue('locationPermissionStatus', 'prompt'),
    'unknown',
    'invalid permission status falls back safely',
  );
  assertEqual(
    normalizePreferenceValue('blessingDefaultDisplayMode', 'latin'),
    'ru',
    'invalid blessing mode falls back safely',
  );
  assertEqual(
    normalizePreferenceValue('nusach', 'unrecognized'),
    'common',
    'invalid nusach resolves to canonical default',
  );
  assertDeepEqual(
    normalizePreferenceValue('notificationPreferences', 'malformed'),
    DEFAULT_NOTIFICATION_PREFERENCES,
    'malformed notification preferences resolve safely',
  );
  assertEqual(defaults.prayerStorageMode, 'local_only', 'prayer storage default');
  assertEqual(defaults.lastAccountSyncDecision, null, 'account sync decision default');
}

function validatePrivacyBoundary() {
  assertDeepEqual(
    DEVICE_LOCAL_ONLY_PREFERENCE_KEYS,
    ['customGpsLocation', 'locationPermissionStatus'],
    'strict device-local privacy classification',
  );
  assertEqual(
    DEVICE_LOCAL_ONLY_PREFERENCE_KEYS.includes('notificationPreferences'),
    false,
    'privacy classification remains focused',
  );
}

function validateSourceSafety() {
  const repositorySource = fs.readFileSync(
    path.join(repoRoot, 'src/local-data/preferencesRepository.ts'),
    'utf8',
  );
  const settingsStoreSource = fs.readFileSync(
    path.join(repoRoot, 'src/store/useSettingsStore.ts'),
    'utf8',
  );

  assertEqual(
    repositorySource.includes("SecureStore.setItemAsync"),
    false,
    'native preferences are not written back to legacy SecureStore',
  );
  assertEqual(
    repositorySource.includes("console."),
    false,
    'repository does not log preference payloads',
  );
  assertEqual(
    settingsStoreSource.includes("console."),
    false,
    'settings store does not log preference payloads',
  );
  assertEqual(
    repositorySource.includes(LEGACY_SETTINGS_STORAGE_KEY),
    true,
    'legacy settings key remains explicit',
  );
  assertEqual(
    repositorySource.includes('sredi-svoih.localDatabaseKey.v1'),
    false,
    'preferences repository does not touch database key storage',
  );
}

function createLegacyBlob(state, version = 3) {
  return JSON.stringify({ state, version });
}

function createFakePreferenceDatabase(options = {}) {
  const rows = new Map();
  const database = {
    rows,
    preparedStatementCount: 0,
    async getAllAsync() {
      if (options.readBackFailure) {
        throw new Error('expected read-back failure');
      }

      return cloneRows(rows);
    },
    async prepareAsync(sql) {
      database.preparedStatementCount += 1;
      return createFakeStatement(sql, rows, options);
    },
    async withExclusiveTransactionAsync(task) {
      const transactionRows = new Map(
        [...rows].map(([key, row]) => [key, { ...row }]),
      );
      const transaction = {
        async getAllAsync() {
          return cloneRows(transactionRows);
        },
        async prepareAsync(sql) {
          database.preparedStatementCount += 1;
          return createFakeStatement(sql, transactionRows, options);
        },
      };

      await task(transaction);
      rows.clear();
      for (const [key, row] of transactionRows) {
        rows.set(key, row);
      }
    },
  };

  return database;
}

function createFakeStatement(sql, rows, options) {
  let finalized = false;

  return {
    async executeAsync(parameters) {
      if (finalized) {
        throw new Error('statement already finalized');
      }

      if (options.transactionFailure) {
        throw new Error('expected transaction failure');
      }

      if (/INSERT INTO local_preferences/.test(sql)) {
        const [key, valueJson, updatedAt, source, schemaVersion] = parameters;
        rows.set(key, {
          key,
          value_json: valueJson,
          updated_at: updatedAt,
          source,
          schema_version: schemaVersion,
        });
        return;
      }

      if (/DELETE FROM local_preferences/.test(sql)) {
        rows.delete(parameters[0]);
        return;
      }

      throw new Error('unexpected SQL in local preference validator');
    },
    async finalizeAsync() {
      finalized = true;
    },
  };
}

function cloneRows(rows) {
  return [...rows.values()].map((row) => ({ ...row }));
}

function fixedNow() {
  return '2026-08-09T00:00:00.000Z';
}

function assertEqual(actual, expected, description) {
  if (actual !== expected) {
    throw new Error(
      `Local preferences validation failed for ${description}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
}

function assertDeepEqual(actual, expected, description) {
  assertEqual(JSON.stringify(actual), JSON.stringify(expected), description);
}

function assertDoesNotThrow(action, description) {
  try {
    action();
  } catch (error) {
    throw new Error(`Local preferences validation failed for ${description}: ${String(error)}`);
  }
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

async function assertThrowsAsync(action, description) {
  let threw = false;

  try {
    await action();
  } catch {
    threw = true;
  }

  assertEqual(threw, true, description);
}

function registerNativeModuleStubs() {
  const originalLoad = Module._load;

  Module._load = function loadWithNativeStubs(request, parent, isMain) {
    if (request === 'expo-secure-store') {
      return {
        async deleteItemAsync() {},
        async getItemAsync() {
          return null;
        },
        async isAvailableAsync() {
          return true;
        },
      };
    }

    if (request === 'expo-file-system') {
      return {
        File: class FakeFile {
          exists = false;
        },
      };
    }

    if (request === 'expo-sqlite') {
      return {
        defaultDatabaseDirectory: '',
        async openDatabaseAsync() {
          throw new Error('native database is not opened by this validator');
        },
      };
    }

    if (request === 'expo-crypto') {
      return {
        async getRandomBytesAsync() {
          return new Uint8Array(32);
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
