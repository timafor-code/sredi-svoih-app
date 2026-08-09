import * as SecureStore from 'expo-secure-store';
import type { SQLiteDatabase } from 'expo-sqlite';

import { normalizeBlessingTextDisplayMode } from '../lib/blessingTextDisplayMode';
import {
  FALLBACK_ZMANIM_CITY,
  isSupportedZmanimCity,
  normalizeZmanimCityName,
  type CustomZmanimLocation,
} from '../lib/zmanim';
import type { BlessingTextDisplayMode } from '../types/blessing';
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  isProfileNusach,
  normalizeProfileNusach,
  type ProfileNotificationPreferences,
  type ProfileNusach,
} from '../types/profile';
import { initializeLocalDatabase } from './database';

export const LEGACY_SETTINGS_STORAGE_KEY = 'sredi-svoih.settings.v1';
export const CURRENT_PREFERENCE_SCHEMA_VERSION = 1;

export const PREFERENCE_KEYS = Object.freeze([
  'city',
  'zmanimSource',
  'gpsCity',
  'customGpsLocation',
  'locationPermissionStatus',
  'nusach',
  'blessingDefaultDisplayMode',
  'notificationPreferences',
  'prayerStorageMode',
  'lastAccountSyncDecision',
] as const);

export const DEVICE_LOCAL_ONLY_PREFERENCE_KEYS = Object.freeze([
  'customGpsLocation',
  'locationPermissionStatus',
] as const);

export type PreferenceKey = (typeof PREFERENCE_KEYS)[number];
export type PreferenceSource = 'local' | 'legacy_secure_store';
export type ZmanimSource = 'gps' | 'manual';
export type LocationPermissionStatus = 'unknown' | 'granted' | 'denied';
export type PrayerStorageMode = 'local_only';
export type LastAccountSyncDecision = null;

export type LocalPreferences = {
  blessingDefaultDisplayMode: BlessingTextDisplayMode;
  city: string;
  customGpsLocation: CustomZmanimLocation | null;
  gpsCity: string | null;
  lastAccountSyncDecision: LastAccountSyncDecision;
  locationPermissionStatus: LocationPermissionStatus;
  notificationPreferences: ProfileNotificationPreferences;
  nusach: ProfileNusach;
  prayerStorageMode: PrayerStorageMode;
  zmanimSource: ZmanimSource;
};

export type PreferenceValueByKey = {
  [Key in PreferenceKey]: LocalPreferences[Key];
};

type LocalPreferenceRow = {
  key: string;
  value_json: string;
  updated_at: string;
  source: string;
  schema_version: number;
};

type PreferenceDatabase = Pick<
  SQLiteDatabase,
  'getAllAsync' | 'prepareAsync' | 'withExclusiveTransactionAsync'
>;

type PreferenceReader = Pick<SQLiteDatabase, 'getAllAsync'>;

type PreferenceWrite = {
  key: PreferenceKey;
  source: PreferenceSource;
  value: PreferenceValueByKey[PreferenceKey];
};

type NormalizedPreference<T> = {
  isValid: boolean;
  value: T;
};

type LegacySettingsParseResult =
  | { status: 'malformed' }
  | { status: 'valid'; writes: readonly PreferenceWrite[]; values: LocalPreferences };

export type LegacyPreferencesMigrationResult =
  | { status: 'no_legacy' | 'malformed_legacy' }
  | { status: 'transaction_failed' | 'read_back_failed' | 'cleanup_failed' }
  | { status: 'migrated' };

export const READ_LOCAL_PREFERENCES_SQL = `
  SELECT key, value_json, updated_at, source, schema_version
  FROM local_preferences
`;

export const UPSERT_LOCAL_PREFERENCE_SQL = `
  INSERT INTO local_preferences (key, value_json, updated_at, source, schema_version)
  VALUES (?, ?, ?, ?, ?)
  ON CONFLICT(key) DO UPDATE SET
    value_json = excluded.value_json,
    updated_at = excluded.updated_at,
    source = excluded.source,
    schema_version = excluded.schema_version
`;

