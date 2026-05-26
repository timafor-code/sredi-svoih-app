import { Pressable, StyleSheet, Text, View } from 'react-native';

import { GlassCard } from '@/components/glass/GlassCard';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { formatDurationRu, formatRuTime } from '@/lib/dates';
import type { PrayerWindow } from '@/lib/zmanim';
import { colors } from '@/theme/colors';

const mutedPrayerProgressColor = '#737782';

type PrayerCardLayoutVariant = 'active' | 'upcomingPreview' | 'compact';

function getPrayerPastVerb(prayerId: PrayerWindow['id']): 'прошел' | 'прошла' {
  return prayerId === 'mincha' ? 'прошла' : 'прошел';
}

function clampProgress(value: number) {
  return Math.max(0, Math.min(1, value));
}

export type PrayerWindowCardProps = {
  accent: string;
  active?: boolean;
  alreadyRecorded?: boolean;
  hebrew?: string;
  icon: string;
  onPress?: () => void;
  prayerId: PrayerWindow['id'];
  progress?: number;
  recordable?: boolean;
  state?: 'done' | 'upcoming';
  status?: string;
  timeZone: string;
  title: string;
  upcomingPreview?: boolean;
  upcomingPreviewProgress?: number;
  windowEnd: Date;
  windowStart: Date;
};

