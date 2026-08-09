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

registerTypeScriptRequireHook();
registerSourceAliasResolver();

const {
  formatLocalDateKey,
  hasRecordedActivity,
  hasRecordedMorningShema,
  hasRecordedOmerCount,
} = require(path.join(repoRoot, 'src/lib/prayerTracker.ts'));

validateGuestRecordedState();
validateTimezoneDateIdentity();
validateModalBoundary();
validateScreenBoundaries();

console.log('Guest prayer actions validation passed');

function validateGuestRecordedState() {
  const activityDate = '2026-08-09';
  const guestItems = [
    createGuestItem('shacharit', activityDate, '10000000-0000-4000-8000-000000000001'),
    createGuestItem('shema_morning', activityDate, '10000000-0000-4000-8000-000000000002'),
    createGuestItem('omer_count', activityDate, '10000000-0000-4000-8000-000000000003'),
  ];

  assertEqual(
    hasRecordedActivity(guestItems, 'shacharit', activityDate, null),
    true,
    'guest prayer activity matches with null user identity',
  );
  assertEqual(
    hasRecordedMorningShema(guestItems, activityDate, null),
    true,
    'guest Morning Shema matches with null user identity',
  );
  assertEqual(
    hasRecordedOmerCount(guestItems, activityDate, null),
    true,
    'guest Omer count matches with null user identity',
  );
  assertEqual(
    hasRecordedActivity(guestItems, 'mincha', activityDate, null),
    false,
    'activity type remains part of guest recorded identity',
  );
  assertEqual(
    hasRecordedOmerCount(guestItems, '2026-08-08', null),
    false,
    'activity date remains part of guest recorded identity',
  );
}

function validateTimezoneDateIdentity() {
  const nearMidnightUtc = new Date('2026-08-08T22:30:00.000Z');

  assertEqual(
    formatLocalDateKey(nearMidnightUtc, 'Europe/Moscow'),
    '2026-08-09',
    'production helper uses the prayer timezone across a UTC date boundary',
  );
  assertEqual(
    formatLocalDateKey(nearMidnightUtc, 'UTC'),
    '2026-08-08',
    'production helper preserves the UTC calendar date in UTC',
  );
}

function validateModalBoundary() {
  const modalSource = readSource('src/components/prayer/PrayerActionModal.tsx');

  assertExcludes(modalSource, 'useAuthStore', 'modal auth-store dependency');
  assertExcludes(modalSource, 'if (!authUser)', 'modal missing-user recording guard');
  assertExcludes(
    modalSource,
    'Чтобы вести молитвенный трекер, войдите в приложение.',
    'old guest login CTA',
  );
  assertIncludes(modalSource, 'await recordActivity({', 'store recording entrypoint');
  assertIncludes(modalSource, 'activityDate,', 'canonical activity date recording input');
  assertIncludes(
    modalSource,
    'Не удалось сохранить запись. Попробуйте ещё раз.',
    'provider-neutral recording error',
  );
  assertExcludes(modalSource, 'storage_unavailable', 'storage failure auth classification');
  validateNoDirectProviderImports(
    'src/components/prayer/PrayerActionModal.tsx',
    modalSource,
  );
}

