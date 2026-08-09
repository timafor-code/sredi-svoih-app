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
const activityTypes = [
  'shacharit',
  'mincha',
  'maariv',
  'shema_morning',
  'shema_evening',
  'omer_count',
];

let activeRepositorySpies;
let activeStoreService;

registerDependencyStubs();
registerTypeScriptRequireHook();
registerSourceAliasResolver();

await validateServiceHistoryControls();
await validateStoreHistoryControls();
validateScreenAndSourceBoundaries();

console.log('Guest prayer history controls validation passed');

async function validateServiceHistoryControls() {
  const guestSpies = createRepositorySpies(createLocalRows(105));
  const guestService = loadServiceForMode('guest_only', guestSpies);
  const visibleItems = await guestService.loadMyPrayerActivity({ limit: 100 });
  const fullSummary = await guestService.loadLocalPrayerActivitySummary();

  assertEqual(visibleItems.length, 100, 'guest history preserves the visible limit');
  assertEqual(fullSummary.totalLogs, 105, 'summary uses the full local dataset');
  assertEqual(fullSummary.activeDays, 7, 'summary active days');
  assertEqual(fullSummary.firstActivityDate, '2026-08-01', 'summary first activity date');
  assertEqual(fullSummary.lastActivityDate, '2026-08-07', 'summary last activity date');
  assertDeepEqual(
    fullSummary.countsByActivityType,
    countActivities(guestSpies.rows),
    'summary per-activity counts',
  );
  assertEqual(guestSpies.calls.apiLoad, 0, 'guest history avoids the prayer API');

  const targetId = visibleItems[25].id;
  const retainedId = visibleItems[26].id;
  const rowsBeforeDelete = guestSpies.rows.length;
  const deleted = await guestService.deleteOneLocalPrayerActivity(targetId);
  const summaryAfterDelete = await guestService.loadLocalPrayerActivitySummary();

  assertEqual(deleted, true, 'single local deletion reports success');
  assertEqual(guestSpies.rows.length, rowsBeforeDelete - 1, 'single deletion removes one row');
  assertEqual(guestSpies.rows.some((row) => row.localId === targetId), false, 'target row removed');
  assertEqual(guestSpies.rows.some((row) => row.localId === retainedId), true, 'unrelated row remains');
  assertEqual(summaryAfterDelete.totalLogs, 104, 'summary updates after single deletion');

  const missingDelete = await guestService.deleteOneLocalPrayerActivity(targetId);
  assertEqual(missingDelete, false, 'missing local id settles safely');
  assertEqual(guestSpies.rows.length, 104, 'missing local id does not remove another row');

  await guestService.deleteAllLocalPrayerActivityHistory();
  const emptySummary = await guestService.loadLocalPrayerActivitySummary();

  assertEqual(guestSpies.rows.length, 0, 'delete all removes guest prayer rows');
  assertDeepEqual(emptySummary, emptyPrayerSummary(), 'delete all returns a zero summary');
  assertEqual(guestSpies.calls.preferences, 0, 'delete all does not touch preferences');
  assertEqual(guestSpies.calls.auth, 0, 'delete all does not touch auth');
  assertEqual(guestSpies.calls.databaseKey, 0, 'delete all does not touch the database key');
  assertEqual(guestSpies.calls.apiDelete, 0, 'delete all does not call server deletion');

  const accountSpies = createRepositorySpies(createLocalRows(3));
  const accountService = loadServiceForMode('account', accountSpies);
  const accountItems = await accountService.loadMyPrayerActivity({ limit: 100 });

  assertEqual(accountItems[0].userId, 'account-user', 'account history still uses API mapping');
  assertEqual(accountSpies.calls.apiLoad, 1, 'account history uses the API provider');
  assertEqual(accountSpies.calls.localLoad, 0, 'account history does not load guest rows');

  await assertRejects(
    () => accountService.loadLocalPrayerActivitySummary(),
    'account local summary is unavailable',
  );
  await assertRejects(
    () => accountService.deleteOneLocalPrayerActivity(accountSpies.rows[0].localId),
    'account local single deletion is unavailable',
  );
  await assertRejects(
    () => accountService.deleteAllLocalPrayerActivityHistory(),
    'account local delete all is unavailable',
  );
  assertEqual(accountSpies.calls.localSummary, 0, 'account summary does not reach local storage');
  assertEqual(accountSpies.calls.localDeleteOne, 0, 'account single delete does not reach local storage');
  assertEqual(accountSpies.calls.localDeleteAll, 0, 'account delete all does not reach local storage');
  assertEqual(accountSpies.calls.apiDelete, 0, 'account controls do not invent API deletion');
}

