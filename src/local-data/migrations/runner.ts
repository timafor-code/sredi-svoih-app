import { CREATE_MIGRATION_REGISTRY_SQL } from './foundation';
import type { LocalMigration, LocalMigrationDatabase } from './types';

const READ_APPLIED_MIGRATIONS_SQL = `
  SELECT version
  FROM local_schema_migrations
  ORDER BY version ASC
`;

const RECORD_MIGRATION_SQL = `
  INSERT INTO local_schema_migrations (version, applied_at)
  VALUES (?, ?)
`;

type AppliedMigrationRow = {
  version: number;
};

export function validateAndSortMigrations(
  migrations: readonly LocalMigration[],
): LocalMigration[] {
  const sortedMigrations = [...migrations].sort((left, right) => left.version - right.version);
  const versions = new Set<number>();

  for (const migration of sortedMigrations) {
    if (!Number.isInteger(migration.version) || migration.version <= 0) {
      throw new Error('Local migration versions must be positive integers');
    }

    if (versions.has(migration.version)) {
      throw new Error('Duplicate local migration version');
    }

    versions.add(migration.version);
  }

  return sortedMigrations;
}

export async function runLocalMigrations(
  database: LocalMigrationDatabase,
  migrations: readonly LocalMigration[],
  now: () => string = () => new Date().toISOString(),
): Promise<void> {
  const sortedMigrations = validateAndSortMigrations(migrations);

  await database.execAsync(CREATE_MIGRATION_REGISTRY_SQL);

  const appliedRows = await database.getAllAsync<AppliedMigrationRow>(
    READ_APPLIED_MIGRATIONS_SQL,
  );
  const appliedVersions = new Set<number>();

  for (const row of appliedRows) {
    if (!Number.isInteger(row.version) || row.version <= 0) {
      throw new Error('Invalid local migration registry');
    }

    appliedVersions.add(row.version);
  }

  for (const migration of sortedMigrations) {
    if (appliedVersions.has(migration.version)) {
      continue;
    }

    await database.withExclusiveTransactionAsync(async (transaction) => {
      await migration.up(transaction);

      const statement = await transaction.prepareAsync(RECORD_MIGRATION_SQL);

      try {
        await statement.executeAsync([migration.version, now()]);
      } finally {
        await statement.finalizeAsync();
      }
    });

    appliedVersions.add(migration.version);
  }
}
