import * as Crypto from 'expo-crypto';
import type { SQLiteDatabase } from 'expo-sqlite';

import type {
  HebrewDatePayload,
  LoadPrayerActivityParams,
  LocalPrayerActivityLog,
  PrayerActivityMetadata,
  PrayerActivitySummary,
  PrayerActivityType,
  PrayerSyncState,
  RecordPrayerActivityInput,
} from '../types/prayerTracker';
import { initializeLocalDatabase } from './database';

export const LOCAL_PRAYER_OWNER_SCOPE = 'guest' as const;
export const DEFAULT_LOCAL_PRAYER_TIMEZONE = 'Europe/Moscow';
export const DEFAULT_LOCAL_PRAYER_HISTORY_LIMIT = 100;
export const MIN_LOCAL_PRAYER_HISTORY_LIMIT = 1;
export const MAX_LOCAL_PRAYER_HISTORY_LIMIT = 500;

export const PRAYER_ACTIVITY_TYPES = Object.freeze([
  'shacharit',
  'mincha',
  'maariv',
  'shema_morning',
  'shema_evening',
  'omer_count',
] as const satisfies readonly PrayerActivityType[]);

export const PRAYER_SYNC_STATES = Object.freeze([
  'local_only',
  'pending',
  'synced',
  'error',
] as const satisfies readonly PrayerSyncState[]);

export type LocalPrayerRepositoryErrorCode =
  | 'invalid_input'
  | 'corrupt_data'
  | 'storage_unavailable';

export class LocalPrayerRepositoryError extends Error {
  constructor(
    public readonly code: LocalPrayerRepositoryErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'LocalPrayerRepositoryError';
  }
}

export interface LocalPrayerRepository {
  record(input: RecordPrayerActivityInput): Promise<LocalPrayerActivityLog>;
  list(params?: LoadPrayerActivityParams): Promise<LocalPrayerActivityLog[]>;
  summary(params?: Pick<LoadPrayerActivityParams, 'fromDate' | 'toDate'>): Promise<PrayerActivitySummary>;
  deleteOne(localId: string): Promise<boolean>;
  deleteAllGuestHistory(): Promise<number>;
}

type PrayerRepositoryDatabase = Pick<
  SQLiteDatabase,
  'prepareAsync' | 'withExclusiveTransactionAsync'
>;

type PrayerRepositoryDependencies = {
  createLocalId?: () => string;
  now?: () => string;
};

type LocalPrayerLogRow = {
  local_id: string;
  owner_scope: string;
  activity_type: string;
  activity_date: string;
  started_at: string | null;
  completed_at: string | null;
  timezone: string;
  city: string | null;
  hebrew_date_json: string;
  metadata_json: string;
  created_at: string;
  updated_at: string;
  sync_state: string;
  synced_user_id: string | null;
  server_id: string | null;
  last_sync_error_code: string | null;
};

type PrayerSummaryRow = {
  total_logs: number;
  active_days: number;
  first_activity_date: string | null;
  last_activity_date: string | null;
};

type PrayerCountRow = {
  activity_type: string;
  activity_count: number;
};

type NormalizedRecordInput = {
  activityType: PrayerActivityType;
  activityDate: string;
  startedAt: string | null;
  completedAt: string | null;
  timezone: string;
  city: string | null;
  hebrewDate: HebrewDatePayload;
  metadata: PrayerActivityMetadata;
};

const SELECT_ROW_COLUMNS_SQL = `
  SELECT
    local_id,
    owner_scope,
    activity_type,
    activity_date,
    started_at,
    completed_at,
    timezone,
    city,
    hebrew_date_json,
    metadata_json,
    created_at,
    updated_at,
    sync_state,
    synced_user_id,
    server_id,
    last_sync_error_code
  FROM local_prayer_logs
`;

export const SELECT_LOCAL_PRAYER_BY_DOMAIN_SQL = `${SELECT_ROW_COLUMNS_SQL}
  WHERE owner_scope = ? AND activity_date = ? AND activity_type = ?
`;

export const INSERT_LOCAL_PRAYER_SQL = `
  INSERT INTO local_prayer_logs (
    local_id,
    owner_scope,
    activity_type,
    activity_date,
    started_at,
    completed_at,
    timezone,
    city,
    hebrew_date_json,
    metadata_json,
    created_at,
    updated_at,
    sync_state,
    synced_user_id,
    server_id,
    last_sync_error_code
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`;