const DELETE_LOCAL_PREFERENCE_SQL = `
  DELETE FROM local_preferences
  WHERE key = ?
`;

const preferenceKeySet = new Set<string>(PREFERENCE_KEYS);
let nativePersistenceQueue: Promise<void> = Promise.resolve();

export function createDefaultLocalPreferences(): LocalPreferences {
  return {
    blessingDefaultDisplayMode: 'ru',
    city: FALLBACK_ZMANIM_CITY,
    customGpsLocation: null,
    gpsCity: null,
    lastAccountSyncDecision: null,
    locationPermissionStatus: 'unknown',
    notificationPreferences: { ...DEFAULT_NOTIFICATION_PREFERENCES },
    nusach: 'common',
    prayerStorageMode: 'local_only',
    zmanimSource: 'gps',
  };
}

export function isPreferenceKey(value: unknown): value is PreferenceKey {
  return typeof value === 'string' && preferenceKeySet.has(value);
}

export function assertPreferenceKey(value: unknown): asserts value is PreferenceKey {
  if (!isPreferenceKey(value)) {
    throw new Error('Unknown local preference key');
  }
}

export function normalizePreferenceValue<Key extends PreferenceKey>(
  key: Key,
  value: unknown,
): PreferenceValueByKey[Key] {
  assertPreferenceKey(key);
  return normalizePreference(key, value).value as PreferenceValueByKey[Key];
}

export function serializePreferenceValue<Key extends PreferenceKey>(
  key: Key,
  value: unknown,
): string {
  assertPreferenceKey(key);
  return JSON.stringify(normalizePreferenceValue(key, value));
}

export function deserializePreferenceValue<Key extends PreferenceKey>(
  key: Key,
  valueJson: string,
): PreferenceValueByKey[Key] {
  assertPreferenceKey(key);

  try {
    return normalizePreferenceValue(key, JSON.parse(valueJson));
  } catch {
    return createDefaultLocalPreferences()[key];
  }
}

export async function readLocalPreferences(
  database: PreferenceReader,
): Promise<LocalPreferences> {
  const rows = await database.getAllAsync<LocalPreferenceRow>(READ_LOCAL_PREFERENCES_SQL);
  return decodePreferenceRows(rows).values;
}

export async function setLocalPreference<Key extends PreferenceKey>(
  database: PreferenceDatabase,
  key: Key,
  value: unknown,
  source: PreferenceSource = 'local',
  now: () => string = () => new Date().toISOString(),
): Promise<void> {
  assertPreferenceKey(key);
  assertPreferenceSource(source);

  await writePreferencesTransactionally(database, [{
    key,
    source,
    value: normalizePreferenceValue(key, value),
  }], now);
}

export async function migrateLegacySettingsValue({
  database,
  deleteLegacyValue,
  legacyValue,
  now = () => new Date().toISOString(),
}: {
  database: PreferenceDatabase;
  deleteLegacyValue: () => Promise<void>;
  legacyValue: string | null;
  now?: () => string;
}): Promise<LegacyPreferencesMigrationResult> {
  if (legacyValue === null) {
    return { status: 'no_legacy' };
  }

  const parsedLegacy = parseLegacySettingsValue(legacyValue);

  if (parsedLegacy.status === 'malformed') {
    return { status: 'malformed_legacy' };
  }

  try {
    await database.withExclusiveTransactionAsync(async (transaction) => {
      const existingRows = await transaction.getAllAsync<LocalPreferenceRow>(
        READ_LOCAL_PREFERENCES_SQL,
      );
      const existing = decodePreferenceRows(existingRows);
      const missingWrites = parsedLegacy.writes.filter(
        ({ key }) => !existing.validKeys.has(key),
      );

      await executePreferenceWrites(transaction, missingWrites, now);
    });
  } catch {
    return { status: 'transaction_failed' };
  }

  let readBackRows: LocalPreferenceRow[];

  try {
    readBackRows = await database.getAllAsync<LocalPreferenceRow>(READ_LOCAL_PREFERENCES_SQL);
  } catch {
    return { status: 'read_back_failed' };
  }

  const readBack = decodePreferenceRows(readBackRows);

  if (PREFERENCE_KEYS.some((key) => !readBack.validKeys.has(key))) {
    return { status: 'read_back_failed' };
  }

  try {
    await deleteLegacyValue();
  } catch {
    return { status: 'cleanup_failed' };
  }

  return { status: 'migrated' };
}

