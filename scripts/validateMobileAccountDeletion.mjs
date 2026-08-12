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

const files = {
  edit: source('app/profile/edit.tsx'),
  flow: source('src/components/profile/DeleteAccountFlow.tsx'),
  privacyApi: source('src/services/privacyApiService.ts'),
  privacyService: source('src/services/privacyService.ts'),
  privacyTypes: source('src/types/privacy.ts'),
  authStore: source('src/store/useAuthStore.ts'),
  guestSettings: source('src/components/settings/GuestSettingsShell.tsx'),
};

validateScreenAndFlow();
validateCredentialBoundaries();
validateLocalCleanup();
validateGuestAndPrayerBoundaries();
await validateServiceRequests();

process.stdout.write('Mobile account deletion validation passed\n');

function validateScreenAndFlow() {
  assertEqual(
    fs.existsSync(path.join(repoRoot, 'app/profile/security.tsx')),
    false,
    'obsolete Security screen is removed',
  );
  assertIncludes(files.edit, "import { DeleteAccountFlow }", 'Edit screen imports deletion flow');
  assertIncludes(files.edit, 'setIsDeleteFlowOpen(true)', 'delete row opens real flow');
  assertIncludes(files.edit, 'accountEmail={accountEmail}', 'canonical account email is passed to flow');
  assertIncludes(files.edit, "const accountEmail = user?.email ?? ''", 'auth account email is canonical');
  assertIncludes(files.edit, 'Удаление аккаунта и персональных данных', 'delete row has final subtitle');
  assertExcludes(files.edit, 'Удаление аккаунта будет добавлено позже', 'account deletion placeholder removed');
  assertIncludes(files.flow, 'Email используется только для подтверждения и не редактируется.', 'email is displayed read-only');
  assertExcludes(files.flow, 'onChangeText={setAccountEmail}', 'account email cannot be edited');
  assertIncludes(files.flow, "maxLength={6}", 'verification code max length');
  assertIncludes(files.flow, 'keyboardType="number-pad"', 'numeric code keyboard');
  assertIncludes(files.flow, 'textContentType="oneTimeCode"', 'iOS one-time-code semantics');
  assertIncludes(files.flow, "!/^\\d{6}$/.test(code)", 'code must contain exactly six digits');
  assertIncludes(files.flow, "style: 'destructive'", 'native destructive confirmation');
  assertIncludes(files.privacyApi, "request_type: 'deletion'", 'deletion request payload');
  assertIncludes(files.flow, 'requestIdRef.current = requestId', 'request ID retained in component memory');
  assertIncludes(files.flow, 'if (!requestId)', 'retry does not blindly recreate request');
  assertIncludes(files.flow, "lifecycle.state !== 'deletion_pending'", 'deletion_pending is required for success');
  assertIncludes(files.flow, "codeValue === 'privacy_erasure_manual_review_required'", 'manual review is handled explicitly');
  assertIncludes(files.flow, 'Доступ к вашему аккаунту пока сохранён.', 'manual review preserves account access');
  assertIncludes(files.flow, 'Неверный или просроченный код.', 'invalid code has safe Russian error');
  assertIncludes(files.flow, 'Сеанс подтверждения истёк. Получите новый код и попробуйте снова.', 'privacy session expiry is safe');
  assertIncludes(files.flow, 'accessibilityLiveRegion="assertive"', 'errors are announced accessibly');
  assertIncludes(files.flow, 'codeInputRef.current?.focus()', 'code input receives focus');
  assertExcludes(files.flow, 'Аккаунт удалён', 'UI does not claim hard deletion completed');
  assertExcludes(files.flow, 'Все данные удалены', 'UI does not claim all data was deleted');
}

function validateCredentialBoundaries() {
  const runtimeCredentialSources = [files.edit, files.flow, files.privacyApi, files.privacyService];
  const forbiddenPersistenceOrLogging = [
    'SecureStore',
    ['Async', 'Storage'].join(''),
    ['local', 'Storage'].join(''),
    ['session', 'Storage'].join(''),
    ['console', 'log'].join('.'),
    ['console', 'info'].join('.'),
    'setApiAuthTokens',
    'router.push',
  ];

  for (const forbidden of forbiddenPersistenceOrLogging) {
    for (const runtimeSource of runtimeCredentialSources) {
      assertExcludes(runtimeSource, forbidden, `privacy credentials avoid ${forbidden}`);
    }
  }

  assertIncludes(files.flow, 'privacySessionTokenRef = useRef<string | null>(null)', 'privacy token remains in runtime memory');
  assertIncludes(files.privacyApi, "headers: privacySessionHeaders(privacySessionToken)", 'privacy bearer header is explicit');
  assertCountAtLeast(files.privacyApi, 'includeAuthToken: false', 4, 'all unauthenticated/privacy-session calls disable normal auth');
}

