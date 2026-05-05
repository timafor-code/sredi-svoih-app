import { Stack, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { GlassCard } from '@/components/glass/GlassCard';
import { PrimaryButton } from '@/components/ui/PrimaryButton';
import { Screen } from '@/components/ui/Screen';
import { useNow } from '@/hooks/useNow';
import { getHebrewDate, getHebrewDateLabel, getOmerInfo } from '@/lib/hebcal';
import {
  formatLocalDateKey,
  hasRecordedOmerCount,
  OMER_COUNT_ACTIVITY_TYPE,
} from '@/lib/prayerTracker';
import { getDailyZmanim, getHebcalLocation } from '@/lib/zmanim';
import { useAuthStore } from '@/store/useAuthStore';
import { usePrayerTrackerStore } from '@/store/usePrayerTrackerStore';
import { useSettingsStore } from '@/store/useSettingsStore';
import { colors } from '@/theme/colors';

const AUTH_ALERT_TITLE = 'Нужен вход';
const AUTH_ALERT_MESSAGE = 'Чтобы вести молитвенный трекер, войдите в приложение.';

function isPrayerTrackerAuthError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '');
  const lowerMessage = message.toLowerCase();

  return (
    lowerMessage.includes('auth required')
    || lowerMessage.includes('auth session missing')
    || message.includes(AUTH_ALERT_TITLE)
    || message.includes(AUTH_ALERT_MESSAGE)
  );
}

