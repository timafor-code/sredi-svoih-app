import type { DailyZmanim } from './zmanim';

export type PrayerDayPeriod = 'dawn' | 'day' | 'sunset' | 'night';

function addMinutes(date: Date, minutes: number) {
  return new Date(date.getTime() + minutes * 60_000);
}

export function resolvePrayerDayPeriod(daily: DailyZmanim, now: Date): PrayerDayPeriod {
  const alot = daily.times.alot?.at;
  const sunrise = daily.times.sunrise?.at;
  const sunset = daily.times.sunset?.at;
  const tzeit = daily.times.tzeit?.at;

  if (!alot || !sunrise || !sunset || !tzeit) {
    return 'night';
  }

  const nowMs = now.getTime();
  const alotMs = alot.getTime();
  const sunriseMs = sunrise.getTime();
  const sunsetMs = sunset.getTime();
  const tzeitMs = tzeit.getTime();

  const dawnEndMs = addMinutes(sunrise, 60).getTime();
  const dayEndMs = addMinutes(sunset, -60).getTime();
  const sunsetStartMs = dayEndMs;
  const sunsetEndMs = addMinutes(tzeit, 45).getTime();

  if (nowMs >= alotMs && nowMs < dawnEndMs) return 'dawn';
  if (nowMs >= dawnEndMs && nowMs < dayEndMs) return 'day';
  if (nowMs >= sunsetStartMs && nowMs < sunsetEndMs) return 'sunset';
  if (Number.isNaN(sunriseMs) || Number.isNaN(sunsetMs) || Number.isNaN(tzeitMs)) {
    return 'night';
  }
  return 'night';
}
