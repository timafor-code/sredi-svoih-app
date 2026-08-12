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

const prayersSource = readSource('app/profile/prayers-settings.tsx');
const notificationsSource = readSource('app/profile/notifications.tsx');
const guestShellSource = readSource('src/components/settings/GuestSettingsShell.tsx');

validateCapabilityBranches();
validateGuestPrayerSource();
validateGuestNotificationSource();
validateAccountRegressionSource();
validateRouteBoundary();
validateGuestSettingsShell();
validateProductionHelpers();

console.log('Local prayer and notification settings validation passed');

function validateCapabilityBranches() {
  for (const [source, screenName, localName, accountName] of [
    [prayersSource, 'PrayersSettingsScreen', 'LocalPrayersSettingsScreen', 'AccountPrayersSettingsScreen'],
    [notificationsSource, 'NotificationsScreen', 'LocalNotificationsScreen', 'AccountNotificationsScreen'],
  ]) {
    assertIncludes(
      source,
      "import { appCapabilities } from '@/config/appCapabilities';",
      `${screenName} canonical capabilities`,
    );
    assertExcludes(source, 'EXPO_PUBLIC_APP_ACCESS_MODE', `${screenName} direct environment parsing`);
    const branch = sourceBetween(
      source,
      `export default function ${screenName}()`,
      `function ${localName}()`,
      `${screenName} capability branch`,
    );
    assertIncludes(branch, 'appCapabilities.isGuestOnly', `${screenName} guest branch`);
    assertIncludes(branch, `<${localName} />`, `${screenName} local component`);
    assertIncludes(branch, `<${accountName} />`, `${screenName} account component`);
    assertExcludes(branch, 'useAuthStore', `${screenName} wrapper auth isolation`);
  }
}

function validateGuestPrayerSource() {
  const localSource = sourceBetween(
    prayersSource,
    'function LocalPrayersSettingsScreen()',
    'function AccountPrayersSettingsScreen()',
    'local prayers component',
  );
  const saveHelper = sourceBetween(
    prayersSource,
    'export function saveLocalNusachSelection',
    'export default function PrayersSettingsScreen()',
    'local nusach save helper',
  );

  for (const expected of [
    'state.nusach',
    'state.setNusach',
    'resolveVisibleNusachSelection',
    'saveLocalNusachSelection',
    'на этом устройстве',
  ]) {
    assertIncludes(localSource, expected, `local prayers ${expected}`);
  }
  for (const forbidden of ['useAuthStore', 'authUser', 'profile', 'updateProfile', 'loadSession']) {
    assertExcludes(localSource, forbidden, `local prayers excludes ${forbidden}`);
  }
  assertIncludes(saveHelper, 'setNusach(value)', 'local nusach persists explicit selection');
  assertIncludes(
    saveHelper,
    'normalizeDisplayModeForTextNusach',
    'local nusach normalizes blessing display mode',
  );
  assertExcludes(saveHelper, "setNusach('chabad')", 'local fallback does not force persistence');

  const contentSource = prayersSource.slice(prayersSource.indexOf('function PrayersSettingsContent'));
  for (const expected of [
    'state.city',
    'state.customGpsLocation',
    'state.gpsCity',
    'state.locationPermissionStatus',
    'state.zmanimSource',
    'CityPickerModal',
    'useAutoDetectZmanimCity',
    'getAvailableBlessingTextDisplayModes',
  ]) {
    assertIncludes(contentSource, expected, `shared prayers content ${expected}`);
  }
}

