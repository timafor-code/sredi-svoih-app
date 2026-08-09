import type { LocalMigration } from './types';

export const CREATE_MIGRATION_REGISTRY_SQL = `
  CREATE TABLE IF NOT EXISTS local_schema_migrations (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL
  )
`;

export const foundationMigration: LocalMigration = {
  version: 1,
  async up(database) {
    await database.execAsync(CREATE_MIGRATION_REGISTRY_SQL);
  },
};