function validateScreenBoundaries() {
  const sourceByPath = new Map(
    [
      'app/(tabs)/index.tsx',
      'app/(tabs)/prayers.tsx',
      'app/modals/omer.tsx',
      'src/components/prayer/MorningShemaCard.tsx',
    ].map((relativePath) => [relativePath, readSource(relativePath)]),
  );

  for (const [relativePath, source] of sourceByPath) {
    validateNoDirectProviderImports(relativePath, source);
    assertIncludes(source, 'usePrayerTrackerStore', `${relativePath} store boundary`);
  }

  for (const relativePath of [
    'src/components/prayer/MorningShemaCard.tsx',
  ]) {
    const source = sourceByPath.get(relativePath);
    assertExcludes(source, 'useAuthStore', `${relativePath} prayer auth-store dependency`);
    assertExcludes(source, 'authUser', `${relativePath} prayer account identity`);
  }

  for (const relativePath of [
    'app/(tabs)/prayers.tsx',
    'app/modals/omer.tsx',
  ]) {
    const source = sourceByPath.get(relativePath);
    assertIncludes(
      source,
      'useAuthStore((state) => state.loading)',
      `${relativePath} account bootstrap lifecycle`,
    );
    assertExcludes(source, 'useAuthStore((state) => state.user)', `${relativePath} prayer user identity`);
    assertExcludes(source, 'authUser', `${relativePath} prayer account identity`);
  }

  const homeSource = sourceByPath.get('app/(tabs)/index.tsx');
  const homeRecordedState = sliceBetween(
    homeSource,
    'const currentPrayerAlreadyRecorded',
    'void loadEvents()',
    'Home recorded-state source',
  );
  const homePrayerLoad = sliceBetween(
    homeSource,
    'if (authSessionLoading)',
    'if (selectedPrayer && !selectedPrayer.active)',
    'Home prayer load source',
  );

  assertExcludes(homeRecordedState, 'authUser', 'Home prayer recorded account identity');
  assertExcludes(homePrayerLoad, 'authUser', 'Home prayer load auth gate');
  assertIncludes(
    homeSource,
    'const authUser = useAuthStore((state) => state.user);',
    'Home retains unrelated account state',
  );

  const prayersSource = sourceByPath.get('app/(tabs)/prayers.tsx');
  assertIncludes(
    prayersSource,
    'void loadMyActivity({ limit: 100 })',
    'Prayers loads provider state without auth',
  );
  assertIncludes(
    prayersSource,
    'prayerActivityTypeFromPrayerId(prayer.id)',
    'Prayers preserves activity mapping',
  );
  assertIncludes(prayersSource, 'activityDate={activityDate}', 'Prayers modal date identity');
  assertIncludes(homeSource, 'activityDate={activityDate}', 'Home modal date identity');

  const shemaSource = sourceByPath.get('src/components/prayer/MorningShemaCard.tsx');
  assertIncludes(
    shemaSource,
    'hasRecordedMorningShema(prayerActivityItems, activityDate)',
    'Morning Shema provider identity',
  );
  assertIncludes(shemaSource, 'activityDate={activityDate}', 'Morning Shema modal date identity');

  const omerSource = sourceByPath.get('app/modals/omer.tsx');
  assertIncludes(
    omerSource,
    'hasRecordedOmerCount(prayerActivityItems, activityDate)',
    'Omer provider identity',
  );
  assertIncludes(omerSource, 'activityDate,', 'Omer recording date identity');
  assertExcludes(
    omerSource,
    'Чтобы вести молитвенный трекер, войдите в приложение.',
    'Omer old guest login CTA',
  );
}

function validateNoDirectProviderImports(relativePath, source) {
  for (const forbiddenDependency of [
    'prayerRepository',
    'prayerTrackerApiService',
    'apiClient',
  ]) {
    assertExcludes(source, forbiddenDependency, `${relativePath} excludes ${forbiddenDependency}`);
  }
}

function createGuestItem(activityType, activityDate, id) {
  return {
    id,
    userId: null,
    activityType,
    activityDate,
    startedAt: '2026-08-09T03:00:00.000Z',
    completedAt: null,
    timezone: 'Europe/Moscow',
    city: null,
    hebrewDate: {},
    metadata: {},
    createdAt: '2026-08-09T03:00:00.000Z',
    updatedAt: '2026-08-09T03:00:00.000Z',
  };
}

function readSource(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function sliceBetween(source, startMarker, endMarker, description) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);

  assertEqual(start >= 0 && end > start, true, description);
  return source.slice(start, end);
}

function assertIncludes(source, expected, description) {
  assertEqual(source.includes(expected), true, description);
}

function assertExcludes(source, forbidden, description) {
  assertEqual(source.includes(forbidden), false, description);
}

function assertEqual(actual, expected, description) {
  if (actual !== expected) {
    throw new Error(
      `${description}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
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