export async function loadNativePreferencesStorageValue(): Promise<string> {
  const legacyRead = await readLegacySettingsValue();
  const parsedLegacy = legacyRead.status === 'value'
    ? parseLegacySettingsValue(legacyRead.value)
    : { status: 'malformed' as const };
  const initialization = await initializeLocalDatabase();

  if (initialization.status !== 'ready') {
    const values = parsedLegacy.status === 'valid'
      ? parsedLegacy.values
      : createDefaultLocalPreferences();

    return createZustandStorageValue(values);
  }

  if (legacyRead.status === 'value') {
    await migrateLegacySettingsValue({
      database: initialization.database,
      deleteLegacyValue: () => SecureStore.deleteItemAsync(LEGACY_SETTINGS_STORAGE_KEY),
      legacyValue: legacyRead.value,
    });
  }

  const values = await readLocalPreferencesWithLegacyFallback(
    initialization.database,
    legacyRead.status === 'value' ? legacyRead.value : null,
  );

  return createZustandStorageValue(values);
}

export function enqueueNativePreferencesStorageWrite(storageValue: string): Promise<void> {
  const write = nativePersistenceQueue
    .catch(() => undefined)
    .then(() => persistNativePreferencesStorageValue(storageValue));

  nativePersistenceQueue = write.catch(() => undefined);
  return write.catch(() => undefined);
}

export function enqueueNativePreferencesClear(): Promise<void> {
  const clear = nativePersistenceQueue
    .catch(() => undefined)
    .then(() => clearNativePreferences());

  nativePersistenceQueue = clear.catch(() => undefined);
  return clear.catch(() => undefined);
}

function normalizePreference(
  key: PreferenceKey,
  value: unknown,
): NormalizedPreference<PreferenceValueByKey[PreferenceKey]> {
  switch (key) {
    case 'city':
      return normalizeCity(value);
    case 'zmanimSource':
      return value === 'manual' || value === 'gps'
        ? { isValid: true, value }
        : { isValid: false, value: 'gps' };
    case 'gpsCity':
      return normalizeGpsCity(value);
    case 'customGpsLocation':
      return normalizeCustomGpsLocation(value);
    case 'locationPermissionStatus':
      return value === 'granted' || value === 'denied' || value === 'unknown'
        ? { isValid: true, value }
        : { isValid: false, value: 'unknown' };
    case 'nusach': {
      const normalized = typeof value === 'string' ? normalizeProfileNusach(value) : 'common';
      return {
        isValid: isProfileNusach(value) || value === 'sephard'
          || value === 'beit_sefaradi' || value === 'ashkenazi',
        value: normalized,
      };
    }
    case 'blessingDefaultDisplayMode': {
      const normalized = normalizeBlessingTextDisplayMode(value);
      return {
        isValid: normalized === value,
        value: normalized,
      };
    }
    case 'notificationPreferences':
      return normalizeNotificationPreferences(value);
    case 'prayerStorageMode':
      return value === 'local_only'
        ? { isValid: true, value }
        : { isValid: false, value: 'local_only' };
    case 'lastAccountSyncDecision':
      return value === null
        ? { isValid: true, value: null }
        : { isValid: false, value: null };
  }
}

