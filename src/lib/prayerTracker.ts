import type { PrayerWindow } from '@/lib/zmanim';
import type { PrayerActivityLog, PrayerActivityType } from '@/types/prayerTracker';

export const MORNING_SHEMA_ACTIVITY_TYPE = 'shema_morning' satisfies PrayerActivityType;
export const OMER_COUNT_ACTIVITY_TYPE = 'omer_count' satisfies PrayerActivityType;

export function formatLocalDateKey(date: Date | string, timeZone: string): string {
  const value = date instanceof Date ? date : new Date(date);
  const formatter = new Intl.DateTimeFormat('en-CA', {
    day: '2-digit',
    month: '2-digit',
    timeZone,
    year: 'numeric',
  });
  const parts = formatter.formatToParts(value);
  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  const day = parts.find((part) => part.type === 'day')?.value;

  return year && month && day ? `${year}-${month}-${day}` : value.toISOString().slice(0, 10);
}

export function hasRecordedActivity(
  items: PrayerActivityLog[],
  activityType: PrayerActivityType,
  activityDate: string,
  userId?: string | null,
): boolean {
  return items.some(
    (item) =>
      item.activityType === activityType
      && item.activityDate === activityDate
      && (!userId || item.userId === userId),
  );
}

export function hasRecordedMorningShema(
  items: PrayerActivityLog[],
  activityDate: string,
  userId?: string | null,
): boolean {
  return hasRecordedActivity(items, MORNING_SHEMA_ACTIVITY_TYPE, activityDate, userId);
}

export function hasRecordedOmerCount(
  items: PrayerActivityLog[],
  activityDate: string,
  userId?: string | null,
): boolean {
  return hasRecordedActivity(items, OMER_COUNT_ACTIVITY_TYPE, activityDate, userId);
}

export function prayerActivityTypeFromPrayerId(prayerId: PrayerWindow['id']): PrayerActivityType {
  return prayerId;
}
