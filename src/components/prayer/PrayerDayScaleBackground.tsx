import { LinearGradient } from 'expo-linear-gradient';
import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';

import type { PrayerDayPeriod } from '@/lib/prayerDayPeriod';

type PrayerDayScaleBackgroundProps = {
  period: PrayerDayPeriod;
};

const STAR_SEED: ReadonlyArray<{ top: number; left: number; size: number; opacity: number }> = [
  { top: 8, left: 6, size: 2, opacity: 0.85 },
  { top: 14, left: 22, size: 1, opacity: 0.55 },
  { top: 6, left: 38, size: 1.5, opacity: 0.7 },
  { top: 20, left: 54, size: 2, opacity: 0.8 },
  { top: 10, left: 70, size: 1, opacity: 0.5 },
  { top: 18, left: 86, size: 1.5, opacity: 0.65 },
  { top: 4, left: 14, size: 1, opacity: 0.4 },
  { top: 26, left: 30, size: 1, opacity: 0.45 },
  { top: 32, left: 46, size: 1.5, opacity: 0.6 },
  { top: 24, left: 62, size: 1, opacity: 0.5 },
  { top: 30, left: 78, size: 2, opacity: 0.75 },
  { top: 36, left: 92, size: 1, opacity: 0.4 },
  { top: 12, left: 50, size: 1, opacity: 0.45 },
  { top: 22, left: 12, size: 1.5, opacity: 0.6 },
  { top: 38, left: 26, size: 1, opacity: 0.5 },
  { top: 42, left: 58, size: 1.5, opacity: 0.7 },
  { top: 16, left: 74, size: 1, opacity: 0.45 },
  { top: 40, left: 90, size: 1, opacity: 0.55 },
  { top: 44, left: 18, size: 1, opacity: 0.4 },
  { top: 8, left: 82, size: 1.5, opacity: 0.6 },
  { top: 28, left: 40, size: 1, opacity: 0.5 },
  { top: 34, left: 8, size: 1, opacity: 0.45 },
  { top: 46, left: 70, size: 1, opacity: 0.5 },
  { top: 2, left: 28, size: 1, opacity: 0.4 },
  { top: 48, left: 44, size: 1, opacity: 0.45 },
];

export function PrayerDayScaleBackground({ period }: PrayerDayScaleBackgroundProps) {
  const stars = useMemo(
    () => (period === 'night' ? STAR_SEED : []),
    [period],
  );

  if (period === 'dawn') {
    return (
      <View pointerEvents="none" style={styles.fill}>
        <LinearGradient
          colors={['#1B2545', '#3A3560', '#7E5A6E', '#D89A82']}
          locations={[0, 0.35, 0.7, 1]}
          start={{ x: 0.5, y: 0 }}
          end={{ x: 0.5, y: 1 }}
          style={StyleSheet.absoluteFillObject}
        />
        <View style={[styles.softBlob, styles.dawnGlowLeft]} />
        <View style={[styles.softBlob, styles.dawnHaze]} />
        <LinearGradient
          colors={['rgba(255,200,140,0)', 'rgba(255,180,120,0.30)']}
          start={{ x: 0.5, y: 0.55 }}
          end={{ x: 0.5, y: 1 }}
          style={styles.horizonStrip}
        />
        <View style={styles.contentOverlay} />
      </View>
    );
  }

  if (period === 'day') {
    return (
      <View pointerEvents="none" style={styles.fill}>
        <LinearGradient
          colors={['#0E1A3A', '#1B3A6B', '#2A5C9A']}
          locations={[0, 0.55, 1]}
          start={{ x: 0.2, y: 0 }}
          end={{ x: 0.8, y: 1 }}
          style={StyleSheet.absoluteFillObject}
        />
        <View style={[styles.softBlob, styles.dayLight]} />
        <LinearGradient
          colors={['rgba(120,180,255,0.16)', 'rgba(120,180,255,0)']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFillObject}
        />
        <View style={styles.contentOverlay} />
      </View>
    );
  }

  if (period === 'sunset') {
    return (
      <View pointerEvents="none" style={styles.fill}>
        <LinearGradient
          colors={['#1A1F4A', '#3D2F6B', '#A04E6E', '#E68A4A']}
          locations={[0, 0.4, 0.75, 1]}
          start={{ x: 0.5, y: 0 }}
          end={{ x: 0.5, y: 1 }}
          style={StyleSheet.absoluteFillObject}
        />
        <View style={[styles.softBlob, styles.sunsetCloudLeft]} />
        <View style={[styles.softBlob, styles.sunsetCloudRight]} />
        <LinearGradient
          colors={['rgba(255,130,90,0)', 'rgba(255,140,90,0.32)']}
          start={{ x: 0.5, y: 0.5 }}
          end={{ x: 0.5, y: 1 }}
          style={styles.horizonStrip}
        />
        <View style={styles.contentOverlay} />
      </View>
    );
  }

  return (
    <View pointerEvents="none" style={styles.fill}>
      <LinearGradient
        colors={['#04060F', '#0A1228', '#161E3D']}
        locations={[0, 0.55, 1]}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
        style={StyleSheet.absoluteFillObject}
      />
      {stars.map((star, idx) => (
        <View
          key={`star-${idx}`}
          style={{
            position: 'absolute',
            top: `${star.top}%`,
            left: `${star.left}%`,
            width: star.size,
            height: star.size,
            borderRadius: star.size / 2,
            backgroundColor: '#FFFFFF',
            opacity: star.opacity,
          }}
        />
      ))}
      <LinearGradient
        colors={['rgba(80,60,160,0)', 'rgba(80,60,160,0.35)']}
        start={{ x: 0.5, y: 0.55 }}
        end={{ x: 0.5, y: 1 }}
        style={styles.horizonStrip}
      />
      <View style={[styles.softBlob, styles.nightGlow]} />
      <View style={styles.contentOverlay} />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: {
    ...StyleSheet.absoluteFillObject,
    overflow: 'hidden',
  },
  horizonStrip: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: '55%',
  },
  contentOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.22)',
  },
  softBlob: {
    position: 'absolute',
    borderRadius: 999,
  },
  dawnGlowLeft: {
    width: 220,
    height: 220,
    left: -60,
    bottom: -110,
    backgroundColor: 'rgba(255,180,140,0.18)',
  },
  dawnHaze: {
    width: 260,
    height: 160,
    right: -70,
    top: -40,
    backgroundColor: 'rgba(120,140,200,0.14)',
  },
  dayLight: {
    width: 240,
    height: 240,
    top: -120,
    left: -80,
    backgroundColor: 'rgba(170,210,255,0.16)',
  },
  sunsetCloudLeft: {
    width: 200,
    height: 70,
    left: -40,
    top: '38%',
    backgroundColor: 'rgba(120,80,160,0.18)',
  },
  sunsetCloudRight: {
    width: 220,
    height: 60,
    right: -50,
    top: '52%',
    backgroundColor: 'rgba(180,90,140,0.18)',
  },
  nightGlow: {
    width: 260,
    height: 180,
    left: '20%',
    bottom: -100,
    backgroundColor: 'rgba(90,70,180,0.18)',
  },
});