function normalizeCity(value: unknown): NormalizedPreference<string> {
  if (typeof value !== 'string' || !value.trim()) {
    return { isValid: false, value: FALLBACK_ZMANIM_CITY };
  }

  const city = normalizeZmanimCityName(value);

  return isSupportedZmanimCity(city)
    ? { isValid: true, value: city }
    : { isValid: false, value: FALLBACK_ZMANIM_CITY };
}

function normalizeGpsCity(value: unknown): NormalizedPreference<string | null> {
  if (value === null) {
    return { isValid: true, value: null };
  }

  if (typeof value === 'string' && value.trim()) {
    return { isValid: true, value: normalizeZmanimCityName(value) };
  }

  return { isValid: false, value: null };
}

function normalizeCustomGpsLocation(
  value: unknown,
): NormalizedPreference<CustomZmanimLocation | null> {
  if (value === null) {
    return { isValid: true, value: null };
  }

  if (!isPlainRecord(value)) {
    return { isValid: false, value: null };
  }

  const city = typeof value.city === 'string' && value.city.trim()
    ? normalizeZmanimCityName(value.city)
    : null;
  const latitude = numberFromUnknown(value.latitude);
  const longitude = numberFromUnknown(value.longitude);

  if (
    !city
    || !Number.isFinite(latitude)
    || latitude < -90
    || latitude > 90
    || !Number.isFinite(longitude)
    || longitude < -180
    || longitude > 180
  ) {
    return { isValid: false, value: null };
  }

  const timezone = typeof value.timezone === 'string' && value.timezone.trim()
    ? value.timezone.trim()
    : undefined;

  return {
    isValid: true,
    value: {
      city,
      latitude,
      longitude,
      ...(timezone ? { timezone } : {}),
    },
  };
}

function normalizeNotificationPreferences(
  value: unknown,
): NormalizedPreference<ProfileNotificationPreferences> {
  if (!isPlainRecord(value)) {
    return {
      isValid: false,
      value: { ...DEFAULT_NOTIFICATION_PREFERENCES },
    };
  }

  const defaults = DEFAULT_NOTIFICATION_PREFERENCES;
  const normalized: ProfileNotificationPreferences = {
    prayers: booleanOrDefault(value.prayers, defaults.prayers),
    shabbat: booleanOrDefault(value.shabbat, defaults.shabbat),
    holidays: booleanOrDefault(value.holidays, defaults.holidays),
    candles: booleanOrDefault(value.candles, defaults.candles),
    events: booleanOrDefault(value.events, defaults.events),
    birthdays: booleanOrDefault(value.birthdays, defaults.birthdays),
    weekly: booleanOrDefault(value.weekly, defaults.weekly),
    news: booleanOrDefault(value.news, defaults.news),
    candlesReminderOffsetMinutes: numberOrDefault(
      value.candlesReminderOffsetMinutes,
      defaults.candlesReminderOffsetMinutes,
    ),
    shabbatReminderOffsetHours: numberOrDefault(
      value.shabbatReminderOffsetHours,
      defaults.shabbatReminderOffsetHours,
    ),
    holidaysReminderHour: numberOrDefault(
      value.holidaysReminderHour,
      defaults.holidaysReminderHour,
    ),
    weeklyReminderOffsetHours: numberOrDefault(
      value.weeklyReminderOffsetHours,
      defaults.weeklyReminderOffsetHours,
    ),
    birthdaysReminderHour: numberOrDefault(
      value.birthdaysReminderHour,
      defaults.birthdaysReminderHour,
    ),
    eventsPrimaryReminderOffsetHours: numberOrDefault(
      value.eventsPrimaryReminderOffsetHours,
      defaults.eventsPrimaryReminderOffsetHours,
    ),
    eventsFallbackReminderOffsetHours: numberOrDefault(
      value.eventsFallbackReminderOffsetHours,
      defaults.eventsFallbackReminderOffsetHours,
    ),
    quietHoursEnabled: booleanOrDefault(
      value.quietHoursEnabled,
      defaults.quietHoursEnabled ?? false,
    ),
    quietHoursStart: timeOrDefault(
      value.quietHoursStart,
      defaults.quietHoursStart ?? '22:00',
    ),
    quietHoursEnd: timeOrDefault(
      value.quietHoursEnd,
      defaults.quietHoursEnd ?? '08:00',
    ),
  };

  return { isValid: true, value: normalized };
}

