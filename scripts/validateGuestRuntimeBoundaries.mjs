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
const capabilitiesPath = path.join(repoRoot, 'src/config/appCapabilities.ts');

const secureStorage = new Map();
const secureStoreCalls = { delete: 0, get: 0, set: 0 };
let deferredSecureDelete = null;
let activeStubs = new Map();

registerProductionDependencyStubs();
registerTypeScriptRequireHook();
registerSourceAliasResolver();

await validateCapabilityResolution();
await validateTokenAndApiBoundaries();
await validateAuthStoreBoundaries();
await validateCommunityBoundaries();
validateRouteGuard();
validateRuntimeSourceBoundaries();

console.log('Guest runtime boundary validation passed');

async function validateCapabilityResolution() {
  const { resolveAppCapabilities } = loadCapabilities();
  const cases = [
    [undefined, 'guest_only'],
    ['invalid', 'guest_only'],
    ['guest_only', 'guest_only'],
    ['account', 'account'],
  ];

  for (const [value, expected] of cases) {
    assertEqual(
      resolveAppCapabilities(value, undefined).appAccessMode,
      expected,
      `capability resolution for ${String(value)}`,
    );
  }
}

async function validateTokenAndApiBoundaries() {
  const staleTokens = createTokens('stale-access-token', 'stale-refresh-token');
  const tokenKey = 'sredi-svoih.apiAuthTokens.v1';
  const originalConsole = {
    debug: console.debug,
    error: console.error,
    info: console.info,
    log: console.log,
    warn: console.warn,
  };
  const loggedValues = [];

  for (const method of Object.keys(originalConsole)) {
    console[method] = (...values) => loggedValues.push(...values.map(String));
  }

  try {
    resetSecureStorage();
    secureStorage.set(tokenKey, JSON.stringify(staleTokens));
    const guestTokenStore = loadTokenStore('guest_only');

    assertEqual(await guestTokenStore.getApiAuthTokens(), null, 'guest stored tokens fail closed');
    assertEqual(await guestTokenStore.getApiAccessToken(), null, 'guest access token fails closed');
    assertEqual(secureStoreCalls.get, 0, 'guest token reads do not inspect stale storage');

    deferredSecureDelete = deferred();
    const cleanup = guestTokenStore.clearGuestApiAuthTokens();
    const concurrentCleanup = guestTokenStore.clearGuestApiAuthTokens();

    assertEqual(cleanup, concurrentCleanup, 'guest cleanup shares one active promise');
    assertEqual(await guestTokenStore.getApiAccessToken(), null, 'guest token stays null during cleanup');
    assertEqual(secureStoreCalls.delete, 1, 'guest cleanup has one active deletion');
    deferredSecureDelete.resolve();
    await cleanup;
    deferredSecureDelete = null;

    assertEqual(secureStorage.has(tokenKey), false, 'guest cleanup removes stale credentials');
    secureStorage.set(tokenKey, JSON.stringify(staleTokens));
    await guestTokenStore.clearGuestApiAuthTokens();
    assertEqual(secureStoreCalls.delete, 2, 'guest cleanup can remove reappeared credentials');
    assertEqual(secureStorage.has(tokenKey), false, 'reappeared guest credentials are removed');

    secureStorage.set(tokenKey, JSON.stringify(staleTokens));
    deferredSecureDelete = deferred();
    const failedCleanup = guestTokenStore.clearGuestApiAuthTokens();
    deferredSecureDelete.reject(new Error('synthetic cleanup failure'));
    await assertRejectsMessage(
      () => failedCleanup,
      'synthetic cleanup failure',
      'guest cleanup failure remains local',
    );
    deferredSecureDelete = null;
    assertEqual(
      await guestTokenStore.getApiAccessToken(),
      null,
      'guest token stays fail closed after cleanup failure',
    );

    await assertRejectsMessage(
      () => guestTokenStore.setApiAuthTokens(staleTokens),
      guestTokenStore.GUEST_MODE_TOKEN_STORAGE_BLOCKED,
      'guest token persistence rejection',
    );
    assertEqual(secureStoreCalls.set, 0, 'guest token persistence does not write');

    secureStorage.set(tokenKey, JSON.stringify(staleTokens));
    const guestRequest = await performFakeApiRequest('guest_only');
    assertEqual(guestRequest.result.ok, true, 'guest public request remains available');
    assertEqual(
      Object.prototype.hasOwnProperty.call(guestRequest.headers, 'Authorization'),
      false,
      'guest public request omits Authorization',
    );

    const accountTokenStore = loadTokenStore('account');
    assertEqual(
      await accountTokenStore.getApiAccessToken(),
      staleTokens.access_token,
      'account stored access token regression',
    );
    const accountRequest = await performFakeApiRequest('account');
    assertEqual(
      accountRequest.headers.Authorization,
      `Bearer ${staleTokens.access_token}`,
      'account API bearer regression',
    );
  } finally {
    Object.assign(console, originalConsole);
  }

  const logOutput = loggedValues.join('\n');
  assertEqual(logOutput.includes(staleTokens.access_token), false, 'access token is never logged');
  assertEqual(logOutput.includes(staleTokens.refresh_token), false, 'refresh token is never logged');
}

