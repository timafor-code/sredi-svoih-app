import { foundationMigration } from './foundation';
import type { LocalMigration } from './types';

export { runLocalMigrations, validateAndSortMigrations } from './runner';
export type { LocalMigration, LocalMigrationDatabase, LocalMigrationExecutor } from './types';

export const localMigrations: readonly LocalMigration[] = Object.freeze([
  foundationMigration,
]);
