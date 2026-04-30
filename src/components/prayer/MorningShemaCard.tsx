import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';

import { GlassCard } from '@/components/glass/GlassCard';
import { PrayerActionModal } from '@/components/prayer/PrayerActionModal';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { formatDurationRu, progressBetween } from '@/lib/dates';
import { formatLocalDateKey, hasRecordedMorningShema } from '@/lib/prayerTracker';
import type { DailyZmanim } from '@/lib/zmanim';
import { useAuthStore } from '@/store/useAuthStore';
import { usePrayerTrackerStore } from '@/store/usePrayerTrackerStore';
import { colors } from '@/theme/colors';
import type { HebrewDatePayload } from '@/types/prayerTracker';

type MorningShemaCardProps = {
  city: string;
  daily: DailyZmanim;
  hebrewDate: HebrewDatePayload;
  hebrewDateLabel: string;
  now: Date;
  source?: string;
};

type MorningShemaUrgency = 'calm' | 'warning' | 'danger';

const SHEMA_WARNING_PROGRESS = 0.71;
const SHEMA_DANGER_PROGRESS = 0.91;

function isMorningShemaRecordableNow(daily: DailyZmanim) {
  return Date.now() < daily.times.shemaGra.at.getTime();
}

function getMorningShemaUrgency(progress: number): MorningShemaUrgency {
  if (progress >= SHEMA_DANGER_PROGRESS) {
    return 'danger';
  }

  if (progress >= SHEMA_WARNING_PROGRESS) {
    return 'warning';
  }

  return 'calm';
}

function getUrgencyColor(urgency: MorningShemaUrgency) {
  switch (urgency) {
    case 'danger':
      return colors.danger;
    case 'warning':
      return colors.warning;
    case 'calm':
    default:
      return colors.success;
  }
}

export function MorningShemaCard({
  city,
  daily,
  hebrewDate,
  hebrewDateLabel,
  now,
  source = 'morning_shema_card',
}: MorningShemaCardProps) {
  const [showAction, setShowAction] = useState(false);
  const pulse = useRef(new Animated.Value(0)).current;
  const authUser = useAuthStore((state) => state.user);
  const prayerActivityItems = usePrayerTrackerStore((state) => state.items);
  const isAvailable = now.getTime() < daily.times.shemaGra.at.getTime();
  const activityDate = useMemo(() => formatLocalDateKey(now, daily.timeZone), [daily.timeZone, now]);
  const progress = progressBetween(daily.times.sunrise.at, daily.times.shemaGra.at, now);
  const urgency = getMorningShemaUrgency(progress);
  const urgencyColor = getUrgencyColor(urgency);
  const isBeforeSunrise = now.getTime() < daily.times.sunrise.at.getTime();
  const alreadyRecorded = Boolean(
    authUser
    && hasRecordedMorningShema(
      prayerActivityItems,
      activityDate,
      authUser.id,
    ),
  );
  const value = isBeforeSunrise
    ? `через ${formatDurationRu(daily.times.sunrise.at.getTime() - now.getTime())}`
    : formatDurationRu(daily.times.shemaGra.at.getTime() - now.getTime());
  const subtitle = isBeforeSunrise ? 'до восхода' : `осталось · ${Math.round(progress * 100)}%`;
  const pulseOpacity = pulse.interpolate({
    inputRange: [0, 1],
    outputRange: [0.12, 0.42],
  });
  const pulseScale = pulse.interpolate({
    inputRange: [0, 1],
    outputRange: [0.985, 1.025],
  });

  useEffect(() => {
    if (!isAvailable && showAction) {
      setShowAction(false);
    }
  }, [isAvailable, showAction]);

  useEffect(() => {
    if (urgency !== 'danger' || !isAvailable) {
      pulse.stopAnimation();
      pulse.setValue(0);
      return undefined;
    }

    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          duration: 1500,
          easing: Easing.inOut(Easing.sin),
          toValue: 1,
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          duration: 1500,
          easing: Easing.inOut(Easing.sin),
          toValue: 0,
          useNativeDriver: true,
        }),
      ]),
    );

    animation.start();

    return () => animation.stop();
  }, [isAvailable, pulse, urgency]);

  const handlePress = () => {
    if (!isMorningShemaRecordableNow(daily)) {
      Alert.alert('Сейчас недоступно', 'Время утреннего Шма на сегодня уже прошло.');
      setShowAction(false);
      return;
    }

    setShowAction(true);
  };

  if (!isAvailable) {
    return null;
  }

  return (
    <>
      <View style={styles.shell}>
        {urgency === 'danger' ? (
          <Animated.View
            pointerEvents="none"
            style={[
              styles.redGlow,
              {
                opacity: pulseOpacity,
                transform: [{ scale: pulseScale }],
              },
            ]}
          />
        ) : null}
        <Pressable
          accessibilityRole="button"
          onPress={handlePress}
          style={({ pressed }) => pressed && styles.cardPressed}
        >
          <GlassCard
            style={[
              styles.card,
              urgency === 'calm' && styles.calmCard,
              urgency === 'warning' && styles.warningCard,
              urgency === 'danger' && styles.dangerCard,
            ]}
          >
            <View style={[styles.progressTint, { width: `${Math.round(progress * 100)}%`, backgroundColor: `${urgencyColor}14` }]} />
            <View style={styles.top}>
              <View style={styles.left}>
                <View style={[styles.emojiBox, { borderColor: `${urgencyColor}55`, backgroundColor: `${urgencyColor}26` }]}>
                  <Text style={styles.emoji}>🙏</Text>
                </View>
                <View style={styles.flex}>
                  <View style={styles.titleRow}>
                    <Text style={styles.overline}>УТРЕННЕЕ ШМА ДО</Text>
                    {alreadyRecorded ? <Text style={styles.recordedBadge}>Прочитал</Text> : null}
                  </View>
                  <Text style={styles.deadlineTime}>{daily.times.shemaGra.time}</Text>
                </View>
              </View>
              <View style={styles.right}>
                <Text style={[styles.value, { color: urgencyColor }]}>{value}</Text>
                <Text style={styles.tinyMuted}>{subtitle}</Text>
              </View>
            </View>
            <ProgressBar value={progress} color={urgencyColor} />
            <View style={styles.progressLegend}>
              <Text style={styles.tinyMuted}>{daily.times.sunrise.time} восход</Text>
              <Text style={styles.tinyMuted}>{daily.times.shemaGra.time} дедлайн</Text>
            </View>
          </GlassCard>
        </Pressable>
      </View>

      <PrayerActionModal
        activityType="shema_morning"
        alreadyRecorded={alreadyRecorded}
        alreadyRecordedLabel="Прочитал"
        canRecord={() => {
          const recordable = isMorningShemaRecordableNow(daily);
          if (!recordable) {
            setShowAction(false);
          }
          return recordable;
        }}
        city={city}
        closeOnSuccess={false}
        confirmButtonTitle="Начал читать Шма"
        details={[
          { label: 'Дедлайн', value: daily.times.shemaGra.time },
          { label: 'Окно', value: `${daily.times.sunrise.time} - ${daily.times.shemaGra.time}` },
          { label: 'Город', value: city },
          { label: 'Часовой пояс', value: daily.timeZone },
          { label: 'Еврейская дата', value: hebrewDateLabel },
        ]}
        hebrewDate={hebrewDate}
        metadata={{
          deadline: daily.times.shemaGra.at.toISOString(),
          source,
          sunrise: daily.times.sunrise.at.toISOString(),
          urgency,
          zmanType: 'shemaGra',
        }}
        onClose={() => setShowAction(false)}
        subtitle={`До ${daily.times.shemaGra.time}`}
        timezone={daily.timeZone}
        title="Утреннее Шма"
        unavailableMessage="Время утреннего Шма на сегодня уже прошло."
        unavailableTitle="Сейчас недоступно"
        visible={showAction && isAvailable}
      />
    </>
  );
}