export const UPDATE_LOCAL_PRAYER_SQL = `
  UPDATE local_prayer_logs
  SET
    started_at = ?,
    completed_at = ?,
    timezone = ?,
    city = ?,
    hebrew_date_json = ?,
    metadata_json = ?,
    updated_at = ?
  WHERE local_id = ? AND owner_scope = ?
`;

export const DELETE_LOCAL_PRAYER_SQL = `
  DELETE FROM local_prayer_logs
  WHERE local_id = ? AND owner_scope = ?
`;

export const DELETE_ALL_GUEST_PRAYERS_SQL = `
  DELETE FROM local_prayer_logs
  WHERE owner_scope = ?
`;

const activityTypeSet = new Set<string>(PRAYER_ACTIVITY_TYPES);
const syncStateSet = new Set<string>(PRAYER_SYNC_STATES);
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function createLocalPrayerRepository(
  database: PrayerRepositoryDatabase,
  dependencies: PrayerRepositoryDependencies = {},
): LocalPrayerRepository {
  const createLocalId = dependencies.createLocalId ?? (() => Crypto.randomUUID());
  const now = dependencies.now ?? (() => new Date().toISOString());

  return {
    async record(input) {
      const normalized = normalizeRecordInput(input);
      let recorded: LocalPrayerActivityLog | null = null;

      await database.withExclusiveTransactionAsync(async (transaction) => {
        const existingRow = await executeFirst<LocalPrayerLogRow>(
          transaction,
          SELECT_LOCAL_PRAYER_BY_DOMAIN_SQL,
          [
            LOCAL_PRAYER_OWNER_SCOPE,
            normalized.activityDate,
            normalized.activityType,
          ],
        );
        const existing = existingRow ? decodeLocalPrayerRow(existingRow) : null;

        if (!existing && !normalized.startedAt && !normalized.completedAt) {
          throw invalidInput('A new prayer log requires a start or completion timestamp');
        }

        if (existing) {
          const updatedAt = nextUpdatedAt(now(), existing.updatedAt);
          const updated: LocalPrayerActivityLog = {
            ...existing,
            startedAt: normalized.startedAt ?? existing.startedAt,
            completedAt: normalized.completedAt ?? existing.completedAt,
            timezone: normalized.timezone,
            city: normalized.city ?? existing.city,
            hebrewDate: mergeJsonObjects(existing.hebrewDate, normalized.hebrewDate),
            metadata: mergeJsonObjects(existing.metadata, normalized.metadata),
            updatedAt,
          };

          await executeWrite(transaction, UPDATE_LOCAL_PRAYER_SQL, [
            updated.startedAt,
            updated.completedAt,
            updated.timezone,
            updated.city,
            JSON.stringify(updated.hebrewDate),
            JSON.stringify(updated.metadata),
            updated.updatedAt,
            updated.localId,
            LOCAL_PRAYER_OWNER_SCOPE,
          ]);

          recorded = updated;
          return;
        }

        const createdAt = normalizeGeneratedTimestamp(now());
        const localId = createLocalId();

        if (typeof localId !== 'string' || !UUID_V4_PATTERN.test(localId)) {
          throw new LocalPrayerRepositoryError(
            'storage_unavailable',
            'Local prayer identity generation failed',
          );
        }

        const created: LocalPrayerActivityLog = {
          localId,
          ownerScope: LOCAL_PRAYER_OWNER_SCOPE,
          activityType: normalized.activityType,
          activityDate: normalized.activityDate,
          startedAt: normalized.startedAt,
          completedAt: normalized.completedAt,
          timezone: normalized.timezone,
          city: normalized.city,
          hebrewDate: normalized.hebrewDate,
          metadata: normalized.metadata,
          createdAt,
          updatedAt: createdAt,
          syncState: 'local_only',
          syncedUserId: null,
          serverId: null,
          lastSyncErrorCode: null,
        };

        await executeWrite(transaction, INSERT_LOCAL_PRAYER_SQL, [
          created.localId,
          created.ownerScope,
          created.activityType,
          created.activityDate,
          created.startedAt,
          created.completedAt,
          created.timezone,
          created.city,
          JSON.stringify(created.hebrewDate),
          JSON.stringify(created.metadata),
          created.createdAt,
          created.updatedAt,
          created.syncState,
          created.syncedUserId,
          created.serverId,
          created.lastSyncErrorCode,
        ]);

        recorded = created;
      });

      if (!recorded) {
        throw new LocalPrayerRepositoryError(
          'storage_unavailable',
          'Local prayer write did not complete',
        );
      }

      return recorded;
    },

    async list(params = {}) {
      const filters = normalizeDateRange(params);
      const limit = normalizeHistoryLimit(params.limit);
      const { parameters, whereSql } = createDateRangeWhere(filters);
      const rows = await executeAll<LocalPrayerLogRow>(
        database,
        `${SELECT_ROW_COLUMNS_SQL}${whereSql}
          ORDER BY activity_date DESC, created_at DESC
          LIMIT ?
        `,
        [...parameters, limit],
      );

      return rows.map(decodeLocalPrayerRow);
    },

    async summary(params = {}) {
      const filters = normalizeDateRange(params);
      const { parameters, whereSql } = createDateRangeWhere(filters);
      const summaryRow = await executeFirst<PrayerSummaryRow>(
        database,
        `
          SELECT
            COUNT(local_id) AS total_logs,
            COUNT(DISTINCT activity_date) AS active_days,
            MIN(activity_date) AS first_activity_date,
            MAX(activity_date) AS last_activity_date
          FROM local_prayer_logs
          ${whereSql}
        `,
        parameters,
      );
      const countRows = await executeAll<PrayerCountRow>(
        database,
        `
          SELECT activity_type, COUNT(local_id) AS activity_count
          FROM local_prayer_logs
          ${whereSql}
          GROUP BY activity_type
        `,
        parameters,
      );

      if (
        !summaryRow
        || !Number.isInteger(summaryRow.total_logs)
        || summaryRow.total_logs < 0
        || !Number.isInteger(summaryRow.active_days)
        || summaryRow.active_days < 0
      ) {
        throw corruptData();
      }

      const countsByActivityType = createEmptyActivityCounts();

      for (const row of countRows) {
        if (
          !isPrayerActivityType(row.activity_type)
          || !Number.isInteger(row.activity_count)
          || row.activity_count < 0
        ) {
          throw corruptData();
        }

        countsByActivityType[row.activity_type] = row.activity_count;
      }

      const firstActivityDate = normalizeNullableStoredDate(summaryRow.first_activity_date);
      const lastActivityDate = normalizeNullableStoredDate(summaryRow.last_activity_date);

      return {
        fromDate: filters.fromDate,
        toDate: filters.toDate,
        totalLogs: summaryRow.total_logs,
        activeDays: summaryRow.active_days,
        countsByActivityType,
        firstActivityDate,
        lastActivityDate,
      };
    },

    async deleteOne(localId) {
      const normalizedLocalId = normalizeLocalId(localId);
      const changes = await executeWrite(database, DELETE_LOCAL_PRAYER_SQL, [
        normalizedLocalId,
        LOCAL_PRAYER_OWNER_SCOPE,
      ]);
      return changes > 0;
    },

    async deleteAllGuestHistory() {
      return executeWrite(database, DELETE_ALL_GUEST_PRAYERS_SQL, [
        LOCAL_PRAYER_OWNER_SCOPE,
      ]);
    },
  };
}

