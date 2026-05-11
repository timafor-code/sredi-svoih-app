import { LinearGradient } from 'expo-linear-gradient';
import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { formatRuTime } from '@/lib/dates';
import {
  buildPrayerDaySegments,
  getCurrentPrayerDayPosition,
  type PrayerDayPrayerKey,
  type PrayerDaySegment,
} from '@/lib/prayerDayScale';
import type { DailyZmanim } from '@/lib/zmanim';
import { colors } from '@/theme/colors';

interface Props {
  today: DailyZmanim;
  tomorrow?: DailyZmanim | null;
  now: Date;
}

const PRAYER_GRADIENTS: Record<PrayerDayPrayerKey, [string, string]> = {
  shacharit: ['rgba(255,200,50,0.55)', 'rgba(246,164,0,0.30)'],
  mincha: ['rgba(255,150,70,0.60)', 'rgba(240,100,42,0.30)'],
  maariv: ['rgba(140,160,235,0.55)', 'rgba(80,100,200,0.30)'],
};

const GAP_GRADIENT: [string, string] = ['rgba(255,255,255,0.10)', 'rgba(255,255,255,0.04)'];
const NIGHT_GRADIENT: [string, string] = ['rgba(60,80,130,0.45)', 'rgba(20,30,55,0.30)'];

const MIN_LABEL_RATIO = 0.10;
const MARKER_LABEL_WIDTH = 52;
const MIN_VISUAL_FLEX = 0.02;

export function PrayerDayScale({ today, tomorrow, now }: Props) {
  const model = useMemo(
    () => buildPrayerDaySegments({ today, tomorrow, now }),
    [today, tomorrow, now],
  );
  const position = useMemo(() => getCurrentPrayerDayPosition(model, now), [model, now]);

  const timeLabel = formatRuTime(now, today.timeZone);
  const markerPct = Math.round(position.percent * 1000) / 10;
  const onTimeline =
    now.getTime() >= model.timelineStart.getTime() && now.getTime() <= model.timelineEnd.getTime();

  return (
    <View style={styles.wrap}>
      <View style={styles.barFrame}>
        <View style={styles.bar}>
          {model.segments.map((seg) => (
            <SegmentView key={seg.id} segment={seg} />
          ))}
        </View>
        {onTimeline ? (
          <View pointerEvents="none" style={styles.markerLayer}>
            <View style={[styles.markerLabel, { left: `${markerPct}%` }]}>
              <Text style={styles.markerLabelText}>{timeLabel}</Text>
            </View>
            <View style={[styles.markerLine, { left: `${markerPct}%` }]} />
            <View style={[styles.markerGlow, { left: `${markerPct}%` }]} />
          </View>
        ) : null}
      </View>
    </View>
  );
}

function SegmentView({ segment }: { segment: PrayerDaySegment }) {
  const flexValue = Math.max(MIN_VISUAL_FLEX, segment.ratio);

  const gradient =
    segment.kind === 'prayer' && segment.prayer
      ? PRAYER_GRADIENTS[segment.prayer]
      : segment.kind === 'night'
        ? NIGHT_GRADIENT
        : GAP_GRADIENT;

  const showLabel = segment.kind === 'prayer' && segment.ratio >= MIN_LABEL_RATIO;

  return (
    <View
      style={[
        styles.segmentShell,
        { flex: flexValue },
        segment.active && segment.kind === 'prayer' && styles.segmentActive,
        segment.active && segment.accent
          ? { borderColor: hexToRgba(segment.accent, 0.75) }
          : null,
      ]}
    >
      <LinearGradient
        colors={gradient}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
        style={StyleSheet.absoluteFillObject}
      />
      {segment.active ? <View style={styles.segmentActiveSheen} /> : null}
      {showLabel ? (
        <Text style={styles.segmentLabel} numberOfLines={1}>
          {segment.label}
        </Text>
      ) : null}
    </View>
  );
}

function hexToRgba(hex: string, alpha: number) {
  const value = hex.replace('#', '');
  const bigint = parseInt(value, 16);
  const r = (bigint >> 16) & 255;
  const g = (bigint >> 8) & 255;
  const b = bigint & 255;
  return `rgba(${r},${g},${b},${alpha})`;
}

const styles = StyleSheet.create({
  wrap: {
    marginBottom: 12,
  },
  barFrame: {
    position: 'relative',
    paddingTop: 22,
  },
  bar: {
    height: 30,
    flexDirection: 'row',
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.glass.w10,
    backgroundColor: 'rgba(10,14,22,0.55)',
    gap: 2,
  },
  segmentShell: {
    overflow: 'hidden',
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 4,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  segmentActive: {
    borderWidth: 1.5,
  },
  segmentActiveSheen: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(255,255,255,0.10)',
  },
  segmentLabel: {
    color: 'rgba(255,255,255,0.92)',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.2,
    paddingHorizontal: 4,
  },
  markerLayer: {
    ...StyleSheet.absoluteFillObject,
  },
  markerLabel: {
    position: 'absolute',
    top: 0,
    marginLeft: -(MARKER_LABEL_WIDTH / 2),
    width: MARKER_LABEL_WIDTH,
    alignItems: 'center',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.glass.w20,
    backgroundColor: 'rgba(20,24,34,0.85)',
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  markerLabelText: {
    color: colors.text,
    fontSize: 10,
    fontWeight: '700',
  },
  markerLine: {
    position: 'absolute',
    top: 18,
    marginLeft: -1,
    width: 2,
    height: 34,
    borderRadius: 1,
    backgroundColor: '#FFFFFF',
    opacity: 0.85,
  },
  markerGlow: {
    position: 'absolute',
    top: 14,
    marginLeft: -6,
    width: 12,
    height: 42,
    borderRadius: 6,
    backgroundColor: 'rgba(255,255,255,0.18)',
  },
});