async function performFakeApiRequest(mode) {
  setAccessMode(mode);
  clearSourceModule('src/config/appCapabilities.ts');
  clearSourceModule('src/services/apiAuthTokenStore.ts');
  clearSourceModule('src/services/apiClient.ts');
  process.env.EXPO_PUBLIC_API_URL = 'https://api.example.test';

  let requestHeaders = null;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    requestHeaders = options.headers;
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ data: { ok: true }, error: null, meta: {} }),
    };
  };

  try {
    const { apiClient } = require(sourcePath('src/services/apiClient.ts'));
    const result = await apiClient.get('/events');
    return { headers: requestHeaders, result };
  } finally {
    globalThis.fetch = originalFetch;
  }
}

async function validateAuthStoreBoundaries() {
  const guestSpies = createAuthSpies();
  const guestAuthStore = loadAuthStore('guest_only', guestSpies);
  const staleSession = createSession('stale-user');
  const staleProfile = createProfile('stale-user');

  guestAuthStore.setState({
    session: staleSession,
    user: staleSession.user,
    profile: staleProfile,
    membership: { id: 'stale-membership' },
    loading: true,
    error: 'stale-error',
  });

  await guestAuthStore.getState().loadSession();
  assertNullAuthState(guestAuthStore.getState(), 'guest loadSession');
  assertEqual(guestSpies.calls.getSession, 0, 'guest loadSession service isolation');
  assertEqual(guestSpies.calls.loadProfile, 0, 'guest profile bootstrap isolation');
  assertEqual(guestSpies.calls.loadMembership, 0, 'guest membership bootstrap isolation');

  const rejectedActions = [
    ['loadProfile', () => guestAuthStore.getState().loadProfile()],
    ['updateProfile', () => guestAuthStore.getState().updateProfile({ display_name: 'Guest' })],
    ['loadMembership', () => guestAuthStore.getState().loadMembership()],
    ['acceptInvite', () => guestAuthStore.getState().acceptInvite('INVITE')],
    ['signIn', () => guestAuthStore.getState().signIn('guest@example.test', 'password')],
    ['signInWithApple', () => guestAuthStore.getState().signInWithApple()],
    ['signInWithGoogle', () => guestAuthStore.getState().signInWithGoogle()],
    ['signUpWithEmail', () => guestAuthStore.getState().signUpWithEmail('guest@example.test', 'password')],
    ['resendConfirmationEmail', () => guestAuthStore.getState().resendConfirmationEmail('guest@example.test')],
    ['resetPasswordForEmail', () => guestAuthStore.getState().resetPasswordForEmail('guest@example.test')],
    ['refreshProfileAvatar', () => guestAuthStore.getState().refreshProfileAvatar()],
  ];

  for (const [name, operation] of rejectedActions) {
    await assertRejectsMessage(
      operation,
      'guest_mode_account_action_blocked',
      `guest ${name} rejection`,
    );
  }

  assertAccountServiceCalls(guestSpies.calls, 0, 'guest auth actions');
  const clearsBeforeSignOut = guestSpies.calls.clearTokens;
  guestAuthStore.setState({
    session: staleSession,
    user: staleSession.user,
    profile: staleProfile,
    membership: { id: 'stale-membership' },
  });
  await guestAuthStore.getState().signOut();
  assertEqual(guestSpies.calls.signOut, 0, 'guest signOut skips remote service');
  assertEqual(
    guestSpies.calls.clearTokens,
    clearsBeforeSignOut + 1,
    'guest signOut clears local credentials',
  );
  assertNullAuthState(guestAuthStore.getState(), 'guest signOut');

  const accountSpies = createAuthSpies();
  const accountAuthStore = loadAuthStore('account', accountSpies);
  await accountAuthStore.getState().loadSession();
  assertEqual(accountSpies.calls.getSession, 1, 'account loadSession invokes auth service');
  await accountAuthStore.getState().signIn('account@example.test', 'password');
  assertEqual(accountSpies.calls.signIn, 1, 'account signIn invokes auth service');
}