async function validateStoreHistoryControls() {
  let rows = createTrackerRows(3);

  activeStoreService = {
    async loadMyPrayerActivity({ limit = 100 } = {}) {
      return rows.slice(0, limit).map((row) => ({ ...row }));
    },
    async loadLocalPrayerActivitySummary() {
      return summarizeTrackerRows(rows);
    },
    async deleteOneLocalPrayerActivity(localId) {
      const index = rows.findIndex((row) => row.id === localId);

      if (index < 0) return false;
      rows.splice(index, 1);
      return true;
    },
    async deleteAllLocalPrayerActivityHistory() {
      const deleted = rows.length;
      rows.splice(0, rows.length);
      return deleted;
    },
    async recordPrayerActivity() {
      throw new Error('recording is outside this validator');
    },
  };

  const storePath = path.join(repoRoot, 'src/store/usePrayerTrackerStore.ts');
  delete require.cache[require.resolve(storePath)];
  const { usePrayerTrackerStore } = require(storePath);

  await usePrayerTrackerStore.getState().loadMyActivity({ limit: 100 });
  await usePrayerTrackerStore.getState().loadSummary();

  const targetId = rows[0].id;
  const retainedId = rows[1].id;
  await usePrayerTrackerStore.getState().deleteActivity(targetId);

  assertEqual(
    usePrayerTrackerStore.getState().items.some((item) => item.id === targetId),
    false,
    'store removes the deleted visible item',
  );
  assertEqual(
    usePrayerTrackerStore.getState().items.some((item) => item.id === retainedId),
    true,
    'store retains unrelated visible items',
  );
  assertEqual(usePrayerTrackerStore.getState().summary.totalLogs, 2, 'store refreshes summary');

  await usePrayerTrackerStore.getState().deleteAllLocalHistory();
  assertEqual(usePrayerTrackerStore.getState().items.length, 0, 'store clears visible items');
  assertDeepEqual(
    usePrayerTrackerStore.getState().summary,
    emptyPrayerSummary(),
    'store keeps a zero summary after delete all',
  );

  rows = createTrackerRows(3);
  usePrayerTrackerStore.getState().reset();
  activeStoreService.loadMyPrayerActivity = async ({ limit = 100 } = {}) => (
    rows.slice(0, limit).map((row) => ({ ...row }))
  );
  await usePrayerTrackerStore.getState().loadMyActivity({ limit: 100 });

  const oldSingleDeleteRows = rows.map((row) => ({ ...row }));
  const staleSingleDeleteLoad = createDeferred();
  activeStoreService.loadMyPrayerActivity = () => staleSingleDeleteLoad.promise;
  const singleDeleteLoadPromise = usePrayerTrackerStore.getState().loadMyActivity({ limit: 100 });
  const singleDeleteTargetId = rows[0].id;
  const singleDeleteRetainedId = rows[1].id;

  await usePrayerTrackerStore.getState().deleteActivity(singleDeleteTargetId);
  staleSingleDeleteLoad.resolve(oldSingleDeleteRows);
  await singleDeleteLoadPromise;

  assertEqual(
    usePrayerTrackerStore.getState().items.some((item) => item.id === singleDeleteTargetId),
    false,
    'stale history load cannot resurrect a single deleted row',
  );
  assertEqual(
    usePrayerTrackerStore.getState().items.some((item) => item.id === singleDeleteRetainedId),
    true,
    'single-delete race retains unrelated rows',
  );
  assertStoreLoadingSettled(usePrayerTrackerStore, 'single-delete race');

  rows = createTrackerRows(3);
  usePrayerTrackerStore.getState().reset();
  activeStoreService.loadMyPrayerActivity = async ({ limit = 100 } = {}) => (
    rows.slice(0, limit).map((row) => ({ ...row }))
  );
  await usePrayerTrackerStore.getState().loadMyActivity({ limit: 100 });
  await usePrayerTrackerStore.getState().loadSummary();

  const oldDeleteAllRows = rows.map((row) => ({ ...row }));
  const staleBeforeDeleteAll = createDeferred();
  const staleDuringDeleteAll = createDeferred();
  const deleteAllGate = createDeferred();
  let deleteAllLoadCall = 0;
  activeStoreService.loadMyPrayerActivity = () => {
    deleteAllLoadCall += 1;
    return deleteAllLoadCall === 1
      ? staleBeforeDeleteAll.promise
      : staleDuringDeleteAll.promise;
  };
  activeStoreService.deleteAllLocalPrayerActivityHistory = async () => {
    await deleteAllGate.promise;
    const deleted = rows.length;
    rows.splice(0, rows.length);
    return deleted;
  };

  const beforeDeleteAllLoadPromise = usePrayerTrackerStore.getState().loadMyActivity({ limit: 100 });
  const deleteAllPromise = usePrayerTrackerStore.getState().deleteAllLocalHistory();
  const duringDeleteAllLoadPromise = usePrayerTrackerStore.getState().loadMyActivity({ limit: 100 });
  deleteAllGate.resolve();
  await deleteAllPromise;
  staleBeforeDeleteAll.resolve(oldDeleteAllRows);
  staleDuringDeleteAll.resolve(oldDeleteAllRows);
  await Promise.all([beforeDeleteAllLoadPromise, duringDeleteAllLoadPromise]);

  assertEqual(usePrayerTrackerStore.getState().items.length, 0, 'stale loads cannot repopulate delete-all');
  assertEqual(usePrayerTrackerStore.getState().summary.totalLogs, 0, 'delete-all race keeps zero summary');
  assertStoreLoadingSettled(usePrayerTrackerStore, 'delete-all race');

  rows = createTrackerRows(3);
  usePrayerTrackerStore.getState().reset();
  activeStoreService.loadMyPrayerActivity = async ({ limit = 100 } = {}) => (
    rows.slice(0, limit).map((row) => ({ ...row }))
  );
  const oldSummary = summarizeTrackerRows(rows);
  const staleSummaryBeforeDelete = createDeferred();
  const staleSummaryDuringDelete = createDeferred();
  const summaryDeleteGate = createDeferred();
  let summaryLoadCall = 0;
  activeStoreService.deleteOneLocalPrayerActivity = async (localId) => {
    await summaryDeleteGate.promise;
    const index = rows.findIndex((row) => row.id === localId);

    if (index < 0) return false;
    rows.splice(index, 1);
    return true;
  };
  activeStoreService.loadLocalPrayerActivitySummary = () => {
    summaryLoadCall += 1;

    if (summaryLoadCall === 1) return staleSummaryBeforeDelete.promise;
    if (summaryLoadCall === 2) return staleSummaryDuringDelete.promise;
    return Promise.resolve(summarizeTrackerRows(rows));
  };
  await usePrayerTrackerStore.getState().loadMyActivity({ limit: 100 });

  const summaryBeforeDeletePromise = usePrayerTrackerStore.getState().loadSummary();
  const summaryDeleteTargetId = rows[0].id;
  const summaryDeletePromise = usePrayerTrackerStore.getState().deleteActivity(summaryDeleteTargetId);
  const summaryDuringDeletePromise = usePrayerTrackerStore.getState().loadSummary();
  summaryDeleteGate.resolve();
  await summaryDeletePromise;
  staleSummaryBeforeDelete.resolve(oldSummary);
  staleSummaryDuringDelete.resolve(oldSummary);
  await Promise.all([summaryBeforeDeletePromise, summaryDuringDeletePromise]);

  assertEqual(
    usePrayerTrackerStore.getState().summary.totalLogs,
    2,
    'stale summary loads cannot replace post-delete summary',
  );
  assertStoreLoadingSettled(usePrayerTrackerStore, 'summary race');

  let resolvePreviousAccountLoad;
  activeStoreService.loadMyPrayerActivity = () => new Promise((resolve) => {
    resolvePreviousAccountLoad = resolve;
  });
  const previousAccountLoad = usePrayerTrackerStore.getState().loadMyActivity({ limit: 100 });

  usePrayerTrackerStore.getState().reset();
  activeStoreService.loadMyPrayerActivity = async () => [createAccountTrackerRow('account-b')];
  await usePrayerTrackerStore.getState().loadMyActivity({ limit: 100 });
  resolvePreviousAccountLoad([createAccountTrackerRow('account-a')]);
  await previousAccountLoad;

  assertEqual(
    usePrayerTrackerStore.getState().items[0].userId,
    'account-b',
    'stale account load cannot replace active account history',
  );
  assertStoreLoadingSettled(usePrayerTrackerStore, 'account reset race');

  activeStoreService = null;
}

