import { Pressable, StyleSheet, Text, View } from 'react-native';

import { GlassCard } from '@/components/glass/GlassCard';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { formatDurationRu, formatRuTime } from '@/lib/dates';
import type { PrayerWindow } from '@/lib/zmanim';
import { colors } from '@/theme/colors';

const mutedPrayerProgressColor = '#737782';

function getPrayerPastVerb(prayerId: PrayerWindow['id']): 'прошел' | 'прошла' {
  return prayerId === 'mincha' ? 'прошла' : 'прошел';
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
  windowEnd,
  windowStart,
}: PrayerWindowCardProps) {
  const inactive = !active;
  const done = inactive && state === 'done';
  const upcoming = inactive && state === 'upcoming';
  const progressValue = active ? progress : done ? 1 : 0;
  const badgeLabel = active ? (alreadyRecorded ? 'Помолился' : 'ИДЁТ') : alreadyRecorded ? 'Помолился' : null;
  const overlineLabel = active ? 'СЕЙЧАС' : done ? getPrayerPastVerb(prayerId).toUpperCase() : 'ДАЛЬШЕ';
  const sideValue = active
    ? formatDurationRu(windowEnd.getTime() - Date.now())
    : done
      ? formatRuTime(windowEnd, timeZone)
      : formatRuTime(windowStart, timeZone);
  const sideLabel = active ? `осталось · ${Math.round(progress * 100)}%` : done ? 'окончание' : 'начало';
  const timeLine = active
    ? `до ${formatRuTime(windowEnd, timeZone)}`
    : `${formatRuTime(windowStart, timeZone)} - ${formatRuTime(windowEnd, timeZone)}`;
  const progressColor = active ? colors.gold : done ? mutedPrayerProgressColor : accent;
  const tintColor = active ? colors.gold : done ? mutedPrayerProgressColor : accent;
  const hebrewLabel = status ?? hebrew;
  const emojiBoxStyle = active
    ? { borderColor: `${accent}55`, backgroundColor: `${accent}26` }
    : {
        borderColor: done ? 'rgba(255,255,255,0.08)' : `${accent}33`,
        backgroundColor: done ? 'rgba(255,255,255,0.04)' : `${accent}12`,
      };

  const card = (
    <GlassCard
      style={[
        styles.prayerCard,
        active && styles.activePrayer,
        done && styles.passedPrayer,
        upcoming && styles.upcomingPrayer,
        done && alreadyRecorded && styles.recordedPassedPrayer,
      ]}
    >
      <View style={[styles.prayerTint, { width: `${Math.round(progressValue * 100)}%`, backgroundColor: `${tintColor}14` }]} />
      <View style={styles.prayerTop}>
        <View style={styles.prayerLeft}>
          <View style={[styles.emojiBox, emojiBoxStyle]}>
            <Text style={[styles.emoji, inactive && styles.inactiveEmoji]}>{icon}</Text>
          </View>
          <View style={styles.flex}>
            <View style={styles.rowGap}>
              <Text style={[styles.overline, inactive && styles.inactiveOverline]}>{overlineLabel} · {title.toUpperCase()}</Text>
              {badgeLabel ? (
                <Text style={[styles.statusBadge, active && !alreadyRecorded && styles.activeStatusBadge, alreadyRecorded && styles.recordedBadge]}>
                  {badgeLabel}
                </Text>
              ) : null}
            </View>
            <View style={styles.prayerTitleRow}>
              <Text style={[styles.prayerTime, inactive && styles.inactivePrayerTime, done && styles.passedPrayerTime]}>{timeLine}</Text>
              {hebrewLabel ? <Text style={[styles.prayerHebrew, inactive && styles.inactivePrayerHebrew]}>{hebrewLabel}</Text> : null}
            </View>
          </View>
        </View>
        <View style={styles.prayerRight}>
          <Text style={[styles.prayerValue, inactive && styles.inactiveValue, done && styles.passedValue]}>{sideValue}</Text>
          <Text style={[styles.tinyMuted, inactive && styles.inactiveTinyMuted]}>{sideLabel}</Text>
        </View>
      </View>
      <ProgressBar value={progressValue} color={progressColor} />
      <View style={styles.progressLegend}>
        <Text style={[styles.tinyMuted, inactive && styles.inactiveTinyMuted]}>{formatRuTime(windowStart, timeZone)} начало</Text>
        <Text style={[styles.tinyMuted, inactive && styles.inactiveTinyMuted]}>{formatRuTime(windowEnd, timeZone)} окончание</Text>
      </View>
    </GlassCard>
  );

  if (!onPress || !recordable) {
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
  prayerLeft: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minWidth: 0,
  },
  emojiBox: {
    width: 28,
    height: 28,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  emoji: {
    fontSize: 14,
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
  prayerHebrew: {
    color: colors.textGhost,
    fontSize: 12,
    fontStyle: 'italic',
  },
  inactivePrayerHebrew: {
    color: colors.textDim,
  },
  prayerRight: {
    alignItems: 'flex-end',
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
  inactiveTinyMuted: {
    color: 'rgba(255,255,255,0.28)',
  },
});
