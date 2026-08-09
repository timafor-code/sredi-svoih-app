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

const localFixture = {
  localId: '10000000-0000-4000-8000-000000000001',
  ownerScope: 'guest',
  activityType: 'shacharit',
  activityDate: '2026-08-09',
  startedAt: '2026-08-09T03:00:00.000Z',
  completedAt: '2026-08-09T03:30:00.000Z',
  timezone: 'Europe/Moscow',
  city: 'Synthetic City',
  hebrewDate: { day: 25, month: 'Av', year: 5786 },
  metadata: { source: 'synthetic' },
  createdAt: '2026-08-09T03:00:00.000Z',
  updatedAt: '2026-08-09T03:30:00.000Z',
  syncState: 'local_only',
  syncedUserId: null,
  serverId: null,
  lastSyncErrorCode: null,
};

const apiFixture = {
  id: '20000000-0000-4000-8000-000000000002',
  userId: '30000000-0000-4000-8000-000000000003',
  activityType: 'omer_count',
  activityDate: '2026-08-09',
  startedAt: null,
  completedAt: '2026-08-09T18:30:00.000Z',
  timezone: 'Europe/Moscow',
  city: null,
  hebrewDate: { day: 25, month: 'Av', year: 5786 },
  metadata: { count: 39 },
  createdAt: '2026-08-09T18:30:00.000Z',
  updatedAt: '2026-08-09T18:30:00.000Z',
};

let activeProductionDependencySpies;

registerProductionDependencyStubs();
registerTypeScriptRequireHook();
registerSourceAliasResolver();

const {
  hasRecordedActivity,
} = require(path.join(repoRoot, 'src/lib/prayerTracker.ts'));

const mappedActivities = await validateCanonicalSelectionAndIsolation();
validateMapping(mappedActivities);
validateUtilityCompatibility();
validateStoreAndPrivacySourceBoundaries();

console.log('Prayer tracker provider selection validation passed');

async function validateCanonicalSelectionAndIsolation() {
  const capabilityCases = [
    [undefined, 'local'],
    ['invalid', 'local'],
    ['guest_only', 'local'],
    ['account', 'api'],
  ];

  for (const [value, expectedProvider] of capabilityCases) {
    const spies = createProductionDependencySpies();
    const service = loadServiceForMode(value, spies);

    await service.loadMyPrayerActivity();

    assertEqual(spies.calls.localLoad, expectedProvider === 'local' ? 1 : 0, `${String(value)} local selection`);
    assertEqual(spies.calls.apiLoad, expectedProvider === 'api' ? 1 : 0, `${String(value)} API selection`);
  }

  const guestSpies = createProductionDependencySpies();
  const guestService = loadServiceForMode('guest_only', guestSpies);
  const loadParams = { fromDate: '2026-08-09', toDate: '2026-08-09', limit: 20 };
  const recordInput = {
    activityType: 'shacharit',
    activityDate: '2026-08-09',
    completedAt: '2026-08-09T03:30:00.000Z',
  };

  const mappedLocalItems = await guestService.loadMyPrayerActivity(loadParams);
  await guestService.recordPrayerActivity(recordInput);

  assertEqual(guestSpies.calls.localLoad, 1, 'guest local load count');
  assertEqual(guestSpies.calls.apiLoad, 0, 'guest API load isolation');
  assertEqual(guestSpies.calls.localRecord, 1, 'guest local record count');
  assertEqual(guestSpies.calls.apiRecord, 0, 'guest API record isolation');
  assertDeepEqual(guestSpies.inputs.localLoad, [loadParams], 'guest load parameters');
  assertDeepEqual(guestSpies.inputs.localRecord, [recordInput], 'guest record input');

  const failingGuestSpies = createProductionDependencySpies({ localFailure: true });
  const failingGuestService = loadServiceForMode(undefined, failingGuestSpies);

  await assertRejects(
    () => failingGuestService.loadMyPrayerActivity(),
    'guest local load failure',
  );
  await assertRejects(
    () => failingGuestService.recordPrayerActivity(recordInput),
    'guest local record failure',
  );
  assertEqual(failingGuestSpies.calls.apiLoad, 0, 'failed guest load has no API fallback');
  assertEqual(failingGuestSpies.calls.apiRecord, 0, 'failed guest record has no API fallback');

  const accountSpies = createProductionDependencySpies();
  const accountService = loadServiceForMode('account', accountSpies);

  const mappedApiItems = await accountService.loadMyPrayerActivity(loadParams);
  await accountService.recordPrayerActivity(recordInput);

  assertEqual(accountSpies.calls.apiLoad, 1, 'account API load count');
  assertEqual(accountSpies.calls.localLoad, 0, 'account local load isolation');
  assertEqual(accountSpies.calls.apiRecord, 1, 'account API record count');
  assertEqual(accountSpies.calls.localRecord, 0, 'account local record isolation');

  return {
    mappedApi: mappedApiItems[0],
    mappedLocal: mappedLocalItems[0],
  };
}