export async function recordLocalPrayerActivity(
  input: RecordPrayerActivityInput,
): Promise<LocalPrayerActivityLog> {
  return useInitializedRepository((repository) => repository.record(input));
}

export async function listLocalPrayerActivity(
  params: LoadPrayerActivityParams = {},
): Promise<LocalPrayerActivityLog[]> {
  return useInitializedRepository((repository) => repository.list(params));
}

export async function getLocalPrayerActivitySummary(
  params: Pick<LoadPrayerActivityParams, 'fromDate' | 'toDate'> = {},
): Promise<PrayerActivitySummary> {
  return useInitializedRepository((repository) => repository.summary(params));
}

export async function deleteLocalPrayerActivity(localId: string): Promise<boolean> {
  return useInitializedRepository((repository) => repository.deleteOne(localId));
}

export async function deleteAllLocalGuestPrayerHistory(): Promise<number> {
  return useInitializedRepository((repository) => repository.deleteAllGuestHistory());
}

function normalizeRecordInput(input: RecordPrayerActivityInput): NormalizedRecordInput {
  if (!isPlainObject(input)) {
    throw invalidInput('Prayer log input must be an object');
  }

  if (!isPrayerActivityType(input.activityType)) {
    throw invalidInput('Unknown prayer activity type');
  }

  const startedAt = normalizeInputTimestamp(input.startedAt);
  const completedAt = normalizeInputTimestamp(input.completedAt);
  const timezone = normalizeTimezone(input.timezone);
  const activityDate = resolveActivityDate(
    input.activityDate,
    startedAt,
    completedAt,
    timezone,
  );

  if (input.city !== undefined && input.city !== null && typeof input.city !== 'string') {
    throw invalidInput('Prayer city must be a string or null');
  }

  return {
    activityType: input.activityType,
    activityDate,
    startedAt,
    completedAt,
    timezone,
    city: input.city ?? null,
    hebrewDate: normalizeInputJsonObject(input.hebrewDate),
    metadata: normalizeInputJsonObject(input.metadata),
  };
}