function validateLocalCleanup() {
  const cleanupAction = extractBetween(
    files.authStore,
    'clearLocalSessionAfterAccountDeletion: async () => {',
    '  signOut: async () => {',
  );
  const signOutAction = extractBetween(files.authStore, 'signOut: async () => {', '}));');
  const contactCleanupHelper = extractBetween(
    files.authStore,
    'async function resetCommunityContactsAfterAccountDeletion()',
    'async function resetPrayerTrackerMemoryAfterAccountDeletion()',
  );
  const prayerCleanupHelper = extractBetween(
    files.authStore,
    'async function resetPrayerTrackerMemoryAfterAccountDeletion()',
    'async function loadProfileOrCreate()',
  );

  assertIncludes(cleanupAction, 'beginAuthOperation()', 'deletion cleanup invalidates stale auth operations');
  assertIncludes(cleanupAction, 'Promise.allSettled([', 'deletion cleanup attempts all steps independently');
  assertIncludes(cleanupAction, 'clearApiAuthTokens()', 'deletion cleanup clears stored API credentials');
  assertIncludes(cleanupAction, 'resetEventPrivateStateAfterAccountDeletion()', 'deletion cleanup clears private event state');
  assertIncludes(cleanupAction, 'resetCommunityContactsAfterAccountDeletion()', 'deletion cleanup clears community contacts');
  assertIncludes(cleanupAction, 'resetPrayerTrackerMemoryAfterAccountDeletion()', 'deletion cleanup clears prayer tracker memory');
  assertIncludes(cleanupAction, 'clearAvatarReadUrlMemoryCache()', 'deletion cleanup clears avatar cache');
  assertIncludes(cleanupAction, 'authOperationGuards.invalidateAuthOperations()', 'late auth operations are invalidated after cleanup attempts');
  assertIncludes(cleanupAction, 'session: null', 'deletion cleanup clears auth session');
  assertIncludes(cleanupAction, 'user: null', 'deletion cleanup clears auth user');
  assertIncludes(cleanupAction, 'profile: null', 'deletion cleanup clears profile');
  assertIncludes(cleanupAction, 'membership: null', 'deletion cleanup clears membership');
  assertIncludes(cleanupAction, 'loading: false', 'deletion cleanup clears loading state');
  assertIncludes(cleanupAction, 'error: null', 'deletion cleanup clears auth error state');
  assertExcludes(cleanupAction, 'return;', 'deletion cleanup cannot return before clearing auth state');
  assertExcludes(cleanupAction, 'signOutService', 'deletion cleanup makes no remote sign-out request');
  assertBefore(cleanupAction, 'Promise.allSettled([', 'session: null', 'auth state clears after all cleanup attempts settle');
  assertBefore(cleanupAction, 'session: null', "throw new Error('Local account cleanup", 'aggregate failure is reported only after auth state clears');

  assertIncludes(contactCleanupHelper, "import('@/store/useContactsStore')", 'contact cleanup dynamically imports the account contact store');
  assertIncludes(contactCleanupHelper, 'resetCommunityContacts()', 'contact cleanup uses the existing community-only reset');
  assertExcludes(contactCleanupHelper, 'delete', 'contact cleanup does not delete local iPhone contacts');
  assertExcludes(contactCleanupHelper, 'remove', 'contact cleanup does not remove local iPhone contacts');

  assertIncludes(prayerCleanupHelper, "import('@/store/usePrayerTrackerStore')", 'prayer cleanup dynamically imports the tracker store');
  assertIncludes(prayerCleanupHelper, 'getState().reset()', 'prayer cleanup uses the existing in-memory reset');
  assertExcludes(prayerCleanupHelper, 'Service', 'prayer cleanup does not call a prayer service');
  assertExcludes(prayerCleanupHelper, 'apiClient', 'prayer cleanup does not call an API');
  assertExcludes(prayerCleanupHelper, '.load', 'prayer cleanup does not read prayer data');

  assertIncludes(signOutAction, 'await signOutService()', 'ordinary sign-out still uses remote sign-out');
  assertExcludes(signOutAction, 'resetCommunityContactsAfterAccountDeletion', 'ordinary sign-out behavior is unchanged');
  assertExcludes(signOutAction, 'resetPrayerTrackerMemoryAfterAccountDeletion', 'ordinary sign-out does not gain deletion-only cleanup');
  assertIncludes(files.edit, 'await clearLocalSessionAfterAccountDeletion()', 'deletion_pending triggers local cleanup');
  assertIncludes(files.edit, 'finally {\n      router.replace(profileHref);', 'signed-out Profile routing survives local cleanup failure');

  const submitDeletion = extractBetween(
    files.flow,
    'const submitDeletion = useCallback(async () => {',
    '\n  const showDestructiveConfirmation',
  );
  const serverPhase = extractBetween(
    submitDeletion,
    'let deletionPendingConfirmed = false;',
    'if (!deletionPendingConfirmed)',
  );
  const postSuccessPhase = extractBetween(
    submitDeletion,
    'if (!deletionPendingConfirmed)',
    '}, [onDeletionPending, returnToVerificationAfterExpiredSession]);',
  );

  assertExcludes(serverPhase, 'onDeletionPending', 'local cleanup failure cannot enter server erasure error handling');
  assertIncludes(postSuccessPhase, 'privacySessionTokenRef.current = null', 'server success clears the privacy token');
  assertIncludes(postSuccessPhase, "setStep('success')", 'server success remains a success state');
  assertIncludes(postSuccessPhase, 'await onDeletionPending()', 'local cleanup runs after server success handling');
  assertIncludes(postSuccessPhase, '} catch {', 'post-success cleanup failure is contained separately');
  assertExcludes(postSuccessPhase, 'returnToVerificationAfterExpiredSession', 'cleanup failure cannot restore verification state');
  assertExcludes(postSuccessPhase, "setStep('manual_review')", 'cleanup failure cannot become manual review');
  assertExcludes(postSuccessPhase, 'Не удалось подтвердить удаление аккаунта', 'cleanup failure cannot claim server erasure failed');
}