export function PrayerWindowCard({
  accent,
  active,
  alreadyRecorded = false,
  hebrew,
  icon,
  prayerId,
  progress = 0,
  recordable = false,
  state = 'done',
  status,
  onPress,
  timeZone,
  title,
  upcomingPreview = false,
  upcomingPreviewProgress = 0,
  windowEnd,
  windowStart,
}: PrayerWindowCardProps) {
  const inactive = !active;
  const done = inactive && state === 'done';
  const upcoming = inactive && state === 'upcoming';
  const layoutVariant: PrayerCardLayoutVariant = active
    ? 'active'
    : upcomingPreview
      ? 'upcomingPreview'
      : 'compact';
  const compact = layoutVariant === 'compact';
  const isUpcomingPreviewLayout = layoutVariant === 'upcomingPreview';
  const showProgress = layoutVariant !== 'compact';
  const progressValue = active
    ? clampProgress(progress)
    : isUpcomingPreviewLayout
      ? clampProgress(upcomingPreviewProgress)
      : 0;
  const progressPercent = Math.round(progressValue * 100);
  const nowMs = Date.now();
  const badgeLabel = active ? (alreadyRecorded ? 'Помолился' : 'ИДЁТ') : alreadyRecorded ? 'Помолился' : null;
  const overlineLabel = active
    ? 'СЕЙЧАС'
    : isUpcomingPreviewLayout
      ? 'БЛИЖАЙШАЯ'
      : done
        ? getPrayerPastVerb(prayerId).toUpperCase()
        : 'ДАЛЬШЕ';
  const sideValue = active
    ? formatDurationRu(Math.max(0, windowEnd.getTime() - nowMs))
    : isUpcomingPreviewLayout
      ? formatDurationRu(Math.max(0, windowStart.getTime() - nowMs))
      : done
        ? formatRuTime(windowEnd, timeZone)
        : formatRuTime(windowStart, timeZone);
  const sideLabel = active
    ? `осталось · ${progressPercent}%`
    : isUpcomingPreviewLayout
      ? `до начала · ${progressPercent}%`
      : done
        ? 'окончание'
        : 'начало';
  const timeLine = active
    ? `до ${formatRuTime(windowEnd, timeZone)}`
    : `${formatRuTime(windowStart, timeZone)} - ${formatRuTime(windowEnd, timeZone)}`;
  const progressColor = active ? colors.gold : accent;
  const tintColor = active ? colors.gold : isUpcomingPreviewLayout ? accent : mutedPrayerProgressColor;
  const hebrewLabel = status ?? hebrew;
  const emojiBoxStyle = active
    ? { borderColor: `${accent}55`, backgroundColor: `${accent}26` }
    : {
        borderColor: done || compact ? 'rgba(255,255,255,0.08)' : `${accent}33`,
        backgroundColor: done || compact ? 'rgba(255,255,255,0.04)' : `${accent}12`,
      };

  const card = (
    <GlassCard
      contentStyle={compact ? styles.compactPrayerContent : undefined}
      style={[
        styles.prayerCard,
        active && styles.activePrayer,
        compact && styles.compactPrayer,
        done && styles.passedPrayer,
        upcoming && !isUpcomingPreviewLayout && styles.upcomingPrayer,
        isUpcomingPreviewLayout && styles.upcomingPreviewPrayer,
        done && alreadyRecorded && styles.recordedPassedPrayer,
      ]}
    >
      <View style={[styles.prayerTint, { width: `${Math.round(progressValue * 100)}%`, backgroundColor: `${tintColor}14` }]} />
      <View style={[styles.prayerTop, compact && styles.compactPrayerTop]}>
        <View style={[styles.prayerLeft, compact && styles.compactPrayerLeft]}>
          <View style={[styles.emojiBox, compact && styles.compactEmojiBox, emojiBoxStyle]}>
            <Text style={[styles.emoji, compact && styles.compactEmoji, inactive && styles.inactiveEmoji]}>{icon}</Text>
          </View>
          <View style={styles.flex}>
            <View style={styles.rowGap}>
              <Text style={[styles.overline, compact && styles.compactOverline, inactive && styles.inactiveOverline]}>{overlineLabel} · {title.toUpperCase()}</Text>
              {badgeLabel ? (
                <Text style={[styles.statusBadge, compact && styles.compactStatusBadge, active && !alreadyRecorded && styles.activeStatusBadge, alreadyRecorded && styles.recordedBadge]}>
                  {badgeLabel}
                </Text>
              ) : null}
            </View>
            <View style={[styles.prayerTitleRow, compact && styles.compactPrayerTitleRow]}>
              <Text style={[styles.prayerTime, inactive && styles.inactivePrayerTime, done && styles.passedPrayerTime, compact && styles.compactPrayerTime]}>{timeLine}</Text>
              {hebrewLabel ? <Text style={[styles.prayerHebrew, compact && styles.compactPrayerHebrew, inactive && styles.inactivePrayerHebrew]}>{hebrewLabel}</Text> : null}
            </View>
          </View>
        </View>
        <View style={[styles.prayerRight, compact && styles.compactPrayerRight]}>
          <Text style={[styles.prayerValue, inactive && styles.inactiveValue, done && styles.passedValue, compact && styles.compactPrayerValue]}>{sideValue}</Text>
          <Text style={[styles.tinyMuted, compact && styles.compactTinyMuted, inactive && styles.inactiveTinyMuted]}>{sideLabel}</Text>
        </View>
      </View>
      {showProgress ? (
        <>
          <ProgressBar value={progressValue} color={progressColor} />
          <View style={styles.progressLegend}>
            <Text style={[styles.tinyMuted, inactive && styles.inactiveTinyMuted]}>
              {isUpcomingPreviewLayout ? 'начало через' : `${formatRuTime(windowStart, timeZone)} начало`}
            </Text>
            <Text style={[styles.tinyMuted, inactive && styles.inactiveTinyMuted]}>
              {isUpcomingPreviewLayout ? `${formatRuTime(windowStart, timeZone)} начало` : `${formatRuTime(windowEnd, timeZone)} окончание`}
            </Text>
          </View>
        </>
      ) : null}
    </GlassCard>
  );

  if (!onPress || !recordable || !active) {
    return card;
  }

  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => pressed && styles.cardPressed}
    >
      {card}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  prayerCard: {
    position: 'relative',
  },
  compactPrayer: {
    minHeight: 0,
  },
  compactPrayerContent: {
    paddingHorizontal: 12,
    paddingVertical: 11,
  },
  prayerTint: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
  },
  prayerTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
    marginBottom: 10,
  },
  compactPrayerTop: {
    gap: 8,
    marginBottom: 0,
  },
  prayerLeft: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minWidth: 0,
  },
  compactPrayerLeft: {
    gap: 7,
  },
  emojiBox: {
    width: 28,
    height: 28,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  compactEmojiBox: {
    width: 24,
    height: 24,
    borderRadius: 7,
  },
  emoji: {
    fontSize: 14,
  },
  compactEmoji: {
    fontSize: 12,
  },
  inactiveEmoji: {
    opacity: 0.56,
  },
  flex: {
    flex: 1,
    minWidth: 0,
  },
  rowGap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexWrap: 'wrap',
  },
  overline: {
    color: colors.textDim,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.8,
    includeFontPadding: false,
  },
  compactOverline: {
    fontSize: 9,
    letterSpacing: 0.6,
  },
  inactiveOverline: {
    color: colors.textGhost,
  },
  statusBadge: {
    overflow: 'hidden',
    borderRadius: 5,
    backgroundColor: 'rgba(255,255,255,0.10)',
    color: colors.textDim,
    fontSize: 9,
    fontWeight: '700',
    paddingHorizontal: 6,
    paddingVertical: 2,
    includeFontPadding: false,
  },
  compactStatusBadge: {
    borderRadius: 4,
    fontSize: 8,
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  activeStatusBadge: {
    backgroundColor: 'rgba(246,164,0,0.20)',
    color: colors.gold,
  },
  recordedBadge: {
    backgroundColor: 'rgba(76,175,80,0.16)',
    borderWidth: 1,
    borderColor: 'rgba(76,175,80,0.26)',
    color: colors.success,
  },
  prayerTitleRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 6,
    flexWrap: 'wrap',
    marginTop: 2,
  },
  compactPrayerTitleRow: {
    gap: 5,
    marginTop: 1,
  },
  prayerTime: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: -0.3,
  },
  inactivePrayerTime: {
    color: colors.textMuted,
  },
  passedPrayerTime: {
    color: colors.textFaint,
  },
  compactPrayerTime: {
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 0,
  },
  prayerHebrew: {
    color: colors.textGhost,
    fontSize: 12,
    fontStyle: 'italic',
  },
  compactPrayerHebrew: {
    fontSize: 11,
  },
  inactivePrayerHebrew: {
    color: colors.textDim,
  },
  prayerRight: {
    alignItems: 'flex-end',
  },
  compactPrayerRight: {
    flexShrink: 0,
  },
  prayerValue: {
    color: colors.gold,
    fontSize: 20,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  inactiveValue: {
    color: colors.textFaint,
    fontSize: 14,
    letterSpacing: 0,
  },
  passedValue: {
    color: colors.textGhost,
  },
  compactPrayerValue: {
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0,
  },
  activePrayer: {
    borderColor: 'rgba(246,164,0,0.30)',
    backgroundColor: 'rgba(246,164,0,0.06)',
  },
  passedPrayer: {
    borderColor: 'rgba(255,255,255,0.055)',
    backgroundColor: 'rgba(255,255,255,0.025)',
  },
  upcomingPrayer: {
    borderColor: 'rgba(255,255,255,0.075)',
    backgroundColor: 'rgba(255,255,255,0.035)',
  },
  upcomingPreviewPrayer: {
    borderColor: 'rgba(246,164,0,0.20)',
    backgroundColor: 'rgba(255,255,255,0.045)',
  },
  recordedPassedPrayer: {
    borderColor: 'rgba(76,175,80,0.18)',
  },
  cardPressed: {
    opacity: 0.86,
    transform: [{ scale: 0.99 }],
  },
  progressLegend: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 5,
  },
  tinyMuted: {
    color: colors.textGhost,
    fontSize: 10,
    fontWeight: '500',
  },
  compactTinyMuted: {
    fontSize: 9,
  },
  inactiveTinyMuted: {
    color: 'rgba(255,255,255,0.28)',
  },
});