function normalizeInputTimestamp(value: Date | string | null | undefined): string | null {
  if (value === undefined || value === null) {
    return null;
  }

  if (
    typeof value === 'string'
    && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/i.test(value)
  ) {
    throw invalidInput('Prayer timestamps must include timezone information');
  }

  if (!(value instanceof Date) && typeof value !== 'string') {
    throw invalidInput('Invalid prayer timestamp');
  }

  const parsed = value instanceof Date ? value : new Date(value);

  if (Number.isNaN(parsed.getTime())) {
    throw invalidInput('Invalid prayer timestamp');
  }

  return parsed.toISOString();
}

function normalizeTimezone(value: string | undefined): string {
  if (value !== undefined && typeof value !== 'string') {
    throw invalidInput('Invalid prayer timezone');
  }

  const timezone = value === undefined
    ? DEFAULT_LOCAL_PRAYER_TIMEZONE
    : value.trim();

  if (!timezone) {
    throw invalidInput('Invalid prayer timezone');
  }

  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(0);
  } catch {
    throw invalidInput('Invalid prayer timezone');
  }

  return timezone;
}

function resolveActivityDate(
  explicitDate: string | undefined,
  startedAt: string | null,
  completedAt: string | null,
  timezone: string,
): string {
  if (explicitDate !== undefined) {
    return normalizeDate(explicitDate, 'activity date');
  }

  const timestamp = startedAt ?? completedAt;

  if (!timestamp) {
    throw invalidInput('Prayer activity date or timestamp is required');
  }

  try {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      day: '2-digit',
      month: '2-digit',
      timeZone: timezone,
      year: 'numeric',
    });
    const parts = formatter.formatToParts(new Date(timestamp));
    const year = parts.find((part) => part.type === 'year')?.value;
    const month = parts.find((part) => part.type === 'month')?.value;
    const day = parts.find((part) => part.type === 'day')?.value;

    if (!year || !month || !day) {
      throw new Error('missing date part');
    }

    return normalizeDate(`${year}-${month}-${day}`, 'derived activity date');
  } catch (error) {
    if (error instanceof LocalPrayerRepositoryError) {
      throw error;
    }

    throw invalidInput('Prayer activity date could not be resolved');
  }
}

function normalizeDate(value: unknown, fieldName: string): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw invalidInput(`Invalid ${fieldName}`);
  }

  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));

  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
  ) {
    throw invalidInput(`Invalid ${fieldName}`);
  }

  return value;
}

function normalizeDateRange(
  params: Pick<LoadPrayerActivityParams, 'fromDate' | 'toDate'>,
): { fromDate: string | null; toDate: string | null } {
  if (!isPlainObject(params)) {
    throw invalidInput('Prayer history filters must be an object');
  }

  const fromDate = params.fromDate === undefined
    ? null
    : normalizeDate(params.fromDate, 'from date');
  const toDate = params.toDate === undefined
    ? null
    : normalizeDate(params.toDate, 'to date');

  if (fromDate && toDate && fromDate > toDate) {
    throw invalidInput('Prayer history date range is invalid');
  }

  return { fromDate, toDate };
}

function normalizeHistoryLimit(value: number | undefined): number {
  if (value === undefined) {
    return DEFAULT_LOCAL_PRAYER_HISTORY_LIMIT;
  }

  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw invalidInput('Prayer history limit must be a finite number');
  }

  return Math.max(
    MIN_LOCAL_PRAYER_HISTORY_LIMIT,
    Math.min(Math.trunc(value), MAX_LOCAL_PRAYER_HISTORY_LIMIT),
  );
}