function validateGuestAndPrayerBoundaries() {
  assertExcludes(files.guestSettings, 'DeleteAccountFlow', 'guest Settings shell does not expose deletion flow');
  assertExcludes(files.guestSettings, '/privacy/', 'guest Settings shell sends no privacy request');

  const privatePrayerTable = ['prayer', 'activity', 'logs'].join('_');
  for (const [name, runtimeSource] of Object.entries({
    edit: files.edit,
    flow: files.flow,
    privacyApi: files.privacyApi,
    privacyService: files.privacyService,
    authStore: files.authStore,
  })) {
    assertExcludes(runtimeSource, privatePrayerTable, `${name} does not query or display prayer activity data`);
  }
}

async function validateServiceRequests() {
  const calls = [];
  const privacyTokenKey = ['privacy', 'session', 'token'].join('_');
  const responses = {
    '/privacy/access/request': { accepted: true },
    '/privacy/access/confirm': {
      [privacyTokenKey]: 'runtime-only-privacy-token',
      token_type: 'bearer',
      scope: 'privacy_self_service',
      expires_at: '2026-08-12T12:00:00Z',
    },
    '/privacy/requests': {
      community_id: null,
      created_at: '2026-08-12T10:00:00Z',
      id: 'privacy-request-id',
      message: null,
      request_type: 'deletion',
      resolved_at: null,
      resolution_note: null,
      status: 'open',
      updated_at: '2026-08-12T10:00:00Z',
    },
    '/privacy/requests/privacy-request-id/confirm-erasure': {
      request_id: 'privacy-request-id',
      state: 'deletion_pending',
      processing_stopped_at: '2026-08-12T10:01:00Z',
      cancelled_at: null,
      registrations_require_reregistration_after_cancel: true,
    },
  };

  const originalLoad = Module._load;
  const originalResolveFilename = Module._resolveFilename;
  Module._extensions['.ts'] = compileTypeScriptModule;
  Module._resolveFilename = function resolveAlias(request, parent, isMain, options) {
    if (request.startsWith('@/')) {
      return originalResolveFilename.call(
        this,
        path.join(repoRoot, 'src', request.slice(2)),
        parent,
        isMain,
        options,
      );
    }

    return originalResolveFilename.call(this, request, parent, isMain, options);
  };
  Module._load = function loadWithApiStub(request, parent, isMain) {
    if (request === './apiClient' && parent?.filename?.endsWith('privacyApiService.ts')) {
      return {
        apiClient: {
          post: async (requestPath, body, options) => {
            calls.push({ path: requestPath, body, options });
            return responses[requestPath];
          },
        },
      };
    }

    return originalLoad.call(this, request, parent, isMain);
  };

  try {
    const api = require(path.join(repoRoot, 'src/services/privacyApiService.ts'));
    const accepted = await api.requestPrivacyAccessCodeViaApi(' USER@Example.com ');
    const session = await api.confirmPrivacyAccessCodeViaApi('USER@example.com', '123456');
    const request = await api.createDeletionPrivacyRequestViaApi(session.privacySessionToken);
    const lifecycle = await api.confirmPrivacyErasureViaApi(request.id, session.privacySessionToken);

    assertEqual(accepted.accepted, true, 'privacy access accepted response');
    assertEqual(session.scope, 'privacy_self_service', 'privacy session scope normalization');
    assertEqual(lifecycle.state, 'deletion_pending', 'erasure lifecycle normalization');
    assertDeepEqual(calls[0], {
      path: '/privacy/access/request',
      body: { email: 'user@example.com' },
      options: { includeAuthToken: false },
    }, 'privacy access request contract');
    assertDeepEqual(calls[1], {
      path: '/privacy/access/confirm',
      body: { email: 'user@example.com', code: '123456' },
      options: { includeAuthToken: false },
    }, 'privacy access confirm contract');
    assertDeepEqual(calls[2], {
      path: '/privacy/requests',
      body: { request_type: 'deletion' },
      options: {
        headers: { Authorization: 'Bearer runtime-only-privacy-token' },
        includeAuthToken: false,
      },
    }, 'verified deletion request contract');
    assertDeepEqual(calls[3], {
      path: '/privacy/requests/privacy-request-id/confirm-erasure',
      body: { confirmation: 'delete_my_data' },
      options: {
        headers: { Authorization: 'Bearer runtime-only-privacy-token' },
        includeAuthToken: false,
      },
    }, 'confirm-erasure contract');

    await assertRejects(
      () => api.confirmPrivacyAccessCodeViaApi('user@example.com', '12345'),
      'invalid five-digit code is rejected before network',
    );
    assertEqual(calls.length, 4, 'invalid code does not send a request');
  } finally {
    Module._load = originalLoad;
    Module._resolveFilename = originalResolveFilename;
    delete require.cache[path.join(repoRoot, 'src/services/privacyApiService.ts')];
  }
}

