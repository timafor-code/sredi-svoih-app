import type { SQLiteDatabase } from 'expo-sqlite';

export type LocalDatabaseKeyState = 'missing' | 'invalid' | 'valid' | 'unavailable';

export type LocalDatabaseBootstrapDecision =
  | 'create_new_database'
  | 'reuse_key_for_new_database'
  | 'open_existing_database'
  | 'missing_key_for_existing_database'
  | 'secure_store_unavailable';

export type LocalDataInitializationResult =
  | {
      status: 'ready';
      database: SQLiteDatabase;
    }
  | {
      status:
        | 'missing_key_for_existing_database'
        | 'secure_store_unavailable'
        | 'database_file_check_failed'
        | 'key_generation_failed'
        | 'sqlcipher_unavailable'
        | 'database_open_failed'
        | 'migration_failed';
    };

export function isSqlCipherRuntimeAvailable(result: unknown): boolean {
  if (typeof result !== 'object' || result === null || Array.isArray(result)) {
    return false;
  }

  const cipherVersion = (result as Record<string, unknown>).cipher_version;

  return typeof cipherVersion === 'string' && cipherVersion.trim().length > 0;
}

export function decideLocalDatabaseBootstrap(
  databaseExists: boolean,
  keyState: LocalDatabaseKeyState,
): LocalDatabaseBootstrapDecision {
  if (keyState === 'unavailable') {
    return 'secure_store_unavailable';
  }

  if (databaseExists) {
    return keyState === 'valid'
      ? 'open_existing_database'
      : 'missing_key_for_existing_database';
  }

  return keyState === 'valid'
    ? 'reuse_key_for_new_database'
    : 'create_new_database';
}