function parseLegacySettingsValue(value: string): LegacySettingsParseResult {
  let payload: unknown;

  try {
    payload = JSON.parse(value);
  } catch {
    return { status: 'malformed' };
  }

  if (!isPlainRecord(payload) || !isPlainRecord(payload.state)) {
    return { status: 'malformed' };
  }

  if (
    payload.version !== undefined
    && (!Number.isInteger(payload.version) || (payload.version as number) < 0 || (payload.version as number) > 3)
  ) {
    return { status: 'malformed' };
  }

  const state = payload.state;
  const values = createDefaultLocalPreferences();
  const legacyKeys = [
    'city',
    'zmanimSource',
    'gpsCity',
    'locationPermissionStatus',
    'blessingDefaultDisplayMode',
  ] as const;
  const legacySources = new Set<PreferenceKey>();

  for (const key of legacyKeys) {
    if (!Object.prototype.hasOwnProperty.call(state, key)) {
      continue;
    }

    const normalized = normalizePreference(key, state[key]);
    values[key] = normalized.value as never;

    if (normalized.isValid) {
      legacySources.add(key);
    }
  }

  const customLocationInput = Object.prototype.hasOwnProperty.call(state, 'customGpsLocation')
    ? state.customGpsLocation
    : state.gpsLocation;
  const customLocation = normalizeCustomGpsLocation(customLocationInput);
  values.customGpsLocation = customLocation.value;

  if (customLocation.isValid && customLocationInput !== undefined) {
    legacySources.add('customGpsLocation');
  }

  if (!legacySources.has('gpsCity') && customLocation.value) {
    values.gpsCity = customLocation.value.city;
    legacySources.add('gpsCity');
  }

  const writes = PREFERENCE_KEYS.map((key): PreferenceWrite => ({
    key,
    source: legacySources.has(key) ? 'legacy_secure_store' : 'local',
    value: values[key],
  }));

  return { status: 'valid', values, writes };
}

function decodePreferenceRows(rows: readonly LocalPreferenceRow[]) {
  const values = createDefaultLocalPreferences();
  const validKeys = new Set<PreferenceKey>();

  for (const row of rows) {
    if (
      !isPreferenceKey(row.key)
      || row.schema_version !== CURRENT_PREFERENCE_SCHEMA_VERSION
      || !isPreferenceSource(row.source)
      || typeof row.updated_at !== 'string'
      || !row.updated_at.trim()
      || typeof row.value_json !== 'string'
    ) {
      continue;
    }

    let parsed: unknown;

    try {
      parsed = JSON.parse(row.value_json);
    } catch {
      continue;
    }

    const normalized = normalizePreference(row.key, parsed);
    values[row.key] = normalized.value as never;

    if (normalized.isValid) {
      validKeys.add(row.key);
    }
  }

  return { validKeys, values };
}

async function readLocalPreferencesWithLegacyFallback(
  database: PreferenceReader,
  legacyValue: string | null,
): Promise<LocalPreferences> {
  const legacy = legacyValue === null
    ? { status: 'malformed' as const }
    : parseLegacySettingsValue(legacyValue);
  const fallbackValues = legacy.status === 'valid'
    ? legacy.values
    : createDefaultLocalPreferences();

  try {
    const rows = await database.getAllAsync<LocalPreferenceRow>(READ_LOCAL_PREFERENCES_SQL);
    const local = decodePreferenceRows(rows);

    for (const key of local.validKeys) {
      fallbackValues[key] = local.values[key] as never;
    }
  } catch {
    // Keep safely normalized legacy values in memory; the legacy key remains intact.
  }

  return fallbackValues;
}

