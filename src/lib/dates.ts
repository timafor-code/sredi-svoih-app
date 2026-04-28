export const DEFAULT_TIME_ZONE = 'Europe/Moscow';

export const formatRuDate = (date: Date, timeZone = DEFAULT_TIME_ZONE) =>
  date.toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long',
    timeZone,
    year: 'numeric',
  });

export const formatRuDayMonth = (date: Date, timeZone = DEFAULT_TIME_ZONE) =>
  date.toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long',
    timeZone,
  });

export const formatRuWeekdayDayMonth = (date: Date, timeZone = DEFAULT_TIME_ZONE) =>
  date.toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'short',
    timeZone,
    weekday: 'long',
  });

export const formatRuTime = (date: Date, timeZone = DEFAULT_TIME_ZONE) =>
  date.toLocaleTimeString('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone,
  });

export function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

export function clamp01(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

export function progressBetween(start: Date, end: Date, now: Date) {
  return clamp01((now.getTime() - start.getTime()) / (end.getTime() - start.getTime()));
}

export function daysUntil(date: Date, fromDate: Date = new Date()) {
  const start = new Date(fromDate.getFullYear(), fromDate.getMonth(), fromDate.getDate()).getTime();
  const end = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  return Math.max(0, Math.ceil((end - start) / 86_400_000));
}

export function formatDurationRu(ms: number) {
  const totalMinutes = Math.max(0, Math.ceil(ms / 60_000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours <= 0) return `${minutes} мин`;
  if (minutes === 0) return `${hours} ч`;
  return `${hours} ч ${minutes} мин`;
}