function validateGuestNotificationSource() {
  const localSource = sourceBetween(
    notificationsSource,
    'function LocalNotificationsScreen()',
    'function AccountNotificationsScreen()',
    'local notifications component',
  );
  const editorSource = sourceBetween(
    notificationsSource,
    'function NotificationSettingsEditor',
    'const styles = StyleSheet.create',
    'notification settings editor',
  );
  const localRowsSource = sourceBetween(
    notificationsSource,
    'const notificationRows',
    'const permissionStatusLabels',
    'notification row definitions',
  );

  for (const expected of [
    'state.notificationPreferences',
    'state.setNotificationPreferences',
    'saveLocalNotificationPreferences',
    'communityContacts: []',
    'myRegistrations: []',
    'state.localContacts',
    'state.events',
    'localNotificationRows',
    'на этом устройстве',
  ]) {
    assertIncludes(localSource, expected, `local notifications ${expected}`);
  }
  for (const forbidden of [
    'useAuthStore',
    'updateProfile',
    'loadSession',
    'registerCurrentDeviceForPush',
    'AccountPushRegistrationCard',
    'state.communityContacts',
    'state.myRegistrations',
  ]) {
    assertExcludes(localSource, forbidden, `local notifications excludes ${forbidden}`);
  }
  assertIncludes(localRowsSource, "key: 'news'", 'account notification rows preserve news');
  assertIncludes(
    localRowsSource,
    "notificationRows.filter((row) => row.key !== 'news')",
    'local notification rows exclude news',
  );

  for (const expected of [
    'normalizeNotificationPreferencesForSchedule(savedPreferences)',
    'normalizeNotificationPreferencesForSchedule(preferences)',
    'await onSave(nextPreferences)',
    'getNotificationPermissionStatus()',
    'requestNotificationPermissions()',
    'scheduleTestLocalNotification()',
    'cancelAllLocalNotifications()',
    'quietHoursEnabled',
    'quietHoursStart',
    'quietHoursEnd',
    'candlesReminderOffsetMinutes',
    'eventsPrimaryReminderOffsetHours',
    'birthdaysReminderHour',
  ]) {
    assertIncludes(editorSource, expected, `notification editor ${expected}`);
  }
  for (const forbidden of [
    'registerCurrentDeviceForPush',
    'ExpoPushToken',
    'Зарегистрировать это устройство',
  ]) {
    assertExcludes(editorSource, forbidden, `notification editor excludes remote push ${forbidden}`);
  }

  const preferencesTypeSource = readSource('src/types/profile.ts');
  const preferencesRepositorySource = readSource('src/local-data/preferencesRepository.ts');
  assertIncludes(preferencesTypeSource, 'news: boolean;', 'notification schema preserves news');
  assertIncludes(preferencesTypeSource, 'news: false,', 'notification defaults preserve news');
  assertIncludes(
    preferencesRepositorySource,
    "case 'notificationPreferences':",
    'local serialization preserves notification preferences',
  );
}

function validateAccountRegressionSource() {
  const accountPrayers = sourceBetween(
    prayersSource,
    'function AccountPrayersSettingsScreen()',
    'function PrayersSettingsContent',
    'account prayers component',
  );
  for (const expected of [
    'profile?.nusach',
    'loadSession()',
    'updateProfile({ nusach: value })',
    'useAuthStore',
  ]) {
    assertIncludes(accountPrayers, expected, `account prayers preserves ${expected}`);
  }

  const accountNotifications = sourceBetween(
    notificationsSource,
    'function AccountNotificationsScreen()',
    'function NotificationsLoadingState',
    'account notifications component',
  );
  for (const expected of [
    'profile.notification_preferences',
    'loadSession()',
    'updateProfile({ notification_preferences: nextPreferences })',
    'state.communityContacts',
    'state.myRegistrations',
    'myRegistrationsUserId',
    '<AccountPushRegistrationCard',
  ]) {
    assertIncludes(accountNotifications, expected, `account notifications preserves ${expected}`);
  }
  const pushSource = sourceBetween(
    notificationsSource,
    'function AccountPushRegistrationCard',
    'function NotificationSettingsEditor',
    'account push component',
  );
  assertIncludes(pushSource, 'registerCurrentDeviceForPush()', 'account remote push registration');
  assertIncludes(pushSource, 'Зарегистрировать это устройство', 'account remote push control');
}

