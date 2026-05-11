import type { DailyZmanim } from './zmanim';

export type PrayerDaySegmentKind = 'prayer' | 'gap' | 'night';
export type PrayerDayPrayerKey = 'shacharit' | 'mincha' | 'maariv';

export interface PrayerDaySegment {
  id: string;
  kind: PrayerDaySegmentKind;
  prayer?: PrayerDayPrayerKey;
  label: string;
  start: Date;
  end: Date;
  durationMs: number;
  ratio: number;
  startPercent: number;
  endPercent: number;
  accent?: string;
  active: boolean;
}

export interface PrayerDayPosition {
  percent: number;
  withinSegmentId: string | null;
  withinKind: PrayerDaySegmentKind | null;
  withinPrayer: PrayerDayPrayerKey | null;
}

export interface PrayerDayScaleModel {
  segments: PrayerDaySegment[];
  timelineStart: Date;
  timelineEnd: Date;
  timelineDurationMs: number;
}

export interface BuildPrayerDaySegmentsInput {
  today: DailyZmanim;
  tomorrow?: DailyZmanim | null;
  now: Date;
}

const DAY_MS = 24 * 60 * 60 * 1000;

const PRAYER_ACCENTS: Record<PrayerDayPrayerKey, string> = {
  shacharit: '#F6A400',
  mincha: '#F0642A',
  maariv: '#6B7FD4',
};

export function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

export function formatSegmentTime(date: Date, timeZone: string): string {
  return date.toLocaleTimeString('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone,
  });
}

interface RawSegment {
  id: string;
  kind: PrayerDaySegmentKind;
  prayer?: PrayerDayPrayerKey;
  label: string;
  start: Date;
  end: Date;
}

function nextDayFallback(today: DailyZmanim): {
  alot: Date;
  sunrise: Date;
} {
  const alot = new Date(today.times.alot.at.getTime() + DAY_MS);
  const sunrise = new Date(today.times.sunrise.at.getTime() + DAY_MS);
  return { alot, sunrise };
}

export function buildPrayerDaySegments({
  today,
  tomorrow,
  now,
}: BuildPrayerDaySegmentsInput): PrayerDayScaleModel {
  const fallback = nextDayFallback(today);
  const nextAlotRaw = tomorrow?.times.alot.at ?? fallback.alot;
  const nextSunriseRaw = tomorrow?.times.sunrise.at ?? fallback.sunrise;

  const sunrise = today.times.sunrise.at;
  const sofZmanTfilla = today.times.sofZmanTfilla.at;
  const minchaGedola = today.times.minchaGedola.at;
  const sunset = today.times.sunset.at;
  const tzeit = today.times.tzeit.at;

  const timelineStart = sunrise;
  const timelineEnd =
    nextSunriseRaw.getTime() > timelineStart.getTime()
      ? nextSunriseRaw
      : new Date(timelineStart.getTime() + DAY_MS);

  const nextAlot =
    nextAlotRaw.getTime() > tzeit.getTime() && nextAlotRaw.getTime() < timelineEnd.getTime()
      ? nextAlotRaw
      : new Date(timelineStart.getTime() + DAY_MS - 60 * 60 * 1000);

  const timelineDurationMs = Math.max(1, timelineEnd.getTime() - timelineStart.getTime());

  const raw: RawSegment[] = [
    {
      id: 'shacharit',
      kind: 'prayer',
      prayer: 'shacharit',
      label: 'Шахарит',
      start: sunrise,
      end: sofZmanTfilla,
    },
    {
      id: 'gap-morning',
      kind: 'gap',
      label: 'Перерыв',
      start: sofZmanTfilla,
      end: minchaGedola,
    },
    {
      id: 'mincha',
      kind: 'prayer',
      prayer: 'mincha',
      label: 'Минха',
      start: minchaGedola,
      end: sunset,
    },
    {
      id: 'gap-evening',
      kind: 'gap',
      label: 'Между молитвами',
      start: sunset,
      end: tzeit,
    },
    {
      id: 'maariv',
      kind: 'prayer',
      prayer: 'maariv',
      label: 'Маарив',
      start: tzeit,
      end: nextAlot,
    },
    {
      id: 'night',
      kind: 'night',
      label: 'Ночь',
      start: nextAlot,
      end: timelineEnd,
    },
  ];

  const startMs = timelineStart.getTime();
  const endMs = timelineEnd.getTime();
  const nowMs = now.getTime();

  const segments: PrayerDaySegment[] = raw.map((seg) => {
    const segStartMs = Math.max(startMs, Math.min(endMs, seg.start.getTime()));
    const segEndMs = Math.max(segStartMs, Math.min(endMs, seg.end.getTime()));
    const durationMs = Math.max(0, segEndMs - segStartMs);
    const ratio = durationMs / timelineDurationMs;
    const startPercent = clampPercent((segStartMs - startMs) / timelineDurationMs);
    const endPercent = clampPercent((segEndMs - startMs) / timelineDurationMs);
    const active = durationMs > 0 && nowMs >= segStartMs && nowMs < segEndMs;

    return {
      id: seg.id,
      kind: seg.kind,
      prayer: seg.prayer,
      label: seg.label,
      start: new Date(segStartMs),
      end: new Date(segEndMs),
      durationMs,
      ratio,
      startPercent,
      endPercent,
      accent: seg.prayer ? PRAYER_ACCENTS[seg.prayer] : undefined,
      active,
    };
  });

  return {
    segments,
    timelineStart,
    timelineEnd,
    timelineDurationMs,
  };
}

export function getCurrentPrayerDayPosition(
  model: PrayerDayScaleModel,
  now: Date,
): PrayerDayPosition {
  const { segments, timelineStart, timelineDurationMs } = model;
  const raw =
    timelineDurationMs > 0 ? (now.getTime() - timelineStart.getTime()) / timelineDurationMs : 0;
  const percent = clampPercent(raw);
  const active = segments.find((seg) => seg.active);
  return {
    percent,
    withinSegmentId: active?.id ?? null,
    withinKind: active?.kind ?? null,
    withinPrayer: active?.prayer ?? null,
  };
}
