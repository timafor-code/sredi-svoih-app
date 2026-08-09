import { File } from 'expo-file-system';
import * as SQLite from 'expo-sqlite';
import type { SQLiteDatabase } from 'expo-sqlite';

import {
  createSqlCipherKeyPragma,
  generateAndStoreDatabaseKey,
  readStoredDatabaseKey,
  type ValidatedDatabaseKey,
} from './keyStore';
import { localMigrations, runLocalMigrations } from './migrations';
import {
  decideLocalDatabaseBootstrap,
  type LocalDataInitializationResult,
} from './types';

const LOCAL_DATABASE_NAME = 'sredi-svoih-local.db';
const VERIFY_DATABASE_READ_SQL = 'SELECT COUNT(*) AS schema_entries FROM sqlite_schema';

let initializationPromise: Promise<LocalDataInitializationResult> | null = null;

export function initializeLocalDatabase(): Promise<LocalDataInitializationResult> {
  if (!initializationPromise) {
    initializationPromise = initializeLocalDatabaseOnce().then((result) => {
      if (result.status !== 'ready') {
        initializationPromise = null;
      }

      return result;
    });
  }

  return initializationPromise;
}

async function initializeLocalDatabaseOnce(): Promise<LocalDataInitializationResult> {
  let databaseExists: boolean;

  try {
    databaseExists = new File(SQLite.defaultDatabaseDirectory, LOCAL_DATABASE_NAME).exists;
  } catch {
    return { status: 'database_file_check_failed' };
  }

  const storedKey = await readStoredDatabaseKey();
  const decision = decideLocalDatabaseBootstrap(databaseExists, storedKey.status);

  if (decision === 'secure_store_unavailable') {
    return { status: 'secure_store_unavailable' };
  }

  if (decision === 'missing_key_for_existing_database') {
    return { status: 'missing_key_for_existing_database' };
  }

  let databaseKey: ValidatedDatabaseKey;

  if (decision === 'create_new_database') {
    const generatedKey = await generateAndStoreDatabaseKey();

    if (generatedKey.status !== 'stored') {
      return { status: generatedKey.status };
    }

    databaseKey = generatedKey.key;
  } else if (storedKey.status === 'valid') {
    databaseKey = storedKey.key;
  } else {
    return { status: 'secure_store_unavailable' };
  }

  const database = await openKeyedDatabase(databaseKey);

  if (!database) {
    return { status: 'database_open_failed' };
  }

  try {
    await runLocalMigrations(database, localMigrations);
  } catch {
    await closeDatabaseQuietly(database);
    return { status: 'migration_failed' };
  }

  return { status: 'ready', database };
}

async function openKeyedDatabase(
  databaseKey: ValidatedDatabaseKey,
): Promise<SQLiteDatabase | null> {
  let database: SQLiteDatabase | null = null;

  try {
    database = await SQLite.openDatabaseAsync(
      LOCAL_DATABASE_NAME,
      { useNewConnection: true },
      SQLite.defaultDatabaseDirectory,
    );

    await database.execAsync(createSqlCipherKeyPragma(databaseKey));

    const readResult = await database.getFirstAsync<{ schema_entries: number }>(
      VERIFY_DATABASE_READ_SQL,
    );

    if (
      !Number.isInteger(readResult?.schema_entries)
      || (readResult?.schema_entries ?? -1) < 0
    ) {
      throw new Error('Local database read verification failed');
    }

    return database;
  } catch {
    if (database) {
      await closeDatabaseQuietly(database);
    }

    return null;
  }
}

async function closeDatabaseQuietly(database: SQLiteDatabase): Promise<void> {
  try {
    await database.closeAsync();
  } catch {
    // Initialization already failed; do not replace the neutral recovery state.
  }
}