function createDateRangeWhere(filters: { fromDate: string | null; toDate: string | null }) {
  const clauses = ['owner_scope = ?'];
  const parameters: Array<string | number | null> = [LOCAL_PRAYER_OWNER_SCOPE];

  if (filters.fromDate) {
    clauses.push('activity_date >= ?');
    parameters.push(filters.fromDate);
  }

  if (filters.toDate) {
    clauses.push('activity_date <= ?');
    parameters.push(filters.toDate);
  }

  return {
    parameters,
    whereSql: `WHERE ${clauses.join(' AND ')}`,
  };
}

function normalizeInputJsonObject(value: unknown): Record<string, unknown> {
  if (value === undefined) {
    return {};
  }

  return normalizeJsonObject(value, 'invalid_input');
}

function normalizeStoredJsonObject(value: string): Record<string, unknown> {
  let parsed: unknown;

  try {
    parsed = JSON.parse(value);
  } catch {
    throw corruptData();
  }

  return normalizeJsonObject(parsed, 'corrupt_data');
}

function normalizeJsonObject(
  value: unknown,
  errorCode: 'invalid_input' | 'corrupt_data',
): Record<string, unknown> {
  if (!isPlainObject(value)) {
    throw errorCode === 'invalid_input'
      ? invalidInput('Prayer JSON fields must be plain objects')
      : corruptData();
  }

  try {
    return cloneJsonObject(value, new WeakSet<object>());
  } catch {
    throw errorCode === 'invalid_input'
      ? invalidInput('Prayer JSON fields must contain plain JSON values')
      : corruptData();
  }
}

function cloneJsonObject(
  value: Record<string, unknown>,
  ancestors: WeakSet<object>,
): Record<string, unknown> {
  if (ancestors.has(value)) {
    throw new Error('cyclic JSON value');
  }

  ancestors.add(value);
  const clone: Record<string, unknown> = {};
  const descriptors = Object.getOwnPropertyDescriptors(value);

  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (
      key === '__proto__'
      || key === 'constructor'
      || key === 'prototype'
      || !('value' in descriptor)
    ) {
      throw new Error('unsafe JSON property');
    }

    clone[key] = cloneJsonValue(descriptor.value, ancestors);
  }

  ancestors.delete(value);
  return clone;
}

