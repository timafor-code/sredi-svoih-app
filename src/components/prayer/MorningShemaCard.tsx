import { useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';

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

function isMorningShemaRecordableNow(daily: DailyZmanim) {
  return Date.now() < daily.times.shemaGra.at.getTime();
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
  const authUser = useAuthStore((state) => state.user);
  const prayerActivityItems = usePrayerTrackerStore((state) => state.items);
  const isAvailable = now.getTime() < daily.times.shemaGra.at.getTime();
  const activityDate = useMemo(() => formatLocalDateKey(now, daily.timeZone), [daily.timeZone, now]);
  const progress = progressBetween(daily.times.sunrise.at, daily.times.shemaGra.at, now);
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

  useEffect(() => {
    if (!isAvailable && showAction) {
      setShowAction(false);
    }
  }, [isAvailable, showAction]);

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
      <Pressable
        accessibilityRole="button"
        onPress={handlePress}
        style={({ pressed }) => pressed && styles.cardPressed}
      >
        <GlassCard style={styles.card}>
          <View style={[styles.progressTint, { width: `${Math.round(progress * 100)}%` }]} />
          <View style={styles.top}>
            <View style={styles.left}>
              <View style={styles.emojiBox}>
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
              <Text style={styles.value}>{value}</Text>
              <Text style={styles.tinyMuted}>{subtitle}</Text>
            </View>
          </View>
          <ProgressBar value={progress} color={colors.success} />
          <View style={styles.progressLegend}>
            <Text style={styles.tinyMuted}>{daily.times.sunrise.time} восход</Text>
            <Text style={styles.tinyMuted}>{daily.times.shemaGra.time} дедлайн</Text>
          </View>
        </GlassCard>
      </Pressable>

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
  card: {
    position: 'relative',
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
    backgroundColor: 'rgba(76,175,80,0.08)',
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
    borderColor: 'rgba(76,175,80,0.30)',
    backgroundColor: 'rgba(76,175,80,0.15)',
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
    color: colors.success,
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
