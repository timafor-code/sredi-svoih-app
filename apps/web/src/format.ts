export function formatDate(value: string, timeZone: string | null): string {
  return format(value, timeZone, { day: "numeric", month: "long", year: "numeric" });
}

export function formatTime(value: string, timeZone: string | null): string {
  return format(value, timeZone, { hour: "2-digit", minute: "2-digit" });
}

function format(
  value: string,
  timeZone: string | null,
  options: Intl.DateTimeFormatOptions,
): string {
  try {
    return new Intl.DateTimeFormat("ru-RU", { ...options, timeZone: timeZone || undefined })
      .format(new Date(value));
  } catch {
    return new Intl.DateTimeFormat("ru-RU", options).format(new Date(value));
  }
}

export function formatDateTimeRange(
  startsAt: string,
  endsAt: string | null,
  timeZone: string | null,
): string {
  const start = `${formatDate(startsAt, timeZone)}, ${formatTime(startsAt, timeZone)}`;
  return endsAt ? `${start} — ${formatTime(endsAt, timeZone)}` : start;
}