function validateMapping({ mappedApi, mappedLocal }) {
  const commonLocalFields = {
    id: localFixture.localId,
    userId: null,
    activityType: localFixture.activityType,
    activityDate: localFixture.activityDate,
    startedAt: localFixture.startedAt,
    completedAt: localFixture.completedAt,
    timezone: localFixture.timezone,
    city: localFixture.city,
    hebrewDate: localFixture.hebrewDate,
    metadata: localFixture.metadata,
    createdAt: localFixture.createdAt,
    updatedAt: localFixture.updatedAt,
  };

  assertDeepEqual(mappedLocal, commonLocalFields, 'local provider mapping');
  assertDeepEqual(mappedApi, apiFixture, 'API provider mapping');
  assertDeepEqual(
    Object.keys(mappedLocal).sort(),
    Object.keys(apiFixture).sort(),
    'local mapping excludes repository-only fields',
  );
}

function validateUtilityCompatibility() {
  const guestItem = {
    id: localFixture.localId,
    userId: null,
    activityType: localFixture.activityType,
    activityDate: localFixture.activityDate,
    startedAt: localFixture.startedAt,
    completedAt: localFixture.completedAt,
    timezone: localFixture.timezone,
    city: localFixture.city,
    hebrewDate: localFixture.hebrewDate,
    metadata: localFixture.metadata,
    createdAt: localFixture.createdAt,
    updatedAt: localFixture.updatedAt,
  };
  const accountItem = { ...apiFixture };

  assertEqual(
    hasRecordedActivity([guestItem], 'shacharit', '2026-08-09'),
    true,
    'guest item without user filter',
  );
  assertEqual(
    hasRecordedActivity([accountItem], 'omer_count', '2026-08-09', apiFixture.userId),
    true,
    'account item with matching user filter',
  );
  assertEqual(
    hasRecordedActivity(
      [accountItem],
      'omer_count',
      '2026-08-09',
      '40000000-0000-4000-8000-000000000004',
    ),
    false,
    'account item with non-matching user filter',
  );
  assertEqual(
    hasRecordedActivity([accountItem], 'shacharit', '2026-08-09'),
    false,
    'activity type remains part of the identity',
  );
  assertEqual(
    hasRecordedActivity([accountItem], 'omer_count', '2026-08-08'),
    false,
    'activity date remains part of the identity',
  );
}

function validateStoreAndPrivacySourceBoundaries() {
  const serviceSource = readSource('src/services/prayerTrackerService.ts');
  const storeSource = readSource('src/store/usePrayerTrackerStore.ts');
  const typesSource = readSource('src/types/prayerTracker.ts');

  for (const forbiddenImport of [
    'prayerRepository',
    'prayerTrackerApiService',
    'apiClient',
    'useAuthStore',
  ]) {
    assertEqual(
      storeSource.includes(forbiddenImport),
      false,
      `store excludes ${forbiddenImport}`,
    );
  }

  assertIncludes(storeSource, "from '@/services/prayerTrackerService'", 'store service boundary');
  assertIncludes(storeSource, 'PrayerTrackerActivity[]', 'store provider-facing items');
  assertIncludes(storeSource, 'Promise<PrayerTrackerActivity>', 'store provider-facing record result');
  assertIncludes(storeSource, 'item.id !== activity.id', 'store upsert identity');
  assertIncludes(
    storeSource,
    'second.activityDate.localeCompare(first.activityDate)',
    'store date descending sort',
  );
  assertIncludes(
    storeSource,
    'new Date(second.createdAt).getTime() - new Date(first.createdAt).getTime()',
    'store creation time descending sort',
  );

  for (const operation of [
    'loadMyActivity:',
    'recordActivity:',
    'clearError:',
    'reset:',
    'loading:',
    'recording:',
    'error:',
  ]) {
    assertIncludes(storeSource, operation, `store operation ${operation}`);
  }

  assertIncludes(typesSource, 'userId: string | null;', 'neutral nullable user identity');
  assertIncludes(
    typesSource,
    "PrayerActivityLog extends Omit<PrayerTrackerActivity, 'userId'>",
    'strict account activity extraction',
  );
  assertIncludes(serviceSource, "from '@/config/appCapabilities'", 'canonical capabilities import');
  assertEqual(
    serviceSource.includes('EXPO_PUBLIC_APP_ACCESS_MODE'),
    false,
    'service does not parse access-mode environment',
  );

  const localAdapterStart = serviceSource.indexOf('const localPrayerTrackerProvider');
  const apiAdapterStart = serviceSource.indexOf('const apiPrayerTrackerProvider');
  const localAdapterSource = serviceSource.slice(localAdapterStart, apiAdapterStart);

  assertEqual(localAdapterStart >= 0 && apiAdapterStart > localAdapterStart, true, 'local adapter source');
  assertIncludes(localAdapterSource, 'listLocalPrayerActivity', 'local adapter load');
  assertIncludes(localAdapterSource, 'recordLocalPrayerActivity', 'local adapter record');
  assertEqual(localAdapterSource.includes('loadApiPrayerActivity'), false, 'local adapter API load exclusion');
  assertEqual(localAdapterSource.includes('recordApiPrayerActivity'), false, 'local adapter API record exclusion');
  assertEqual(localAdapterSource.includes('catch'), false, 'local adapter has no fallback catch');
}