function validateRouteBoundary() {
  const { resolveAppCapabilities } = require(sourcePath('src/config/appCapabilities.ts'));
  const { isGuestBlockedPathname } = require(sourcePath('src/navigation/guestRouteGuard.ts'));
  const guest = resolveAppCapabilities('guest_only', 'disabled');
  const account = resolveAppCapabilities('account', 'disabled');
  const allowedForGuest = ['/profile/notifications', '/profile/prayers-settings'];
  const blockedForGuest = [
    '/profile/edit',
    '/profile/onboarding',
    '/profile/my-registrations',
    '/contacts/community/abc',
    '/contacts/abc',
  ];

  for (const pathname of allowedForGuest) {
    assertEqual(isGuestBlockedPathname(pathname, guest), false, `guest allows ${pathname}`);
    assertEqual(isGuestBlockedPathname(pathname, account), false, `account allows ${pathname}`);
  }
  for (const pathname of blockedForGuest) {
    assertEqual(isGuestBlockedPathname(pathname, guest), true, `guest blocks ${pathname}`);
    assertEqual(isGuestBlockedPathname(pathname, account), false, `account allows ${pathname}`);
  }
}

function validateGuestSettingsShell() {
  for (const route of [
    '/profile/notifications',
    '/profile/prayers-settings',
    '/profile/prayer-tracker',
    '/profile/about',
    '/profile/support',
    '/modals/city-picker',
  ]) {
    assertIncludes(guestShellSource, route, `guest settings route ${route}`);
  }
  for (const forbidden of ['useAuthStore', 'updateProfile', 'loadSession']) {
    assertExcludes(guestShellSource, forbidden, `guest settings excludes ${forbidden}`);
  }
}