async function validateCommunityBoundaries() {
  const guestAdapterCalls = { community: 0 };
  activeStubs = new Map([
    ['./communityContactsApiService', {
      async listCommunityContactsFromApi() {
        guestAdapterCalls.community += 1;
        return [{ id: 'private-contact' }];
      },
    }],
  ]);
  const guestService = loadModuleForMode('src/services/communityContactsService.ts', 'guest_only');
  assertDeepEqual(await guestService.listCommunityContacts(), [], 'guest service returns no community contacts');
  assertEqual(guestAdapterCalls.community, 0, 'guest service skips community API import');

  const accountAdapterCalls = { community: 0 };
  activeStubs = new Map([
    ['./communityContactsApiService', {
      async listCommunityContactsFromApi() {
        accountAdapterCalls.community += 1;
        return [{ id: 'account-contact' }];
      },
    }],
  ]);
  const accountService = loadModuleForMode('src/services/communityContactsService.ts', 'account');
  assertDeepEqual(
    await accountService.listCommunityContacts(),
    [{ id: 'account-contact' }],
    'account service preserves community adapter',
  );
  assertEqual(accountAdapterCalls.community, 1, 'account service calls community API adapter');

  const guestStoreSpies = createContactsSpies();
  const guestContactsStore = loadContactsStore('guest_only', guestStoreSpies);
  guestContactsStore.setState({ communityContacts: [{ id: 'stale-contact' }] });
  await guestContactsStore.getState().loadCommunityContacts();
  assertEqual(guestStoreSpies.calls.community, 0, 'guest loadCommunityContacts skips adapter');
  assertDeepEqual(guestContactsStore.getState().communityContacts, [], 'guest load clears stale community state');

  guestContactsStore.setState({ localContactsPermission: 'granted' });
  await guestContactsStore.getState().refreshAll();
  assertEqual(guestStoreSpies.calls.community, 0, 'guest refreshAll skips community adapter');
  assertEqual(guestStoreSpies.calls.local, 1, 'guest refreshAll preserves granted local refresh');
  assertDeepEqual(guestContactsStore.getState().communityContacts, [], 'guest refresh keeps community empty');

  const accountStoreSpies = createContactsSpies();
  const accountContactsStore = loadContactsStore('account', accountStoreSpies);
  await accountContactsStore.getState().loadCommunityContacts();
  assertEqual(accountStoreSpies.calls.community, 1, 'account contacts store calls community adapter');

  const staleResponse = deferred();
  accountStoreSpies.communityDeferred = staleResponse;
  const staleLoad = accountContactsStore.getState().loadCommunityContacts();
  await Promise.resolve();
  accountContactsStore.getState().resetCommunityContacts();
  staleResponse.resolve([{ id: 'late-private-contact' }]);
  await staleLoad;
  assertDeepEqual(
    accountContactsStore.getState().communityContacts,
    [],
    'stale community response cannot repopulate reset state',
  );

  await validateStaleRefreshAfterNewerCommunityCommit();
  await validateStaleRefreshPreservesNewerCommunityLoading();
}

