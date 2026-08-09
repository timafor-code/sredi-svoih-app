import type { SQLiteDatabase } from 'expo-sqlite';

export type LocalMigrationExecutor = Pick<SQLiteDatabase, 'execAsync'>;

export type LocalMigrationDatabase = Pick<
  SQLiteDatabase,
  'execAsync' | 'getAllAsync' | 'withExclusiveTransactionAsync'
>;

export type LocalMigration = {
  version: number;
  up: (database: LocalMigrationExecutor) => Promise<void>;
};