function cloneJsonValue(value: unknown, ancestors: WeakSet<object>): unknown {
  if (
    value === null
    || typeof value === 'string'
    || typeof value === 'boolean'
  ) {
    return value;
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (Array.isArray(value)) {
    if (ancestors.has(value)) {
      throw new Error('cyclic JSON value');
    }

    ancestors.add(value);
    const clone = value.map((item) => cloneJsonValue(item, ancestors));
    ancestors.delete(value);
    return clone;
  }

  if (isPlainObject(value)) {
    return cloneJsonObject(value, ancestors);
  }

  throw new Error('non-JSON value');
}

function mergeJsonObjects(
  existing: Record<string, unknown>,
  incoming: Record<string, unknown>,
): Record<string, unknown> {
  return { ...existing, ...incoming };
}

function decodeLocalPrayerRow(row: LocalPrayerLogRow): LocalPrayerActivityLog {
  if (
    !row
    || typeof row.local_id !== 'string'
    || !row.local_id.trim()
    || row.owner_scope !== LOCAL_PRAYER_OWNER_SCOPE
    || !isPrayerActivityType(row.activity_type)
    || !isPrayerSyncState(row.sync_state)
    || typeof row.timezone !== 'string'
    || !row.timezone.trim()
    || !isNullableString(row.city)
    || !isNullableString(row.started_at)
    || !isNullableString(row.completed_at)
    || !isNullableString(row.synced_user_id)
    || !isNullableString(row.server_id)
    || !isNullableString(row.last_sync_error_code)
  ) {
    throw corruptData();
  }

  let activityDate: string;

  try {
    activityDate = normalizeDate(row.activity_date, 'stored activity date');
    normalizeTimezone(row.timezone);
    normalizeStoredTimestamp(row.created_at);
    normalizeStoredTimestamp(row.updated_at);

    if (row.started_at) normalizeStoredTimestamp(row.started_at);
    if (row.completed_at) normalizeStoredTimestamp(row.completed_at);
  } catch {
    throw corruptData();
  }

  return {
    localId: row.local_id,
    ownerScope: LOCAL_PRAYER_OWNER_SCOPE,
    activityType: row.activity_type,
    activityDate,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    timezone: row.timezone,
    city: row.city,
    hebrewDate: normalizeStoredJsonObject(row.hebrew_date_json),
    metadata: normalizeStoredJsonObject(row.metadata_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    syncState: row.sync_state,
    syncedUserId: row.synced_user_id,
    serverId: row.server_id,
    lastSyncErrorCode: row.last_sync_error_code,
  };
}

function normalizeStoredTimestamp(value: unknown): string {
  if (typeof value !== 'string' || Number.isNaN(new Date(value).getTime())) {
    throw corruptData();
  }

  return value;
}

function normalizeGeneratedTimestamp(value: string): string {
  if (typeof value !== 'string') {
    throw new LocalPrayerRepositoryError(
      'storage_unavailable',
      'Local prayer clock failed',
    );
  }

  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) {
    throw new LocalPrayerRepositoryError(
      'storage_unavailable',
      'Local prayer clock failed',
    );
  }

  return parsed.toISOString();
}

function nextUpdatedAt(value: string, previous: string): string {
  const normalized = normalizeGeneratedTimestamp(value);

  if (new Date(normalized).getTime() > new Date(previous).getTime()) {
    return normalized;
  }

  return new Date(new Date(previous).getTime() + 1).toISOString();
}

function normalizeNullableStoredDate(value: string | null): string | null {
  if (value === null) {
    return null;
  }

  try {
    return normalizeDate(value, 'stored summary date');
  } catch {
    throw corruptData();
  }
}

function normalizeLocalId(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw invalidInput('Local prayer identity is required');
  }

  return value;
}

function createEmptyActivityCounts(): Record<PrayerActivityType, number> {
  return {
    shacharit: 0,
    mincha: 0,
    maariv: 0,
    shema_morning: 0,
    shema_evening: 0,
    omer_count: 0,
  };
}

function isPrayerActivityType(value: unknown): value is PrayerActivityType {
  return typeof value === 'string' && activityTypeSet.has(value);
}

function isPrayerSyncState(value: unknown): value is PrayerSyncState {
  return typeof value === 'string' && syncStateSet.has(value);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

function invalidInput(message: string): LocalPrayerRepositoryError {
  return new LocalPrayerRepositoryError('invalid_input', message);
}

function corruptData(): LocalPrayerRepositoryError {
  return new LocalPrayerRepositoryError(
    'corrupt_data',
    'Stored local prayer data is invalid',
  );
}

async function executeFirst<T>(
  database: Pick<SQLiteDatabase, 'prepareAsync'>,
  sql: string,
  parameters: Array<string | number | null>,
): Promise<T | null> {
  const statement = await database.prepareAsync(sql);

  try {
    const result = await statement.executeAsync<T>(parameters);
    return result.getFirstAsync();
  } finally {
    await statement.finalizeAsync();
  }
}

async function executeAll<T>(
  database: Pick<SQLiteDatabase, 'prepareAsync'>,
  sql: string,
  parameters: Array<string | number | null>,
): Promise<T[]> {
  const statement = await database.prepareAsync(sql);

  try {
    const result = await statement.executeAsync<T>(parameters);
    return result.getAllAsync();
  } finally {
    await statement.finalizeAsync();
  }
}

async function executeWrite(
  database: Pick<SQLiteDatabase, 'prepareAsync'>,
  sql: string,
  parameters: Array<string | number | null>,
): Promise<number> {
  const statement = await database.prepareAsync(sql);

  try {
    const result = await statement.executeAsync(parameters);
    return result.changes;
  } finally {
    await statement.finalizeAsync();
  }
}

async function useInitializedRepository<T>(
  operation: (repository: LocalPrayerRepository) => Promise<T>,
): Promise<T> {
  const initialization = await initializeLocalDatabase();

  if (initialization.status !== 'ready') {
    throw new LocalPrayerRepositoryError(
      'storage_unavailable',
      'Encrypted local prayer storage is unavailable',
    );
  }

  return operation(createLocalPrayerRepository(initialization.database));
}
