import { createAuthOperationGuards } from '../authOperationGuards';

type Deferred<T> = {
  promise: Promise<T>;
  reject: (reason: unknown) => void;
  resolve: (value: T) => void;
};

type HarnessProfile = {
  avatarUrl: string | null;
  id: string;
  name: string;
};

type HarnessAuthResult = {
  membership: string | null;
  profile: HarnessProfile | null;
  session: string;
  user: string;
};

type HarnessState = {
  error: string | null;
  loading: boolean;
  membership: string | null;
  profile: HarnessProfile | null;
  session: string | null;
  user: string | null;
};

let passed = 0;
const failures: string[] = [];

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });

  return { promise, reject, resolve };
}

async function runTest(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    passed += 1;
    console.log('  ok ' + name);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    failures.push(name + ' - ' + message);
    console.error('  fail ' + name + ' - ' + message);
  }
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function assertEqual<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${String(expected)}, got ${String(actual)}`);
  }
}

function profile(id: string, avatarUrl: string | null, name = id): HarnessProfile {
  return { avatarUrl, id, name };
}

function authResult(id: string, avatarUrl: string | null): HarnessAuthResult {
  return {
    membership: `membership-${id}`,
    profile: profile(id, avatarUrl),
    session: `session-${id}`,
    user: id,
  };
}

function createHarness() {
  const guards = createAuthOperationGuards();
  const effects = {
    avatarRefreshes: 0,
    cacheClears: 0,
    privateResets: 0,
  };
  let state: HarnessState = {
    error: null,
    loading: false,
    membership: null,
    profile: null,
    session: null,
    user: null,
  };

  function set(patch: Partial<HarnessState>): void {
    state = { ...state, ...patch };
  }

  function currentAvatarFor(profileId: string): string | null {
    return state.user === profileId ? state.profile?.avatarUrl ?? null : null;
  }

  function applyProfile(nextProfile: HarnessProfile | null): HarnessProfile | null {
    if (!nextProfile) {
      return null;
    }

    return {
      ...nextProfile,
      avatarUrl: currentAvatarFor(nextProfile.id),
    };
  }

  async function resetPrivateState(revision: number): Promise<boolean> {
    if (!guards.isCurrentAuthOperation(revision)) {
      return false;
    }

    await flush();

    if (!guards.isCurrentAuthOperation(revision)) {
      return false;
    }

    effects.privateResets += 1;

    return guards.isCurrentAuthOperation(revision);
  }

  async function clearAvatarCache(revision: number): Promise<boolean> {
    if (!guards.isCurrentAuthOperation(revision)) {
      return false;
    }

    await flush();

    if (!guards.isCurrentAuthOperation(revision)) {
      return false;
    }

    effects.cacheClears += 1;

    return guards.isCurrentAuthOperation(revision);
  }

  return {
    effects,
    get state() {
      return state;
    },
    loadProfile: async (profilePromise: Deferred<HarnessProfile | null>) => {
      const revision = guards.beginAuthOperation();
      set({ error: null, loading: true });

      try {
        const nextProfile = await profilePromise.promise;

        if (!guards.isCurrentAuthOperation(revision)) {
          return;
        }

        set({
          error: null,
          loading: false,
          profile: applyProfile(nextProfile),
        });
      } catch {
        if (guards.isCurrentAuthOperation(revision)) {
          set({ error: 'profile_error', loading: false });
        }
      }
    },
    loadSession: async (sessionPromise: Deferred<HarnessAuthResult | null>) => {
      const revision = guards.beginAuthOperation();
      set({ error: null, loading: true });

      try {
        const result = await sessionPromise.promise;

        if (!guards.isCurrentAuthOperation(revision)) {
          return;
        }

        if (!result) {
          if (!await resetPrivateState(revision)) return;
          if (!await clearAvatarCache(revision)) return;
          set({
            error: null,
            loading: false,
            membership: null,
            profile: null,
            session: null,
            user: null,
          });
          return;
        }

        set({
          error: null,
          loading: false,
          membership: result.membership,
          profile: applyProfile(result.profile),
          session: result.session,
          user: result.user,
        });
        if (guards.isCurrentAuthOperation(revision)) {
          effects.avatarRefreshes += 1;
        }
      } catch {
        if (guards.isCurrentAuthOperation(revision)) {
          set({ error: 'session_error', loading: false });
        }
      }
    },
    refreshAvatar: async (avatarPromise: Deferred<string | null>) => {
      const userId = state.user;

      if (!userId || !state.profile) {
        return;
      }

      const revision = guards.beginAvatarRefresh();
      const avatarUrl = await avatarPromise.promise.catch(() => null);

      if (
        !guards.isCurrentAvatarRefresh(revision)
        || state.user !== userId
        || !state.profile
      ) {
        return;
      }

      set({
        profile: {
          ...state.profile,
          avatarUrl,
        },
      });
    },
    setProfileAvatarUrl: (avatarUrl: string | null) => {
      guards.invalidateAvatarRefreshes();
      set({
        profile: state.profile
          ? {
            ...state.profile,
            avatarUrl,
          }
          : null,
      });
    },
    signIn: async (signInPromise: Deferred<HarnessAuthResult>) => {
      const revision = guards.beginAuthOperation();
      set({ error: null, loading: true });

      try {
        const result = await signInPromise.promise;

        if (!guards.isCurrentAuthOperation(revision)) {
          return;
        }

        if (!await resetPrivateState(revision)) return;
        set({
          error: null,
          loading: false,
          membership: result.membership,
          profile: applyProfile(result.profile),
          session: result.session,
          user: result.user,
        });
        if (guards.isCurrentAuthOperation(revision)) {
          effects.avatarRefreshes += 1;
        }
      } catch {
        if (guards.isCurrentAuthOperation(revision)) {
          set({ error: 'sign_in_error', loading: false });
        }
      }
    },
    signOut: async (signOutPromise: Deferred<void>) => {
      const revision = guards.beginAuthOperation();
      set({ error: null, loading: true });

      try {
        await signOutPromise.promise;

        if (!guards.isCurrentAuthOperation(revision)) {
          return;
        }

        if (!await resetPrivateState(revision)) return;
        if (!await clearAvatarCache(revision)) return;
        set({
          error: null,
          loading: false,
          membership: null,
          profile: null,
          session: null,
          user: null,
        });
      } catch {
        if (guards.isCurrentAuthOperation(revision)) {
          set({ error: 'sign_out_error', loading: false });
        }
      }
    },
  };
}

async function settle(task: Promise<void>): Promise<void> {
  await task.catch(() => undefined);
  await flush();
}

async function oldLoadSessionDoesNotRestoreAfterSignOut(): Promise<void> {
  const harness = createHarness();
  const load = deferred<HarnessAuthResult | null>();
  const signOut = deferred<void>();
  const loadTask = harness.loadSession(load);
  const signOutTask = harness.signOut(signOut);

  signOut.resolve(undefined);
  await flush();
  load.resolve(authResult('old-user', 'old-avatar'));
  await settle(signOutTask);
  await settle(loadTask);

  assertEqual(harness.state.session, null, 'session stays signed out');
  assertEqual(harness.state.user, null, 'user stays signed out');
  assertEqual(harness.state.membership, null, 'membership stays cleared');
  assertEqual(harness.effects.privateResets, 1, 'stale loadSession does not reset private state');
  assertEqual(harness.effects.cacheClears, 1, 'stale loadSession does not clear avatar cache');
}

async function oldSignOutDoesNotClearNewSignIn(): Promise<void> {
  const harness = createHarness();
  const signOut = deferred<void>();
  const signIn = deferred<HarnessAuthResult>();
  const signOutTask = harness.signOut(signOut);
  const signInTask = harness.signIn(signIn);

  signIn.resolve(authResult('new-user', 'new-avatar'));
  await settle(signInTask);
  signOut.resolve(undefined);
  await settle(signOutTask);

  assertEqual(harness.state.session, 'session-new-user', 'new session remains');
  assertEqual(harness.state.user, 'new-user', 'new user remains');
  assertEqual(harness.state.membership, 'membership-new-user', 'new membership remains');
  assertEqual(harness.effects.privateResets, 1, 'stale signOut does not reset private state');
  assertEqual(harness.effects.cacheClears, 0, 'stale signOut does not clear avatar cache');
}

async function newerSignInBeatsOlderSignIn(): Promise<void> {
  const harness = createHarness();
  const oldSignIn = deferred<HarnessAuthResult>();
  const newSignIn = deferred<HarnessAuthResult>();
  const oldTask = harness.signIn(oldSignIn);
  const newTask = harness.signIn(newSignIn);

  newSignIn.resolve(authResult('new-user', 'new-avatar'));
  await settle(newTask);
  oldSignIn.resolve(authResult('old-user', 'old-avatar'));
  await settle(oldTask);

  assertEqual(harness.state.session, 'session-new-user', 'newer sign-in wins session');
  assertEqual(harness.state.user, 'new-user', 'newer sign-in wins user');
  assertEqual(harness.effects.privateResets, 1, 'older sign-in does not reset private state');
}

async function staleErrorDoesNotChangeCurrentLoadingOrError(): Promise<void> {
  const harness = createHarness();
  const oldSignIn = deferred<HarnessAuthResult>();
  const currentSignIn = deferred<HarnessAuthResult>();
  const oldTask = harness.signIn(oldSignIn);
  void harness.signIn(currentSignIn);

  oldSignIn.reject(new Error('old failure'));
  await settle(oldTask);

  assertEqual(harness.state.loading, true, 'current operation keeps loading');
  assertEqual(harness.state.error, null, 'stale error is ignored');
}

async function inFlightLoadProfilePreservesUploadedAvatar(): Promise<void> {
  const harness = createHarness();
  const signIn = deferred<HarnessAuthResult>();
  await settle((async () => {
    const task = harness.signIn(signIn);
    signIn.resolve(authResult('user-1', 'initial-avatar'));
    await task;
  })());
  const profileLoad = deferred<HarnessProfile | null>();
  const loadTask = harness.loadProfile(profileLoad);

  harness.setProfileAvatarUrl('uploaded-avatar');
  profileLoad.resolve(profile('user-1', 'legacy-avatar', 'Updated Name'));
  await settle(loadTask);

  assert(harness.state.profile !== null, 'profile remains loaded');
  assertEqual(harness.state.profile?.avatarUrl, 'uploaded-avatar', 'uploaded avatar survives');
  assertEqual(harness.state.profile?.name, 'Updated Name', 'profile fields can still update');
}

async function oldAvatarRefreshIgnoredAfterUploadDeleteAndSignOut(): Promise<void> {
  const harness = createHarness();
  const signIn = deferred<HarnessAuthResult>();
  await settle((async () => {
    const task = harness.signIn(signIn);
    signIn.resolve(authResult('user-1', 'initial-avatar'));
    await task;
  })());

  const uploadRefresh = deferred<string | null>();
  const uploadRefreshTask = harness.refreshAvatar(uploadRefresh);
  harness.setProfileAvatarUrl('uploaded-avatar');
  uploadRefresh.resolve('stale-avatar');
  await settle(uploadRefreshTask);
  assertEqual(harness.state.profile?.avatarUrl, 'uploaded-avatar', 'upload invalidates old refresh');

  const deleteRefresh = deferred<string | null>();
  const deleteRefreshTask = harness.refreshAvatar(deleteRefresh);
  harness.setProfileAvatarUrl(null);
  deleteRefresh.resolve('stale-after-delete');
  await settle(deleteRefreshTask);
  assertEqual(harness.state.profile?.avatarUrl, null, 'delete invalidates old refresh');

  const signOutRefresh = deferred<string | null>();
  const signOutRefreshTask = harness.refreshAvatar(signOutRefresh);
  const signOut = deferred<void>();
  const signOutTask = harness.signOut(signOut);
  signOut.resolve(undefined);
  await settle(signOutTask);
  signOutRefresh.resolve('stale-after-signout');
  await settle(signOutRefreshTask);
  assertEqual(harness.state.profile, null, 'sign-out keeps profile cleared');
}

async function run(): Promise<void> {
  const tests = [
    ['old loadSession completes after signOut', oldLoadSessionDoesNotRestoreAfterSignOut],
    ['old signOut completes after new signIn', oldSignOutDoesNotClearNewSignIn],
    ['older signIn completes after newer signIn', newerSignInBeatsOlderSignIn],
    ['stale operation error does not change current loading/error', staleErrorDoesNotChangeCurrentLoadingOrError],
    ['in-flight loadProfile does not wipe setProfileAvatarUrl', inFlightLoadProfilePreservesUploadedAvatar],
    ['old avatar refresh is ignored after upload/delete/signOut', oldAvatarRefreshIgnoredAfterUploadDeleteAndSignOut],
  ] as const;

  for (const [name, fn] of tests) {
    await runTest(name, fn);
  }

  console.log(`\nuseAuthStore race guard tests: ${passed} passed, ${failures.length} failed`);

  if (failures.length > 0) {
    throw new Error(`${failures.length} useAuthStore race guard test(s) failed`);
  }
}

void run();
