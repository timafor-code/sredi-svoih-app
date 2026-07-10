import type {
  ApiPrayerActivityLogResponse,
  ApiRecordPrayerActivityRequest,
} from '@/types/api';
import type {
  LoadPrayerActivityParams,
  PrayerActivityLog,
  RecordPrayerActivityInput,
} from '@/types/prayerTracker';

import { apiClient, ApiClientError } from './apiClient';

const DEFAULT_TIMEZONE = 'Europe/Moscow';
const AUTH_REQUIRED_MESSAGE = 'Нужен вход. Чтобы вести молитвенный трекер, войдите в приложение.';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeJsonObject(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function normalizePrayerActivityLog(row: ApiPrayerActivityLogResponse): PrayerActivityLog {
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

function isUnauthenticatedError(error: unknown): boolean {
  return error instanceof ApiClientError
    && (error.status === 401 || error.code === 'unauthenticated');
}

function normalizeLoadParams(params: LoadPrayerActivityParams): {
  from_date: string | undefined;
  to_date: string | undefined;
  limit: number | undefined;
} {
  return {
    from_date: params.fromDate,
    to_date: params.toDate,
    limit: typeof params.limit === 'number'
      ? Math.max(1, Math.min(params.limit, 500))
      : undefined,
  };
}

function createRecordPayload(input: RecordPrayerActivityInput): ApiRecordPrayerActivityRequest {
  const startedAt = normalizeTimestamp(input.startedAt);
  const completedAt = normalizeTimestamp(input.completedAt);
  const timezone = input.timezone?.trim() || DEFAULT_TIMEZONE;

  return {
    activity_type: input.activityType,
    activity_date: resolveActivityDate(input, startedAt, completedAt, timezone),
    started_at: startedAt,
    completed_at: completedAt,
    timezone,
    city: input.city ?? null,
    hebrew_date: input.hebrewDate ?? {},
    metadata: input.metadata ?? {},
  };
}

export async function recordPrayerActivity(
  input: RecordPrayerActivityInput,
): Promise<PrayerActivityLog> {
  try {
    const response = await apiClient.post<
      ApiPrayerActivityLogResponse,
      ApiRecordPrayerActivityRequest
    >('/me/prayer-logs', createRecordPayload(input));

    return normalizePrayerActivityLog(response);
  } catch (error) {
    if (isUnauthenticatedError(error)) {
      throw new Error(AUTH_REQUIRED_MESSAGE);
    }

    throw error;
  }
}

export async function loadMyPrayerActivity(
  params: LoadPrayerActivityParams = {},
): Promise<PrayerActivityLog[]> {
  try {
    const response = await apiClient.get<ApiPrayerActivityLogResponse[] | null>(
      '/me/prayer-logs',
      { query: normalizeLoadParams(params) },
    );

    return (response ?? []).map(normalizePrayerActivityLog);
  } catch (error) {
    if (isUnauthenticatedError(error)) {
      return [];
    }

    throw error;
  }
}
