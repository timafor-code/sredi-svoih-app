#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');

const layoutSource = readSource('app/(tabs)/_layout.tsx');
const profileSource = readSource('app/(tabs)/profile.tsx');
const guestShellSource = readSource('src/components/settings/GuestSettingsShell.tsx');
const routeGuardSource = readSource('src/navigation/guestRouteGuard.ts');

validateTabMetadata();
validateGuestAccountBranch();
validateGuestShellDependenciesAndCopy();
validateGuestSafeRoutes();
validateLocalCityBoundary();
validateRouteGuardPreservation();
validateAccountProfilePreservation();

console.log('Guest settings shell validation passed');

function validateTabMetadata() {
  assertIncludes(
    layoutSource,
    "import { appCapabilities } from '@/config/appCapabilities';",
    'tabs use canonical app capabilities',
  );
  assertExcludes(
    layoutSource,
    'EXPO_PUBLIC_APP_ACCESS_MODE',
    'tabs do not parse the access-mode environment',
  );

  const metadataSource = sourceBetween(
    layoutSource,
    'const PROFILE_TAB_METADATA',
    'const TAB_CONFIG',
    'profile tab metadata',
  );
  const guestMetadata = sourceBetween(
    metadataSource,
    'appCapabilities.isGuestOnly',
    '  : {',
    'guest profile tab metadata',
  );
  const accountMetadata = metadataSource.slice(metadataSource.indexOf('  : {'));

  assertIncludes(guestMetadata, "label: 'Настройки'", 'guest tab label');
  assertIncludes(guestMetadata, "activeIcon: 'settings'", 'guest active settings icon');
  assertIncludes(
    guestMetadata,
    "inactiveIcon: 'settings-outline'",
    'guest inactive settings icon',
  );
  assertIncludes(guestMetadata, "default: 'gearshape'", 'guest native settings symbol');
  assertIncludes(guestMetadata, "selected: 'gearshape.fill'", 'guest selected native settings symbol');

  assertIncludes(accountMetadata, "label: 'Профиль'", 'account tab label');
  assertIncludes(accountMetadata, "activeIcon: 'person'", 'account active person icon');
  assertIncludes(
    accountMetadata,
    "inactiveIcon: 'person-outline'",
    'account inactive person icon',
  );
  assertIncludes(
    accountMetadata,
    "default: 'person.crop.circle'",
    'account native person symbol',
  );
  assertIncludes(
    accountMetadata,
    "selected: 'person.crop.circle.fill'",
    'account selected native person symbol',
  );

  const customTabsSource = sourceBetween(
    layoutSource,
    'const TAB_CONFIG',
    'const NATIVE_TAB_CONFIG',
    'custom tab configuration',
  );
  assertIncludes(customTabsSource, 'profile: {', 'custom profile route metadata');
  assertIncludes(
    customTabsSource,
    'label: PROFILE_TAB_METADATA.label',
    'custom tab capability-aware label',
  );
  assertIncludes(
    customTabsSource,
    'activeIcon: PROFILE_TAB_METADATA.activeIcon',
    'custom tab capability-aware active icon',
  );
  assertIncludes(
    customTabsSource,
    'inactiveIcon: PROFILE_TAB_METADATA.inactiveIcon',
    'custom tab capability-aware inactive icon',
  );

  const nativeTabsSource = sourceBetween(
    layoutSource,
    'const NATIVE_TAB_CONFIG',
    'const PANEL_HEIGHT',
    'native tab configuration',
  );
  assertIncludes(nativeTabsSource, 'profile: {', 'native profile route metadata');
  assertIncludes(
    nativeTabsSource,
    'label: PROFILE_TAB_METADATA.label',
    'native tab capability-aware label',
  );
  assertIncludes(
    nativeTabsSource,
    'sf: PROFILE_TAB_METADATA.sf',
    'native tab capability-aware symbol',
  );

  for (const expected of [
    "index: { label: 'Главная'",
    "prayers: { label: 'Молитвы'",
    "events: { label: 'События'",
    "contacts: { label: 'Контакты'",
  ]) {
    assertIncludes(customTabsSource, expected, `custom tab preserved: ${expected}`);
    assertIncludes(nativeTabsSource, expected, `native tab preserved: ${expected}`);
  }
}

function validateGuestAccountBranch() {
  assertIncludes(
    profileSource,
    "import { appCapabilities } from '@/config/appCapabilities';",
    'profile uses canonical app capabilities',
  );
  assertExcludes(
    profileSource,
    'EXPO_PUBLIC_APP_ACCESS_MODE',
    'profile does not parse the access-mode environment',
  );
  assertIncludes(
    profileSource,
    'return appCapabilities.isGuestOnly',
    'guest profile branch',
  );
  assertIncludes(profileSource, '? <GuestSettingsShell />', 'guest settings render');
  assertIncludes(profileSource, ': <AccountProfileScreen />', 'account profile render');
  assertIncludes(profileSource, 'function AccountProfileScreen()', 'isolated account profile component');

  const branchSource = sourceBetween(
    profileSource,
    'export default function ProfileScreen()',
    'function AccountProfileScreen()',
    'profile capability branch',
  );
  assertExcludes(branchSource, 'AuthCard', 'guest branch AuthCard render');
  assertExcludes(branchSource, 'useAuthStore', 'guest branch auth state');
}