function validateProductionHelpers() {
  const originalLoad = Module._load;
  const plannerDependencyStubs = new Map([
    ['@/services/notificationHebcalPlannerService', {
      buildHebcalNotificationCandidate: () => null,
      isHebcalNotificationCategory: () => false,
    }],
    ['@/services/notificationBirthdayPlannerService', {
      buildBirthdayNotificationCandidates: () => [],
    }],
    ['@/services/notificationEventPlannerService', {
      buildEventNotificationCandidates: () => [],
    }],
  ]);

  Module._load = function loadScreenWithStubs(request, parent, isMain) {
    if (plannerDependencyStubs.has(request)) {
      return plannerDependencyStubs.get(request);
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  try {
    const planner = require(sourcePath('src/services/notificationPlannerService.ts'));
    const stubs = createScreenDependencyStubs(planner);
    Module._load = function loadScreenWithStubs(request, parent, isMain) {
      if (stubs.has(request)) {
        return stubs.get(request);
      }
      if (plannerDependencyStubs.has(request)) {
        return plannerDependencyStubs.get(request);
      }
      return originalLoad.call(this, request, parent, isMain);
    };
    const prayersModule = require(sourcePath('app/profile/prayers-settings.tsx'));
    const notificationsModule = require(sourcePath('app/profile/notifications.tsx'));
    const fallback = prayersModule.resolveVisibleNusachSelection('common');
    assertEqual(fallback.selectedNusach, 'chabad', 'common visually falls back to Chabad');
    assertEqual(fallback.hasSavedVisibleNusach, false, 'common remains unselected');

    const nusachWrites = [];
    const blessingWrites = [];
    const normalizedMode = prayersModule.saveLocalNusachSelection({
      blessingDefaultDisplayMode: 'translit_ashkenaz',
      setBlessingDefaultDisplayMode: (value) => blessingWrites.push(value),
      setNusach: (value) => nusachWrites.push(value),
      value: 'sephardi',
    });
    assertDeepEqual(nusachWrites, ['sephardi'], 'Sephardi selection writes local nusach once');
    assertDeepEqual(
      blessingWrites,
      ['translit_sephard'],
      'Sephardi selection normalizes local blessing display mode',
    );
    assertEqual(normalizedMode, 'translit_sephard', 'Sephardi normalized mode result');

    const syntheticPreferences = {
      ...require(sourcePath('src/types/profile.ts')).DEFAULT_NOTIFICATION_PREFERENCES,
      prayers: false,
      candlesReminderOffsetMinutes: 30,
      quietHoursEnabled: true,
    };
    const preferenceWrites = [];
    const saved = notificationsModule.saveLocalNotificationPreferences(
      syntheticPreferences,
      (value) => preferenceWrites.push(value),
    );
    assertEqual(preferenceWrites.length, 1, 'local notification preferences write once');
    assertDeepEqual(preferenceWrites[0], saved, 'local notification setter receives normalized draft');
    assertEqual(saved.prayers, false, 'local notification boolean persists');
    assertEqual(saved.candlesReminderOffsetMinutes, 30, 'local advanced preference persists');
    assertEqual(saved.quietHoursEnabled, true, 'local quiet hours persist');
  } finally {
    Module._load = originalLoad;
  }
}

function createScreenDependencyStubs(planner) {
  const component = () => null;
  const colorProxy = new Proxy({}, { get: () => colorProxy });

  return new Map([
    ['expo-router', { Stack: { Screen: component }, useRouter: () => ({ replace() {} }) }],
    ['react-native', {
      ActivityIndicator: component,
      Alert: { alert() {} },
      Pressable: component,
      StyleSheet: { create: (styles) => styles },
      Text: component,
      View: component,
    }],
    [
      '@/components/prayer/CityPickerModal',
      { CityPickerModal: component },
    ],
    ['@/components/ui/IOSGroup', { IOSGroup: component }],
    ['@/components/ui/ListRow', { ListRow: component }],
    ['@/components/ui/PrimaryButton', { PrimaryButton: component }],
    ['@/components/ui/Screen', { Screen: component }],
    ['@/components/ui/SectionTitle', { SectionTitle: component }],
    ['@/components/ui/SubHeader', { SubHeader: component }],
    ['@/components/ui/ToggleRow', { ToggleRow: component }],
    ['@/components/glass/GlassCard', { GlassCard: component }],
    ['@/config/appCapabilities', { appCapabilities: { isAccountMode: false, isGuestOnly: true } }],
    ['@/hooks/useAutoDetectZmanimCity', {
      useAutoDetectZmanimCity: () => ({ isDetecting: false, message: null }),
    }],
    ['@/lib/blessingTextDisplayMode', require(sourcePath('src/lib/blessingTextDisplayMode.ts'))],
    ['@/lib/zmanim', { isSupportedZmanimCity: () => true }],
    ['@/services/notificationPlannerService', planner],
    ['@/services/notificationsService', {
      cancelAllLocalNotifications: async () => ({ ok: true }),
      getNotificationPermissionStatus: async () => 'granted',
      requestNotificationPermissions: async () => 'granted',
      scheduleTestLocalNotification: async () => ({ ok: true, permissionStatus: 'granted' }),
    }],
    ['@/services/pushTokenService', {
      registerCurrentDeviceForPush: async () => ({ status: 'not_authenticated' }),
    }],
    ['@/store/useAuthStore', { useAuthStore: () => null }],
    ['@/store/useContactsStore', { useContactsStore: () => [] }],
    ['@/store/useEventsStore', { useEventsStore: () => [] }],
    ['@/store/useSettingsStore', { useSettingsStore: () => null }],
    ['@/theme/colors', { colors: colorProxy }],
  ]);
}

function sourceBetween(source, startMarker, endMarker, description) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assertEqual(start >= 0 && end > start, true, description);
  return source.slice(start, end);
}

function readSource(relativePath) {
  return fs.readFileSync(sourcePath(relativePath), 'utf8');
}

function sourcePath(relativePath) {
  return path.join(repoRoot, relativePath);
}

function assertIncludes(source, expected, description) {
  assertEqual(source.includes(expected), true, description);
}

function assertExcludes(source, forbidden, description) {
  assertEqual(source.includes(forbidden), false, description);
}

function assertDeepEqual(actual, expected, description) {
  assertEqual(JSON.stringify(actual), JSON.stringify(expected), description);
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
      const source = path.join(repoRoot, 'src', request.slice(2));
      return originalResolveFilename.call(this, source, parent, isMain, options);
    }
    return originalResolveFilename.call(this, request, parent, isMain, options);
  };
}

function registerTypeScriptRequireHook() {
  const compile = function compileTypeScriptModule(module, filename) {
    const source = fs.readFileSync(filename, 'utf8');
    const { outputText } = ts.transpileModule(source, {
      compilerOptions: {
        esModuleInterop: true,
        jsx: ts.JsxEmit.ReactJSX,
        module: ts.ModuleKind.CommonJS,
        moduleResolution: ts.ModuleResolutionKind.NodeJs,
        target: ts.ScriptTarget.ES2022,
      },
      fileName: filename,
    });
    module._compile(outputText, filename);
  };

  Module._extensions['.ts'] = compile;
  Module._extensions['.tsx'] = compile;
}
