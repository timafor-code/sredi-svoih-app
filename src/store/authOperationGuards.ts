export type AuthOperationGuards = {
  beginAuthOperation: () => number;
  beginAvatarRefresh: () => number;
  invalidateAuthOperations: () => void;
  invalidateAvatarRefreshes: () => void;
  isCurrentAuthOperation: (revision: number) => boolean;
  isCurrentAvatarRefresh: (revision: number) => boolean;
};

export function createAuthOperationGuards(): AuthOperationGuards {
  let authOperationRevision = 0;
  let avatarRefreshRevision = 0;

  function invalidateAvatarRefreshes(): void {
    avatarRefreshRevision += 1;
  }

  function invalidateAuthOperations(): void {
    authOperationRevision += 1;
    invalidateAvatarRefreshes();
  }

  return {
    beginAuthOperation: () => {
      authOperationRevision += 1;
      invalidateAvatarRefreshes();
      return authOperationRevision;
    },
    beginAvatarRefresh: () => {
      avatarRefreshRevision += 1;
      return avatarRefreshRevision;
    },
    invalidateAuthOperations,
    invalidateAvatarRefreshes,
    isCurrentAuthOperation: (revision) => revision === authOperationRevision,
    isCurrentAvatarRefresh: (revision) => revision === avatarRefreshRevision,
  };
}

export const authOperationGuards = createAuthOperationGuards();