async function validateStaleRefreshAfterNewerCommunityCommit() {
  const spies = createContactsSpies();
  const store = loadContactsStore('account', spies);
  const oldRefreshResponse = deferred();
  const newLoadResponse = deferred();
  const oldContacts = [{ id: 'old-refresh-contact' }];
  const newContacts = [{ id: 'new-load-contact' }];
  spies.communityDeferredQueue.push(oldRefreshResponse, newLoadResponse);

  const staleRefresh = store.getState().refreshAll();
  await Promise.resolve();
  const newerLoad = store.getState().loadCommunityContacts();
  await Promise.resolve();

  newLoadResponse.resolve(newContacts);
  await newerLoad;
  assertDeepEqual(
    store.getState().communityContacts,
    newContacts,
    'newer community load commits before stale refresh',
  );

  oldRefreshResponse.resolve(oldContacts);
  await staleRefresh;
  assertDeepEqual(
    store.getState().communityContacts,
    newContacts,
    'stale refresh preserves newer committed community contacts',
  );
  assertEqual(
    store.getState().loadingCommunity,
    false,
    'newer completed request controls settled community loading state',
  );
}

async function validateStaleRefreshPreservesNewerCommunityLoading() {
  const spies = createContactsSpies();
  const store = loadContactsStore('account', spies);
  const oldRefreshResponse = deferred();
  const newLoadResponse = deferred();
  const newContacts = [{ id: 'new-in-flight-contact' }];
  spies.communityDeferredQueue.push(oldRefreshResponse, newLoadResponse);

  const staleRefresh = store.getState().refreshAll();
  await Promise.resolve();
  const newerLoad = store.getState().loadCommunityContacts();
  await Promise.resolve();

  oldRefreshResponse.resolve([{ id: 'old-in-flight-contact' }]);
  await staleRefresh;
  assertEqual(
    store.getState().loadingCommunity,
    true,
    'stale refresh does not settle newer community loading state',
  );

  newLoadResponse.resolve(newContacts);
  await newerLoad;
  assertEqual(
    store.getState().loadingCommunity,
    false,
    'newer community request settles its loading state',
  );
  assertDeepEqual(
    store.getState().communityContacts,
    newContacts,
    'newer in-flight community request remains authoritative',
  );
}

function validateRouteGuard() {
  const { resolveAppCapabilities } = loadCapabilities();
  const guest = resolveAppCapabilities('guest_only', 'disabled');
  const account = resolveAppCapabilities('account', 'disabled');
  const { isGuestBlockedPathname, normalizeAppPathname } = require(
    sourcePath('src/navigation/guestRouteGuard.ts'),
  );
  const blocked = [
    '/profile/security',
    '/profile/edit',
    '/profile/onboarding',
    '/profile/my-registrations',
    '/profile/my-events',
    '/profile/past-registrations',
    '/profile/registration-groups/event-id',
    '/contacts/community/abc',
    '/contacts/abc',
  ];
  const allowed = [
    '/',
    '/contacts',
    '/contacts/iphone/abc',
    '/profile/prayer-tracker',
    '/profile/notifications',
    '/profile/prayers-settings',
    '/profile/support',
    '/profile/about',
    '/events/abc',
    '/modals/omer',
  ];

  for (const pathname of blocked) {
    assertEqual(isGuestBlockedPathname(pathname, guest), true, `guest blocks ${pathname}`);
    assertEqual(isGuestBlockedPathname(`${pathname}/`, guest), true, `guest blocks trailing slash ${pathname}`);
    assertEqual(isGuestBlockedPathname(pathname, account), false, `account allows ${pathname}`);
  }

  for (const pathname of allowed) {
    assertEqual(isGuestBlockedPathname(pathname, guest), false, `guest allows ${pathname}`);
    assertEqual(isGuestBlockedPathname(pathname, account), false, `account allows ${pathname}`);
  }

  assertEqual(normalizeAppPathname('contacts//iphone/abc/?x=1'), '/contacts/iphone/abc', 'pathname normalization');
}