function validateScreenAndSourceBoundaries() {
  const screenSource = readSource('app/profile/prayer-tracker.tsx');
  const storeSource = readSource('src/store/usePrayerTrackerStore.ts');
  const serviceSource = readSource('src/services/prayerTrackerService.ts');

  for (const forbiddenDependency of [
    'prayerRepository',
    'prayerTrackerApiService',
    'apiClient',
  ]) {
    assertExcludes(screenSource, forbiddenDependency, `screen excludes ${forbiddenDependency}`);
  }

  assertIncludes(screenSource, "from '@/config/appCapabilities'", 'screen uses canonical capabilities');
  assertExcludes(screenSource, 'EXPO_PUBLIC_APP_ACCESS_MODE', 'screen does not parse access mode');
  assertIncludes(screenSource, 'await loadMyActivity({ limit: 100 })', 'guest history load boundary');
  assertIncludes(screenSource, 'await loadSummary()', 'guest summary store boundary');
  assertIncludes(screenSource, 'if (!appCapabilities.isAccountMode)', 'session load account gate');
  assertIncludes(screenSource, 'if (appCapabilities.isGuestOnly)', 'guest history branch');
  assertIncludes(
    screenSource,
    'appCapabilities.isAccountMode && !authUser',
    'login-required card is account-only',
  );
  assertIncludes(
    screenSource,
    'onDelete={appCapabilities.isGuestOnly',
    'single-delete control is guest-only',
  );
  assertIncludes(
    screenSource,
    'const showDeleteAll = appCapabilities.isGuestOnly',
    'delete-all control is guest-only',
  );
  assertIncludes(screenSource, 'item.id', 'deletion uses provider-facing item id');
  assertIncludes(screenSource, 'Удалить запись?', 'single deletion confirmation');
  assertIncludes(screenSource, 'Удалить всю историю?', 'delete-all confirmation');
  assertMatches(
    screenSource,
    /только[^'"\n]*истори[^'"\n]*устройств/iu,
    'delete-all wording states local device scope',
  );
  assertMatches(
    screenSource,
    /не удаляет данные аккаунта или сервера/iu,
    'delete-all wording excludes account and server erasure',
  );
  assertIncludes(screenSource, 'items.some((item) => item.userId !== authUser.id)', 'account privacy guard');
  assertIncludes(screenSource, 'Не удалось загрузить историю.', 'neutral guest loading error');
  assertExcludes(screenSource, 'Проверьте интернет', 'guest error avoids network assumption');
  assertExcludes(screenSource, 'SQLCipher', 'screen hides storage internals');

  assertIncludes(storeSource, "from '@/services/prayerTrackerService'", 'store uses service boundary');
  assertExcludes(storeSource, 'prayerRepository', 'store excludes repository access');
  assertExcludes(storeSource, 'prayerTrackerApiService', 'store excludes API provider access');
  assertIncludes(storeSource, 'summary: PrayerActivitySummary | null', 'store summary state');
  assertIncludes(storeSource, 'deleteActivity:', 'store single-delete action');
  assertIncludes(storeSource, 'deleteAllLocalHistory:', 'store delete-all action');
  assertIncludes(storeSource, 'state.items.filter((item) => item.id !== localId)', 'target-only state removal');
  assertIncludes(storeSource, 'const summary = await loadLocalPrayerActivitySummary()', 'authoritative summary reload');
  assertIncludes(storeSource, 'requestRevision !== activityLoadRevision', 'stale account load guard');
  assertIncludes(storeSource, 'let summaryLoadRevision = 0;', 'summary load revision');
  assertIncludes(storeSource, 'requestRevision !== summaryLoadRevision', 'stale summary load guard');
  assertIncludes(storeSource, 'invalidateHistoryReads();', 'deletion and reset read invalidation');

  assertIncludes(serviceSource, 'getLocalPrayerActivitySummary', 'service local summary adapter');
  assertIncludes(serviceSource, 'deleteLocalPrayerActivity', 'service local single-delete adapter');
  assertIncludes(serviceSource, 'deleteAllLocalGuestPrayerHistory', 'service local delete-all adapter');
  assertIncludes(serviceSource, 'requireGuestOnlyLocalHistory', 'service capability gate');
  assertExcludes(serviceSource, 'EXPO_PUBLIC_APP_ACCESS_MODE', 'service uses canonical mode parsing');

  for (const source of [screenSource, storeSource, serviceSource]) {
    assertExcludes(source, 'local_preferences', 'history controls exclude preferences');
    assertExcludes(source, 'SecureStore', 'history controls exclude auth/key storage');
  }

  const runtimeSources = listRuntimeSources();
  for (const [relativePath, source] of runtimeSources) {
    assertMatches(
      source,
      /^(?![\s\S]*(?:DELETE\s+\/me\/prayer-logs|\/me\/prayer-logs\/\{[^}]+\}|\.delete(?:<[^>]+>)?\(\s*['"]\/me\/prayer-logs))/i,
      `${relativePath} has no prayer-log server deletion`,
    );
  }
}

function createRepositorySpies(rows) {
  return {
    rows,
    calls: {
      apiDelete: 0,
      apiLoad: 0,
      auth: 0,
      databaseKey: 0,
      localDeleteAll: 0,
      localDeleteOne: 0,
      localLoad: 0,
      localSummary: 0,
      preferences: 0,
    },
  };
}

function createLocalRows(count) {
  return Array.from({ length: count }, (_, index) => {
    const day = (index % 7) + 1;
    const activityType = activityTypes[index % activityTypes.length];
    const suffix = String(index + 1).padStart(12, '0');

    return {
      localId: `10000000-0000-4000-8000-${suffix}`,
      ownerScope: 'guest',
      activityType,
      activityDate: `2026-08-${String(day).padStart(2, '0')}`,
      startedAt: `2026-08-${String(day).padStart(2, '0')}T03:00:00.000Z`,
      completedAt: null,
      timezone: 'Europe/Moscow',
      city: null,
      hebrewDate: {},
      metadata: {},
      createdAt: `2026-08-${String(day).padStart(2, '0')}T03:00:00.000Z`,
      updatedAt: `2026-08-${String(day).padStart(2, '0')}T03:00:00.000Z`,
      syncState: 'local_only',
      syncedUserId: null,
      serverId: null,
      lastSyncErrorCode: null,
    };
  });
}

function createTrackerRows(count) {
  return createLocalRows(count).map((row) => ({
    id: row.localId,
    userId: null,
    activityType: row.activityType,
    activityDate: row.activityDate,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
    timezone: row.timezone,
    city: row.city,
    hebrewDate: row.hebrewDate,
    metadata: row.metadata,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }));
}

function createAccountTrackerRow(userId) {
  return {
    ...createTrackerRows(1)[0],
    id: `account-row-${userId}`,
    userId,
  };
}

function summarizeLocalRows(rows) {
  const dates = rows.map((row) => row.activityDate).sort();

  return {
    fromDate: null,
    toDate: null,
    totalLogs: rows.length,
    activeDays: new Set(dates).size,
    countsByActivityType: countActivities(rows),
    firstActivityDate: dates[0] ?? null,
    lastActivityDate: dates.at(-1) ?? null,
  };
}

function summarizeTrackerRows(rows) {
  return summarizeLocalRows(rows);
}

function countActivities(rows) {
  const counts = Object.fromEntries(activityTypes.map((activityType) => [activityType, 0]));

  for (const row of rows) {
    counts[row.activityType] += 1;
  }

  return counts;
}

function emptyPrayerSummary() {
  return {
    fromDate: null,
    toDate: null,
    totalLogs: 0,
    activeDays: 0,
    countsByActivityType: countActivities([]),
    firstActivityDate: null,
    lastActivityDate: null,
  };
}

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, reject, resolve };
}

function assertStoreLoadingSettled(usePrayerTrackerStore, description) {
  const state = usePrayerTrackerStore.getState();

  assertEqual(state.loading, false, `${description} activity loading settled`);
  assertEqual(state.summaryLoading, false, `${description} summary loading settled`);
  assertEqual(state.deleting, false, `${description} deletion settled`);
}

function loadServiceForMode(appAccessMode, spies) {
  const servicePath = path.join(repoRoot, 'src/services/prayerTrackerService.ts');
  const capabilitiesPath = path.join(repoRoot, 'src/config/appCapabilities.ts');

  delete require.cache[require.resolve(servicePath)];
  delete require.cache[require.resolve(capabilitiesPath)];
  process.env.EXPO_PUBLIC_APP_ACCESS_MODE = appAccessMode;
  activeRepositorySpies = spies;
  return require(servicePath);
}

function registerDependencyStubs() {
  const originalLoad = Module._load;

  Module._load = function loadWithHistoryStubs(request, parent, isMain) {
    if (request === '@/services/prayerTrackerService' && activeStoreService) {
      return activeStoreService;
    }

    if (request === '@/local-data/prayerRepository') {
      return {
        async listLocalPrayerActivity({ limit = 100 } = {}) {
          activeRepositorySpies.calls.localLoad += 1;
          return activeRepositorySpies.rows.slice(0, limit).map((row) => ({ ...row }));
        },
        async recordLocalPrayerActivity() {
          throw new Error('recording is outside this validator');
        },
        async getLocalPrayerActivitySummary() {
          activeRepositorySpies.calls.localSummary += 1;
          return summarizeLocalRows(activeRepositorySpies.rows);
        },
        async deleteLocalPrayerActivity(localId) {
          activeRepositorySpies.calls.localDeleteOne += 1;
          const index = activeRepositorySpies.rows.findIndex((row) => row.localId === localId);

          if (index < 0) return false;
          activeRepositorySpies.rows.splice(index, 1);
          return true;
        },
        async deleteAllLocalGuestPrayerHistory() {
          activeRepositorySpies.calls.localDeleteAll += 1;
          const deleted = activeRepositorySpies.rows.length;
          activeRepositorySpies.rows.splice(0, activeRepositorySpies.rows.length);
          return deleted;
        },
      };
    }

    if (request === './prayerTrackerApiService') {
      return {
        async loadMyPrayerActivity() {
          activeRepositorySpies.calls.apiLoad += 1;
          return [{
            id: '20000000-0000-4000-8000-000000000001',
            userId: 'account-user',
            activityType: 'shacharit',
            activityDate: '2026-08-09',
            startedAt: '2026-08-09T03:00:00.000Z',
            completedAt: null,
            timezone: 'Europe/Moscow',
            city: null,
            hebrewDate: {},
            metadata: {},
            createdAt: '2026-08-09T03:00:00.000Z',
            updatedAt: '2026-08-09T03:00:00.000Z',
          }];
        },
        async recordPrayerActivity() {
          throw new Error('recording is outside this validator');
        },
      };
    }

    return originalLoad.call(this, request, parent, isMain);
  };
}

function listRuntimeSources() {
  const files = [];

  for (const relativeDirectory of ['app', 'src']) {
    walk(path.join(repoRoot, relativeDirectory), files);
  }

  return files
    .filter((filePath) => /\.(?:ts|tsx)$/.test(filePath))
    .map((filePath) => [path.relative(repoRoot, filePath), fs.readFileSync(filePath, 'utf8')]);
}

function walk(directory, files) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);

    if (entry.isDirectory()) walk(entryPath, files);
    else files.push(entryPath);
  }
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

function assertExcludes(source, forbidden, description) {
  assertEqual(source.includes(forbidden), false, description);
}

function assertMatches(source, pattern, description) {
  assertEqual(pattern.test(source), true, description);
}

function assertEqual(actual, expected, description) {
  if (actual !== expected) {
    throw new Error(`${description}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assertDeepEqual(actual, expected, description) {
  assertEqual(JSON.stringify(actual), JSON.stringify(expected), description);
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