const styles = StyleSheet.create({
  shell: {
    position: 'relative',
  },
  redGlow: {
    position: 'absolute',
    top: -8,
    right: -8,
    bottom: -8,
    left: -8,
    borderRadius: 24,
    backgroundColor: 'rgba(255,85,85,0.35)',
    shadowColor: colors.danger,
    shadowOpacity: 0.65,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 0 },
    elevation: 10,
  },
  card: {
    position: 'relative',
  },
  calmCard: {
    borderColor: 'rgba(76,175,80,0.22)',
  },
  warningCard: {
    borderColor: 'rgba(255,159,10,0.38)',
    backgroundColor: 'rgba(255,159,10,0.055)',
  },
  dangerCard: {
    borderColor: 'rgba(255,85,85,0.45)',
    backgroundColor: 'rgba(255,85,85,0.065)',
  },
  cardPressed: {
    opacity: 0.86,
    transform: [{ scale: 0.99 }],
  },
  progressTint: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
  },
  top: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
    marginBottom: 10,
  },
  left: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minWidth: 0,
  },
  right: {
    alignItems: 'flex-end',
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
  flex: {
    flex: 1,
    minWidth: 0,
  },
  titleRow: {
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
  recordedBadge: {
    overflow: 'hidden',
    borderRadius: 5,
    borderWidth: 1,
    borderColor: 'rgba(76,175,80,0.26)',
    backgroundColor: 'rgba(76,175,80,0.16)',
    color: colors.success,
    fontSize: 9,
    fontWeight: '700',
    paddingHorizontal: 6,
    paddingVertical: 2,
    includeFontPadding: false,
  },
  deadlineTime: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: -0.3,
    marginTop: 2,
  },
  value: {
    fontSize: 20,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  tinyMuted: {
    color: colors.textGhost,
    fontSize: 10,
    fontWeight: '500',
  },
  progressLegend: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 5,
  },
});
