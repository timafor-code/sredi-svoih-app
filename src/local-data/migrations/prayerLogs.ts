import type { LocalMigration } from './types';

export const CREATE_LOCAL_PRAYER_LOGS_SQL = `
  CREATE TABLE local_prayer_logs (
    local_id TEXT PRIMARY KEY,
    owner_scope TEXT NOT NULL DEFAULT 'guest' CHECK(length(trim(owner_scope)) > 0),
    activity_type TEXT NOT NULL CHECK(activity_type IN (
      'shacharit',
      'mincha',
      'maariv',
      'shema_morning',
      'shema_evening',
      'omer_count'
    )),
    activity_date TEXT NOT NULL,
    started_at TEXT NULL,
    completed_at TEXT NULL,
    timezone TEXT NOT NULL CHECK(length(trim(timezone)) > 0),
    city TEXT NULL,
    hebrew_date_json TEXT NOT NULL CHECK(json_valid(hebrew_date_json) AND json_type(hebrew_date_json) = 'object'),
    metadata_json TEXT NOT NULL CHECK(json_valid(metadata_json) AND json_type(metadata_json) = 'object'),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    sync_state TEXT NOT NULL CHECK(sync_state IN ('local_only', 'pending', 'synced', 'error')),
    synced_user_id TEXT NULL,
    server_id TEXT NULL,
    last_sync_error_code TEXT NULL,
    UNIQUE(owner_scope, activity_date, activity_type)
  )
`;

export const prayerLogsMigration: LocalMigration = {
  version: 3,
  async up(database) {
    await database.execAsync(CREATE_LOCAL_PRAYER_LOGS_SQL);
  },
};