function validateGuestShellDependenciesAndCopy() {
  for (const forbiddenDependency of [
    'useAuthStore',
    'AuthCard',
    'useEventsStore',
    'authService',
    'authApiService',
    'inviteService',
  ]) {
    assertExcludes(
      guestShellSource,
      forbiddenDependency,
      `guest shell dependency ${forbiddenDependency}`,
    );
  }

  for (const forbiddenAction of [
    'loadSession',
    'signIn',
    'signUp',
    'signOut',
    'loadMembership',
    'loadMyRegistrations',
    'acceptInvite',
    'updateProfile',
    'refreshProfileAvatar',
  ]) {
    assertExcludes(
      guestShellSource,
      forbiddenAction,
      `guest shell account action ${forbiddenAction}`,
    );
  }

  for (const forbiddenCopy of [
    'Войти',
    'Регистрация',
    'Создать аккаунт',
    'Email',
    'Пароль',
    'Забыли пароль',
    'Apple ID',
    'Google',
    'Аккаунт',
    'Безопасность',
    'Выйти',
    'Приглашение',
    'Участник',
    'Мои записи',
    'Завершите профиль',
  ]) {
    assertExcludes(
      guestShellSource,
      forbiddenCopy,
      `guest shell account copy ${forbiddenCopy}`,
    );
  }
}

function validateGuestSafeRoutes() {
  for (const allowedRoute of [
    '/profile/prayer-tracker',
    '/profile/notifications',
    '/profile/prayers-settings',
    '/profile/about',
    '/profile/support',
  ]) {
    assertIncludes(guestShellSource, allowedRoute, `guest shell route ${allowedRoute}`);
  }

  for (const forbiddenRoute of [
    '/profile/edit',
    '/profile/onboarding',
    '/profile/my-registrations',
  ]) {
    assertExcludes(guestShellSource, forbiddenRoute, `guest shell route ${forbiddenRoute}`);
  }
}

function validateLocalCityBoundary() {
  assertIncludes(guestShellSource, 'useSettingsStore', 'guest shell local settings store');
  assertIncludes(guestShellSource, 'state.city', 'guest shell local city');
  assertIncludes(guestShellSource, 'state.customGpsLocation', 'guest shell custom GPS city');
  assertIncludes(guestShellSource, 'state.zmanimSource', 'guest shell zmanim source');
  assertIncludes(guestShellSource, '/modals/city-picker', 'guest shell existing city picker');
  assertIncludes(guestShellSource, 'rightText={effectiveCity}', 'guest shell effective city display');

  for (const forbiddenPersistence of [
    'SecureStore',
    'SQLite',
    'localStorage',
    'createJSONStorage',
    'preferencesRepository',
  ]) {
    assertExcludes(
      guestShellSource,
      forbiddenPersistence,
      `guest shell persistence ${forbiddenPersistence}`,
    );
  }
}

function validateRouteGuardPreservation() {
  assertExcludes(
    routeGuardSource,
    "'profile/notifications'",
    'guest notifications route is no longer blocked',
  );
  assertExcludes(
    routeGuardSource,
    "'profile/prayers-settings'",
    'guest prayer settings route is no longer blocked',
  );

  for (const blockedRoute of [
    'profile/edit',
    'profile/onboarding',
    'profile/my-registrations',
  ]) {
    assertIncludes(routeGuardSource, `'${blockedRoute}'`, `guest route remains blocked: ${blockedRoute}`);
  }
}

function validateAccountProfilePreservation() {
  const accountSource = profileSource.slice(profileSource.indexOf('function AccountProfileScreen()'));

  for (const [expected, description] of [
    ['<AuthCard', 'signed-out auth card'],
    ['membership', 'membership state'],
    ['acceptInvite', 'invite acceptance'],
    ['signOut', 'sign out'],
    ['loadMyRegistrations', 'my registrations loading'],
    ['myRegistrationsHref', 'my registrations route'],
    ['refreshProfileAvatar', 'profile avatar refresh'],
    ['loadEvents()', 'event refresh'],
  ]) {
    assertIncludes(accountSource, expected, `account profile preserves ${description}`);
  }
}

function sourceBetween(source, startMarker, endMarker, description) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);

  assertEqual(start >= 0 && end > start, true, description);
  return source.slice(start, end);
}

function readSource(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
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
