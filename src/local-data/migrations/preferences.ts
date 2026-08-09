import type { LocalMigration } from './types';

export const CREATE_LOCAL_PREFERENCES_SQL = `
  CREATE TABLE local_preferences (
    key TEXT PRIMARY KEY,
    value_json TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    source TEXT NOT NULL,
    schema_version INTEGER NOT NULL
  )
`;

export const preferencesMigration: LocalMigration = {
  version: 2,
  async up(database) {
    await database.execAsync(CREATE_LOCAL_PREFERENCES_SQL);
  },
};