function validateRuntimeSourceBoundaries() {
  const layoutSource = readSource('app/_layout.tsx');
  assertIncludes(layoutSource, 'appCapabilities.isGuestOnly', 'root guest capability branch');
  assertIncludes(layoutSource, 'enterGuestMode()', 'root guest local initialization');
  assertIncludes(layoutSource, 'appCapabilities.isAccountMode', 'root account capability branch');
  assertIncludes(layoutSource, 'loadSession()', 'root account session bootstrap');
  assertIncludes(layoutSource, 'Stack.Protected', 'root protected route boundary');
  assertIncludes(layoutSource, 'GUEST_BLOCKED_ROUTE_NAMES.map', 'root centralized route classification');
  assertExcludes(layoutSource, 'EXPO_PUBLIC_APP_ACCESS_MODE', 'root direct environment parsing');

  const tokenSource = readSource('src/services/apiAuthTokenStore.ts');
  const apiClientSource = readSource('src/services/apiClient.ts');
  const communitySource = readSource('src/services/communityContactsService.ts');
  assertIncludes(tokenSource, 'if (appCapabilities.isGuestOnly)', 'token provider fail-closed branch');
  assertIncludes(apiClientSource, 'await fetch(url', 'public API client remains enabled');
  assertIncludes(communitySource, 'if (!appCapabilities.canUseAccountFeatures)', 'community capability boundary');

  const eventsSource = readSource('app/(tabs)/events.tsx');
  assertIncludes(eventsSource, "option.id !== 'members_only'", 'guest Events filters exclude members-only');
  assertMatches(
    eventsSource,
    /const ACCOUNT_EVENT_FILTERS = \[[\s\S]*?\{ id: 'members_only', title: 'Для участников' \}[\s\S]*?\] as const;/,
    'account Events filters define members-only',
  );
  assertMatches(
    eventsSource,
    /appCapabilities\.isAccountMode\s*\? ACCOUNT_EVENT_FILTERS\s*: GUEST_EVENT_FILTERS/,
    'account Events filters retain members-only',
  );
  assertMatches(
    eventsSource,
    /events\s*\.filter\(\(event\) => event\.visibility !== 'members_only'\)[\s\S]*?appCapabilities\.isAccountMode\s*\|\| publicCategorySlugs\.has/,
    'guest Events category filters stay public-event relevant',
  );
  assertMatches(
    eventsSource,
    /const seenCategorySlugs = new Set<string>\(\);[\s\S]*?\.sort\([\s\S]*?\.flatMap\(\(category\) => \{\s*const slug = normalizeFilterValue\(category\.slug\);\s*if \(seenCategorySlugs\.has\(slug\)\) \{\s*return \[\];\s*\}\s*seenCategorySlugs\.add\(slug\);[\s\S]*?id: `\$\{CATEGORY_FILTER_PREFIX\}\$\{slug\}`/,
    'Events category filters deduplicate normalized slugs after sorting',
  );
  assertMatches(
    eventsSource,
    /appCapabilities\.isGuestOnly && filter === 'members_only'\s*\? 'all'\s*: filter/,
    'guest Events normalizes stale members-only state',
  );
  assertMatches(
    eventsSource,
    /if \(!appCapabilities\.isAccountMode\) \{\s*return;\s*\}\s*void loadSession\(\)/,
    'guest Events skips session bootstrap while account mode retains it',
  );
  assertMatches(
    eventsSource,
    /if \(appCapabilities\.isAccountMode\) \{\s*await loadSession\(\);\s*\}\s*await loadEvents\(\);/,
    'guest Events refresh skips session while account refresh retains it',
  );
  assertMatches(
    eventsSource,
    /if \(\s*appCapabilities\.isAccountMode\s*&& effectiveFilter === 'members_only'[\s\S]*?return 'Войдите и примите приглашение/,
    'members-only login and invite copy remains account-only',
  );
  assertExcludes(eventsSource, 'EXPO_PUBLIC_APP_ACCESS_MODE', 'Events excludes direct environment parsing');

  const runtimeFiles = [
    'app/_layout.tsx',
    'src/services/apiAuthTokenStore.ts',
    'src/store/useAuthStore.ts',
    'src/store/useContactsStore.ts',
    'src/services/communityContactsService.ts',
    'src/navigation/guestRouteGuard.ts',
  ];
  const forbiddenEndpoints = [
    '/auth/login',
    '/auth/register',
    '/auth/me',
    '/auth/refresh',
    '/auth/logout',
    '/me/membership',
    '/me/profile',
  ];

  for (const relativePath of runtimeFiles) {
    const source = readSource(relativePath);
    for (const endpoint of forbiddenEndpoints) {
      assertExcludes(source, endpoint, `${relativePath} excludes direct ${endpoint}`);
    }
  }
}

function createAuthSpies() {
  const calls = {
    acceptInvite: 0,
    clearAvatar: 0,
    clearTokens: 0,
    getSession: 0,
    loadMembership: 0,
    loadProfile: 0,
    resendConfirmationEmail: 0,
    resetContacts: 0,
    resetEventPrivateState: 0,
    resetPasswordForEmail: 0,
    signIn: 0,
    signInWithApple: 0,
    signInWithGoogle: 0,
    signOut: 0,
    signUpWithEmail: 0,
    updateProfile: 0,
  };
  const accountSession = createSession('account-user');
  const accountProfile = createProfile('account-user');

  return {
    calls,
    modules: new Map([
      ['@/services/apiAuthTokenStore', {
        async clearGuestApiAuthTokens() { calls.clearTokens += 1; },
      }],
      ['@/services/authErrorMessages', {
        APPLE_SIGN_IN_CANCELLED_MESSAGE: 'apple_cancelled',
        AUTH_ERROR_MESSAGES: { actionFailed: 'action_failed' },
        GOOGLE_OAUTH_CANCELLED_MESSAGE: 'google_cancelled',
        getAuthErrorMessage(error) { return error instanceof Error ? error.message : 'action_failed'; },
      }],
      ['@/services/authService', {
        async getSession() { calls.getSession += 1; return null; },
        async loadProfile() { calls.loadProfile += 1; return accountProfile; },
        async resendConfirmationEmail() { calls.resendConfirmationEmail += 1; },
        async resetPasswordForEmail() { calls.resetPasswordForEmail += 1; },
        async signIn() { calls.signIn += 1; return accountSession; },
        async signInWithApple() { calls.signInWithApple += 1; return { session: accountSession }; },
        async signInWithGoogle() { calls.signInWithGoogle += 1; return accountSession; },
        async signOut() { calls.signOut += 1; },
        async signUpWithEmail() {
          calls.signUpWithEmail += 1;
          return { session: accountSession, user: accountSession.user, profile: accountProfile, needsEmailConfirmation: false };
        },
        async upsertProfile() { calls.updateProfile += 1; return accountProfile; },
      }],
      ['@/services/avatarService', {
        async clearAvatarReadUrlMemoryCache() { calls.clearAvatar += 1; },
        isApiAvatarProviderEnabled() { return false; },
        async resolveCurrentUserAvatarReadUrl() { return null; },
      }],
      ['@/services/inviteService', {
        async acceptInvite() { calls.acceptInvite += 1; },
        async loadMyMembership() { calls.loadMembership += 1; return { id: 'account-membership' }; },
      }],
      ['@/store/useEventsStore', {
        useEventsStore: { getState: () => ({ resetPrivateState: () => { calls.resetEventPrivateState += 1; } }) },
      }],
      ['@/store/useContactsStore', {
        useContactsStore: { getState: () => ({ resetCommunityContacts: () => { calls.resetContacts += 1; } }) },
      }],
    ]),
  };
}

function loadAuthStore(mode, spies) {
  activeStubs = spies.modules;
  clearSourceModule('src/store/authOperationGuards.ts');
  const authModule = loadModuleForMode('src/store/useAuthStore.ts', mode);
  return authModule.useAuthStore;
}

function assertAccountServiceCalls(calls, expected, description) {
  for (const key of [
    'acceptInvite',
    'getSession',
    'loadMembership',
    'loadProfile',
    'resendConfirmationEmail',
    'resetPasswordForEmail',
    'signIn',
    'signInWithApple',
    'signInWithGoogle',
    'signOut',
    'signUpWithEmail',
    'updateProfile',
  ]) {
    assertEqual(calls[key], expected, `${description} ${key} calls`);
  }
}

function assertNullAuthState(state, description) {
  assertEqual(state.session, null, `${description} session`);
  assertEqual(state.user, null, `${description} user`);
  assertEqual(state.profile, null, `${description} profile`);
  assertEqual(state.membership, null, `${description} membership`);
  assertEqual(state.loading, false, `${description} loading`);
  assertEqual(state.error, null, `${description} error`);
}

function createContactsSpies() {
  const spies = {
    calls: { community: 0, local: 0 },
    communityDeferred: null,
    communityDeferredQueue: [],
    modules: null,
  };
  const communityContact = { id: 'community-contact', source: 'community' };
  const localContact = { id: 'local-contact', source: 'iphone' };
  spies.modules = new Map([
    ['@/services/contactsService', {
      contactsService: {
        getUpcomingBirthdays: ({ communityContacts = [], localContacts = [] }) => [
          ...communityContacts,
          ...localContacts,
        ],
        async listCommunityContacts() {
          spies.calls.community += 1;
          const queuedDeferred = spies.communityDeferredQueue.shift();
          if (queuedDeferred) {
            return queuedDeferred.promise;
          }
          if (spies.communityDeferred) {
            return spies.communityDeferred.promise;
          }
          return [communityContact];
        },
        async listLocalBirthdayContacts() {
          spies.calls.local += 1;
          return { contacts: [localContact], ok: true, permissionStatus: 'granted' };
        },
        toContactListItems: ({ communityContacts = [], localContacts = [] }) => [
          ...communityContacts,
          ...localContacts,
        ],
      },
    }],
  ]);
  return spies;
}

function loadContactsStore(mode, spies) {
  activeStubs = spies.modules;
  return loadModuleForMode('src/store/useContactsStore.ts', mode).useContactsStore;
}

function loadTokenStore(mode) {
  activeStubs = new Map();
  return loadModuleForMode('src/services/apiAuthTokenStore.ts', mode);
}

function loadCapabilities() {
  clearSourceModule('src/config/appCapabilities.ts');
  return require(capabilitiesPath);
}

function loadModuleForMode(relativePath, mode) {
  setAccessMode(mode);
  clearSourceModule('src/config/appCapabilities.ts');
  clearSourceModule(relativePath);
  return require(sourcePath(relativePath));
}

function setAccessMode(mode) {
  if (mode === undefined) {
    delete process.env.EXPO_PUBLIC_APP_ACCESS_MODE;
  } else {
    process.env.EXPO_PUBLIC_APP_ACCESS_MODE = mode;
  }
  process.env.EXPO_PUBLIC_EVENT_REGISTRATION_MODE = 'disabled';
}

function clearSourceModule(relativePath) {
  const absolutePath = sourcePath(relativePath);
  try {
    delete require.cache[require.resolve(absolutePath)];
  } catch {
    // The module has not been loaded yet.
  }
}

function sourcePath(relativePath) {
  return path.join(repoRoot, relativePath);
}

function createTokens(accessToken, refreshToken) {
  return {
    access_token: accessToken,
    refresh_token: refreshToken,
    token_type: 'bearer',
    expires_at: '2099-01-01T00:00:00.000Z',
  };
}

function createSession(userId) {
  return {
    accessToken: 'account-access',
    refreshToken: 'account-refresh',
    tokenType: 'bearer',
    expiresAt: '2099-01-01T00:00:00.000Z',
    user: {
      id: userId,
      email: `${userId}@example.test`,
      phone: null,
      emailVerifiedAt: null,
      phoneVerifiedAt: null,
      authMethod: 'email',
      createdAt: '2026-08-09T00:00:00.000Z',
      updatedAt: '2026-08-09T00:00:00.000Z',
    },
  };
}

function createProfile(userId) {
  return {
    id: userId,
    community_id: null,
    full_name: null,
    hebrew_name: null,
    city: null,
    created_at: '2026-08-09T00:00:00.000Z',
    display_name: userId,
    first_name: null,
    last_name: null,
    phone: null,
    email: `${userId}@example.test`,
    avatar_url: null,
    birth_date: null,
    birth_time_context: 'unknown',
    hebrew_birth_date: null,
    tribe_status: null,
    marital_status: null,
    about: null,
    profile_visibility: 'members',
    birthday_visibility: 'members',
    phone_visibility: 'members',
    notification_preferences: null,
    nusach: null,
    onboarding_completed: false,
    updated_at: null,
  };
}

function resetSecureStorage() {
  secureStorage.clear();
  secureStoreCalls.delete = 0;
  secureStoreCalls.get = 0;
  secureStoreCalls.set = 0;
  deferredSecureDelete = null;
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, reject, resolve };
}

async function assertRejectsMessage(operation, expectedMessage, description) {
  let actualMessage = null;
  try {
    await operation();
  } catch (error) {
    actualMessage = error instanceof Error ? error.message : String(error);
  }
  assertEqual(actualMessage, expectedMessage, description);
}

function readSource(relativePath) {
  return fs.readFileSync(sourcePath(relativePath), 'utf8');
}

function assertIncludes(source, expected, description) {
  assertEqual(source.includes(expected), true, description);
}

function assertExcludes(source, forbidden, description) {
  assertEqual(source.includes(forbidden), false, description);
}

function assertMatches(source, expected, description) {
  assertEqual(expected.test(source), true, description);
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

function registerProductionDependencyStubs() {
  const originalLoad = Module._load;
  const secureStoreStub = {
    async isAvailableAsync() { return true; },
    async getItemAsync(key) {
      secureStoreCalls.get += 1;
      return secureStorage.get(key) ?? null;
    },
    async setItemAsync(key, value) {
      secureStoreCalls.set += 1;
      secureStorage.set(key, value);
    },
    async deleteItemAsync(key) {
      secureStoreCalls.delete += 1;
      if (deferredSecureDelete) {
        await deferredSecureDelete.promise;
      }
      secureStorage.delete(key);
    },
  };

  Module._load = function loadWithStubs(request, parent, isMain) {
    if (activeStubs.has(request)) {
      return activeStubs.get(request);
    }
    if (request === 'expo-secure-store') {
      return secureStoreStub;
    }
    if (request === 'react-native') {
      return { Platform: { OS: 'ios' } };
    }
    return originalLoad.call(this, request, parent, isMain);
  };
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
  Module._extensions['.ts'] = function compileTypeScriptModule(module, filename) {
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
}