export default function OmerModal() {
  const router = useRouter();
  const now = useNow();
  const [loadingTodayActivity, setLoadingTodayActivity] = useState(false);
  const city = useSettingsStore((state) => state.city);
  const authUser = useAuthStore((state) => state.user);
  const authUserId = authUser?.id ?? null;
  const prayerActivityItems = usePrayerTrackerStore((state) => state.items);
  const loadMyActivity = usePrayerTrackerStore((state) => state.loadMyActivity);
  const recordActivity = usePrayerTrackerStore((state) => state.recordActivity);
  const recording = usePrayerTrackerStore((state) => state.recording);
  const location = useMemo(() => getHebcalLocation(city), [city]);
  const daily = useMemo(() => getDailyZmanim({ city, date: now }), [city, now]);
  const hdate = useMemo(() => getHebrewDate(now, location), [location, now]);
  const hebrewDateLabel = useMemo(() => getHebrewDateLabel(hdate), [hdate]);
  const omer = useMemo(() => getOmerInfo(now, location), [location, now]);
  const activityDate = useMemo(() => formatLocalDateKey(now, daily.timeZone), [daily.timeZone, now]);
  const alreadyRecorded = Boolean(
    authUserId
    && hasRecordedOmerCount(prayerActivityItems, activityDate, authUserId),
  );
  const countButtonDisabled = Boolean(omer) && (recording || loadingTodayActivity || alreadyRecorded);
  const countButtonTitle = recording
    ? 'Записываем...'
    : alreadyRecorded
      ? 'Посчитано'
      : omer
        ? 'Я посчитал сегодня'
        : 'Закрыть';

  useEffect(() => {
    if (!authUserId) {
      setLoadingTodayActivity(false);
      return undefined;
    }

    let isMounted = true;

    setLoadingTodayActivity(true);
    void loadMyActivity({ fromDate: activityDate, toDate: activityDate, limit: 20 })
      .catch(() => undefined)
      .finally(() => {
        if (isMounted) {
          setLoadingTodayActivity(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [activityDate, authUserId, loadMyActivity]);

  const handleCountToday = async () => {
    if (!omer) {
      router.back();
      return;
    }

    if (recording || loadingTodayActivity || alreadyRecorded) {
      return;
    }

    if (!authUser) {
      Alert.alert(AUTH_ALERT_TITLE, AUTH_ALERT_MESSAGE);
      return;
    }

    try {
      await recordActivity({
        activityDate,
        activityType: OMER_COUNT_ACTIVITY_TYPE,
        city,
        hebrewDate: {
          day: hdate.getDate(),
          hebrew: hdate.renderGematriya(),
          label: hebrewDateLabel,
          month: hdate.getMonth(),
          monthName: hdate.getMonthName(),
          omerDay: omer.day,
          sefirahHe: omer.sefirahHe,
          sefirahRu: omer.sefirahRu,
          year: hdate.getFullYear(),
        },
        metadata: {
          countingHe: omer.countingHe,
          countingRu: omer.countingRu,
          dayHe: omer.dayHe,
          meaningRu: omer.meaningRu,
          omerDay: omer.day,
          sefirahHe: omer.sefirahHe,
          sefirahRu: omer.sefirahRu,
          source: 'omer_modal',
        },
        startedAt: new Date(),
        timezone: daily.timeZone,
      });

      Alert.alert('Записано', 'Счёт Омера сохранён.', [
        { text: 'OK' },
      ]);
    } catch (error) {
      if (isPrayerTrackerAuthError(error)) {
        Alert.alert(AUTH_ALERT_TITLE, AUTH_ALERT_MESSAGE);
        return;
      }

      Alert.alert(
        'Не удалось записать',
        'Проверьте подключение и попробуйте ещё раз.',
      );
    }
  };

  return (
    <>
      <Stack.Screen options={{ headerShown: false, presentation: 'modal' }} />
      <Screen contentContainerStyle={{ gap: 16 }}>
        <View style={styles.header}>
          <View>
            <Text style={styles.kicker}>{omer ? `ОМЕР · ДЕНЬ ${omer.day}` : 'ОМЕР'}</Text>
            <Text style={styles.title}>{omer?.sefirahRu ?? 'Сейчас Омер не считают'}</Text>
          </View>
          <Pressable onPress={() => router.back()} style={styles.close}>
            <Text style={styles.closeText}>×</Text>
          </Pressable>
        </View>

        <GlassCard style={styles.hero}>
          <Text style={styles.day}>{omer?.day ?? '-'}</Text>
          <Text style={styles.hebrew}>{omer?.sefirahHe ?? 'בין פסח לשבועות'}</Text>
          <Text style={styles.meaning}>{omer?.meaningRu ?? 'Счёт Омера идёт от второго вечера Песаха до Шавуота.'}</Text>
        </GlassCard>

        <GlassCard>
          <Text style={styles.body}>
            {omer
              ? `Сегодня по Hebcal: ${omer.dayHe}. Сфира дня: ${omer.sefirahRu}.`
              : 'Когда начнётся период Омера, здесь появится реальный день счёта и сфира по Hebcal.'}
          </Text>
        </GlassCard>

        <GlassCard style={styles.countingCard}>
          <Text style={styles.countingHeb}>{omer?.countingHe ?? 'היום לא סופרים את העומר'}</Text>
          <Text style={styles.body}>{omer?.countingRu ?? 'Сегодня Омер не считают.'}</Text>
        </GlassCard>

        {alreadyRecorded ? (
          <View style={styles.recordedBadge}>
            <Text style={styles.recordedBadgeText}>Сегодня уже посчитано</Text>
          </View>
        ) : null}

        <PrimaryButton
          disabled={countButtonDisabled}
          title={countButtonTitle}
          onPress={handleCountToday}
        />
      </Screen>
    </>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 16,
  },
  kicker: {
    color: colors.textDim,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.9,
  },
  title: {
    color: colors.text,
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: -0.5,
    marginTop: 4,
  },
  close: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.glass.w10,
  },
  closeText: {
    color: colors.text,
    fontSize: 28,
    lineHeight: 30,
  },
  hero: {
    alignItems: 'center',
    borderColor: colors.accent.goldBorder,
    backgroundColor: colors.accent.goldBg,
  },
  day: {
    color: colors.gold,
    fontSize: 64,
    fontWeight: '800',
    lineHeight: 70,
  },
  hebrew: {
    color: colors.text,
    fontSize: 22,
    fontWeight: '700',
    marginTop: 4,
  },
  meaning: {
    color: colors.accent.goldText,
    fontSize: 16,
    fontWeight: '700',
    marginTop: 8,
  },
  body: {
    color: colors.textMuted,
    fontSize: 15,
    lineHeight: 23,
  },
  countingCard: {
    borderColor: 'rgba(255,255,255,0.12)',
  },
  countingHeb: {
    color: colors.text,
    fontSize: 20,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 10,
  },
  recordedBadge: {
    alignSelf: 'flex-start',
    overflow: 'hidden',
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'rgba(76,175,80,0.26)',
    backgroundColor: 'rgba(76,175,80,0.14)',
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  recordedBadgeText: {
    color: colors.success,
    fontSize: 12,
    fontWeight: '800',
  },
});