function createProductionDependencySpies({ localFailure = false } = {}) {
  const calls = {
    apiLoad: 0,
    apiRecord: 0,
    localLoad: 0,
    localRecord: 0,
  };
  const inputs = {
    apiLoad: [],
    apiRecord: [],
    localLoad: [],
    localRecord: [],
  };

  return {
    calls,
    inputs,
    localFailure,
  };
}

function loadServiceForMode(appAccessMode, spies) {
  const servicePath = path.join(repoRoot, 'src/services/prayerTrackerService.ts');
  const capabilitiesPath = path.join(repoRoot, 'src/config/appCapabilities.ts');

  delete require.cache[require.resolve(servicePath)];
  delete require.cache[require.resolve(capabilitiesPath)];

  if (appAccessMode === undefined) {
    delete process.env.EXPO_PUBLIC_APP_ACCESS_MODE;
  } else {
    process.env.EXPO_PUBLIC_APP_ACCESS_MODE = appAccessMode;
  }

  activeProductionDependencySpies = spies;
  return require(servicePath);
}

function readSource(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

async function assertRejects(operation, description) {
  let rejected = false;

  try {
    await operation();
  } catch {
    rejected = true;
  }

  assertEqual(rejected, true, description);
}

function assertIncludes(source, expected, description) {
  assertEqual(source.includes(expected), true, description);
}

function assertEqual(actual, expected, description) {
  if (actual !== expected) {
    throw new Error(
      `${description}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
}

function assertDeepEqual(actual, expected, description) {
  assertEqual(JSON.stringify(actual), JSON.stringify(expected), description);
}

function registerProductionDependencyStubs() {
  const originalLoad = Module._load;

  Module._load = function loadWithProviderStubs(request, parent, isMain) {
    if (request === '@/local-data/prayerRepository') {
      const spies = activeProductionDependencySpies;
      return {
        async listLocalPrayerActivity(params) {
          spies.calls.localLoad += 1;
          spies.inputs.localLoad.push(params);
          if (spies.localFailure) throw new Error('storage_unavailable');
          return [localFixture];
        },
        async recordLocalPrayerActivity(input) {
          spies.calls.localRecord += 1;
          spies.inputs.localRecord.push(input);
          if (spies.localFailure) throw new Error('storage_unavailable');
          return localFixture;
        },
      };
    }

    if (request === './prayerTrackerApiService') {
      const spies = activeProductionDependencySpies;
      return {
        async loadMyPrayerActivity(params) {
          spies.calls.apiLoad += 1;
          spies.inputs.apiLoad.push(params);
          return [apiFixture];
        },
        async recordPrayerActivity(input) {
          spies.calls.apiRecord += 1;
          spies.inputs.apiRecord.push(input);
          return apiFixture;
        },
      };
    }

    return originalLoad.call(this, request, parent, isMain);
  };
}

function registerSourceAliasResolver() {
  const originalResolveFilename = Module._resolveFilename;

  Module._resolveFilename = function resolveSourceAlias(request, parent, isMain, options) {
    if (request.startsWith('@/')) {
      const sourcePath = path.join(repoRoot, 'src', request.slice(2));
      return originalResolveFilename.call(this, sourcePath, parent, isMain, options);
    }

    return originalResolveFilename.call(this, request, parent, isMain, options);
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
        target: ts.ScriptTarget.ES2022,
      },
      fileName: filename,
    });

    module._compile(outputText, filename);
  };
}