async function writePreferencesTransactionally(
  database: PreferenceDatabase,
  writes: readonly PreferenceWrite[],
  now: () => string,
): Promise<void> {
  await database.withExclusiveTransactionAsync(async (transaction) => {
    await executePreferenceWrites(transaction, writes, now);
  });
}

async function executePreferenceWrites(
  database: Pick<SQLiteDatabase, 'prepareAsync'>,
  writes: readonly PreferenceWrite[],
  now: () => string,
): Promise<void> {
  if (writes.length === 0) {
    return;
  }

  const statement = await database.prepareAsync(UPSERT_LOCAL_PREFERENCE_SQL);

  try {
    for (const write of writes) {
      assertPreferenceKey(write.key);
      assertPreferenceSource(write.source);
      const normalizedValue = normalizePreferenceValue(write.key, write.value);

      await statement.executeAsync([
        write.key,
        JSON.stringify(normalizedValue),
        now(),
        write.source,
        CURRENT_PREFERENCE_SCHEMA_VERSION,
      ]);
    }
  } finally {
    await statement.finalizeAsync();
  }
}

async function persistNativePreferencesStorageValue(storageValue: string): Promise<void> {
  const writes = parseZustandStorageWrites(storageValue);

  if (!writes) {
    return;
  }

  const initialization = await initializeLocalDatabase();

  if (initialization.status !== 'ready') {
    return;
  }

  await writePreferencesTransactionally(initialization.database, writes, () => new Date().toISOString());
}

async function clearNativePreferences(): Promise<void> {
  const initialization = await initializeLocalDatabase();

  if (initialization.status !== 'ready') {
    return;
  }

  await initialization.database.withExclusiveTransactionAsync(async (transaction) => {
    const statement = await transaction.prepareAsync(DELETE_LOCAL_PREFERENCE_SQL);

    try {
      for (const key of PREFERENCE_KEYS) {
        await statement.executeAsync([key]);
      }
    } finally {
      await statement.finalizeAsync();
    }
  });
}

function parseZustandStorageWrites(storageValue: string): PreferenceWrite[] | null {
  let payload: unknown;

  try {
    payload = JSON.parse(storageValue);
  } catch {
    return null;
  }

  if (!isPlainRecord(payload) || !isPlainRecord(payload.state)) {
    return null;
  }

  const writes: PreferenceWrite[] = [];

  for (const key of PREFERENCE_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(payload.state, key)) {
      continue;
    }

    writes.push({
      key,
      source: 'local',
      value: normalizePreferenceValue(key, payload.state[key]),
    });
  }

  return writes;
}

function createZustandStorageValue(values: LocalPreferences): string {
  return JSON.stringify({ state: values, version: 4 });
}

async function readLegacySettingsValue(): Promise<
  { status: 'missing' | 'unavailable' } | { status: 'value'; value: string }
> {
  try {
    if (!(await SecureStore.isAvailableAsync())) {
      return { status: 'unavailable' };
    }

    const value = await SecureStore.getItemAsync(LEGACY_SETTINGS_STORAGE_KEY);
    return value === null ? { status: 'missing' } : { status: 'value', value };
  } catch {
    return { status: 'unavailable' };
  }
}

function assertPreferenceSource(value: unknown): asserts value is PreferenceSource {
  if (!isPreferenceSource(value)) {
    throw new Error('Unknown local preference source');
  }
}

function isPreferenceSource(value: unknown): value is PreferenceSource {
  return value === 'local' || value === 'legacy_secure_store';
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function numberFromUnknown(value: unknown) {
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && value.trim()) return Number(value);
  return NaN;
}

function booleanOrDefault(value: unknown, fallback: boolean) {
  return typeof value === 'boolean' ? value : fallback;
}

function numberOrDefault(value: unknown, fallback: number | undefined) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : fallback;
}

function timeOrDefault(value: unknown, fallback: string) {
  return typeof value === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)
    ? value
    : fallback;
}
