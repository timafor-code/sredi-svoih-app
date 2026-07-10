import { supabase } from './supabaseClient';
import type {
  HebrewDatePayload,
  LoadPrayerActivityParams,
  PrayerActivityLog,
  PrayerActivityMetadata,
  PrayerActivityType,
  RecordPrayerActivityInput,
} from '@/types/prayerTracker';

import { isMobileApiProviderEnabled } from './apiClient';
import * as prayerTrackerApiService from './prayerTrackerApiService';

const DEFAULT_TIMEZONE = 'Europe/Moscow';
const AUTH_REQUIRED_MESSAGE = 'Нужен вход. Чтобы вести молитвенный трекер, войдите в приложение.';

type PrayerActivityLogRow = {
  id: string;
  user_id: string;
  activity_type: PrayerActivityType;
  activity_date: string;
  started_at: string | null;
  completed_at: string | null;
  timezone: string;
  city: string | null;
  hebrew_date: unknown;
  metadata: unknown;
  created_at: string;
  updated_at: string;
};

const PRAYER_ACTIVITY_FIELDS = `
  id,
  user_id,
  activity_type,
  activity_date,
  started_at,
  completed_at,
  timezone,
  city,
  hebrew_date,
  metadata,
  created_at,
  updated_at
`;

function isAuthSessionMissing(error: { message?: string; name?: string }): boolean {
  const message = error.message?.toLowerCase() ?? '';

  return error.name === 'AuthSessionMissingError' || message.includes('auth session missing');
}

async function getCurrentUserId(): Promise<string | null> {
  const { data, error } = await supabase.auth.getUser();

  if (error) {
    if (isAuthSessionMissing(error)) {
      return null;
    }

    throw new Error(error.message);
  }

  return data.user?.id ?? null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeJsonObject(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function normalizePrayerActivityRow(row: PrayerActivityLogRow): PrayerActivityLog {
  return {
    id: row.id,
    userId: row.user_id,
    activityType: row.activity_type,
    activityDate: row.activity_date,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    timezone: row.timezone,
    city: row.city,
    hebrewDate: normalizeJsonObject(row.hebrew_date),
    metadata: normalizeJsonObject(row.metadata),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function normalizeTimestamp(value: Date | string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  const date = value instanceof Date ? value : new Date(value);

  if (Number.isNaN(date.getTime())) {
    throw new Error('Некорректное время активности.');
  }

  return date.toISOString();
}

function formatDateInTimezone(value: string, timezone: string): string {
  const date = new Date(value);
  const formatter = new Intl.DateTimeFormat('en-CA', {
    day: '2-digit',
    month: '2-digit',
    timeZone: timezone,
    year: 'numeric',
  });
  const parts = formatter.formatToParts(date);
  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  const day = parts.find((part) => part.type === 'day')?.value;

  if (!year || !month || !day) {
    throw new Error('Не удалось определить локальную дату активности.');
  }

  return `${year}-${month}-${day}`;
}

function resolveActivityDate(
  input: RecordPrayerActivityInput,
  startedAt: string | null,
  completedAt: string | null,
  timezone: string,
): string {
  if (input.activityDate) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.activityDate)) {
      throw new Error('Дата активности должна быть в формате YYYY-MM-DD.');
    }

    return input.activityDate;
  }

  const timestamp = startedAt ?? completedAt;

  if (!timestamp) {
    throw new Error('Укажите время начала или завершения активности.');
  }

  try {
    return formatDateInTimezone(timestamp, timezone);
  } catch {
    throw new Error('Не удалось определить дату активности для выбранного часового пояса.');
  }
}

async function loadExistingActivity(
  userId: string,
  activityDate: string,
  activityType: PrayerActivityType,
): Promise<PrayerActivityLogRow | null> {
  const { data, error } = await supabase
    .from('prayer_activity_logs')
    .select(PRAYER_ACTIVITY_FIELDS)
    .eq('user_id', userId)
    .eq('activity_date', activityDate)
    .eq('activity_type', activityType)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return data as PrayerActivityLogRow | null;
}

function mergePayloadObject<T extends HebrewDatePayload | PrayerActivityMetadata>(
  existingValue: unknown,
  inputValue: T | undefined,
): T {
  return {
    ...normalizeJsonObject(existingValue),
    ...(inputValue ?? {}),
  } as T;
}

export async function recordPrayerActivity(input: RecordPrayerActivityInput): Promise<PrayerActivityLog> {
  if (isMobileApiProviderEnabled('prayer')) {
    return prayerTrackerApiService.recordPrayerActivity(input);
  }

  const userId = await getCurrentUserId();

  if (!userId) {
    throw new Error(AUTH_REQUIRED_MESSAGE);
  }

  const startedAt = normalizeTimestamp(input.startedAt);
  const completedAt = normalizeTimestamp(input.completedAt);
  const timezone = input.timezone?.trim() || DEFAULT_TIMEZONE;
  const activityDate = resolveActivityDate(input, startedAt, completedAt, timezone);
  const existingActivity = await loadExistingActivity(userId, activityDate, input.activityType);
  const payload = {
    user_id: userId,
    activity_type: input.activityType,
    activity_date: activityDate,
    started_at: startedAt ?? existingActivity?.started_at ?? null,
    completed_at: completedAt ?? existingActivity?.completed_at ?? null,
    timezone,
    city: input.city ?? existingActivity?.city ?? null,
    hebrew_date: mergePayloadObject(existingActivity?.hebrew_date, input.hebrewDate),
    metadata: mergePayloadObject(existingActivity?.metadata, input.metadata),
  };

  if (!payload.started_at && !payload.completed_at) {
    throw new Error('Укажите время начала или завершения активности.');
  }

  const { data, error } = await supabase
    .from('prayer_activity_logs')
    .upsert(payload, { onConflict: 'user_id,activity_date,activity_type' })
    .select(PRAYER_ACTIVITY_FIELDS)
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return normalizePrayerActivityRow(data as PrayerActivityLogRow);
}

export async function loadMyPrayerActivity(
  params: LoadPrayerActivityParams = {},
): Promise<PrayerActivityLog[]> {
  if (isMobileApiProviderEnabled('prayer')) {
    return prayerTrackerApiService.loadMyPrayerActivity(params);
  }

  const userId = await getCurrentUserId();

  if (!userId) {
    return [];
  }

  let query = supabase
    .from('prayer_activity_logs')
    .select(PRAYER_ACTIVITY_FIELDS)
    .eq('user_id', userId)
    .order('activity_date', { ascending: false })
    .order('created_at', { ascending: false });

  if (params.fromDate) {
    query = query.gte('activity_date', params.fromDate);
  }

  if (params.toDate) {
    query = query.lte('activity_date', params.toDate);
  }

  if (typeof params.limit === 'number') {
    query = query.limit(Math.max(1, Math.min(params.limit, 500)));
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(error.message);
  }

  return ((data ?? []) as PrayerActivityLogRow[]).map(normalizePrayerActivityRow);
}