function source(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function compileTypeScriptModule(module, filename) {
  const sourceText = fs.readFileSync(filename, 'utf8');
  const { outputText } = ts.transpileModule(sourceText, {
    compilerOptions: {
      esModuleInterop: true,
      jsx: ts.JsxEmit.ReactJSX,
      module: ts.ModuleKind.CommonJS,
      moduleResolution: ts.ModuleResolutionKind.NodeJs,
      target: ts.ScriptTarget.ES2020,
    },
    fileName: filename,
  });

  module._compile(outputText, filename);
}

function extractBetween(value, start, end) {
  const startIndex = value.indexOf(start);
  const endIndex = value.indexOf(end, startIndex + start.length);

  if (startIndex < 0 || endIndex < 0) {
    fail(`Could not extract source between ${JSON.stringify(start)} and ${JSON.stringify(end)}`);
  }

  return value.slice(startIndex, endIndex);
}

function assertIncludes(value, expected, description) {
  if (!value.includes(expected)) {
    fail(`${description}: expected ${JSON.stringify(expected)}`);
  }
}

function assertExcludes(value, forbidden, description) {
  if (value.includes(forbidden)) {
    fail(`${description}: found forbidden ${JSON.stringify(forbidden)}`);
  }
}

function assertCountAtLeast(value, needle, expected, description) {
  const actual = value.split(needle).length - 1;
  if (actual < expected) {
    fail(`${description}: expected at least ${expected}, got ${actual}`);
  }
}

function assertBefore(value, first, second, description) {
  const firstIndex = value.indexOf(first);
  const secondIndex = value.indexOf(second);

  if (firstIndex < 0 || secondIndex < 0 || firstIndex >= secondIndex) {
    fail(`${description}: expected ${JSON.stringify(first)} before ${JSON.stringify(second)}`);
  }
}

function assertEqual(actual, expected, description) {
  if (actual !== expected) {
    fail(`${description}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assertDeepEqual(actual, expected, description) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    fail(`${description}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

async function assertRejects(action, description) {
  try {
    await action();
  } catch {
    return;
  }

  fail(`${description}: expected rejection`);
}

function fail(message) {
  console.error(`Mobile account deletion validation failed: ${message}`);
  process.exit(1);
}
