import { Stack, useRouter } from 'expo-router';
import { useEffect, useMemo } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { GlassCard } from '@/components/glass/GlassCard';
import { PrimaryButton } from '@/components/ui/PrimaryButton';
import { Screen } from '@/components/ui/Screen';
import { useNow } from '@/hooks/useNow';
import { getHebrewDate, getHebrewDateLabel, getOmerInfo } from '@/lib/hebcal';
import { formatLocalDateKey, hasRecordedOmerCount, OMER_COUNT_ACTIVITY_TYPE } from '@/lib/prayerTracker';
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
  const city = useSettingsStore((state) => state.city);
  const authUser = useAuthStore((state) => state.user);
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
    authUser
    && hasRecordedOmerCount(prayerActivityItems, activityDate, authUser.id),
  );
  const buttonTitle = omer
    ? alreadyRecorded
      ? 'Посчитано'
      : recording
        ? 'Записываем...'
        : 'Я посчитал сегодня'
    : 'Закрыть';
  const buttonDisabled = Boolean(omer && (alreadyRecorded || recording));

  useEffect(() => {
    if (!authUser) {
      return;
    }

    void loadMyActivity({
      fromDate: activityDate,
      limit: 20,
      toDate: activityDate,
    }).catch(() => undefined);
  }, [activityDate, authUser, loadMyActivity]);

  const handleCountToday = async () => {
    if (!omer) {
      router.back();
      return;
    }

    if (!authUser) {
      Alert.alert(AUTH_ALERT_TITLE, AUTH_ALERT_MESSAGE);
      return;
    }

    if (recording || alreadyRecorded) {
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
          sefirahEn: omer.sefirahEn,
          sefirahHe: omer.sefirahHe,
          sefirahRu: omer.sefirahRu,
          source: 'omer_modal',
        },
        startedAt: new Date(),
        timezone: daily.timeZone,
      });

      Alert.alert('Записано', 'Счёт Омера сохранён.');
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
          {alreadyRecorded ? <Text style={styles.recordedBadge}>Сегодня уже посчитано</Text> : null}
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

        <PrimaryButton
          disabled={buttonDisabled}
          title={buttonTitle}
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
  recordedBadge: {
    overflow: 'hidden',
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'rgba(76,175,80,0.26)',
    backgroundColor: 'rgba(76,175,80,0.14)',
    color: colors.success,
    fontSize: 12,
    fontWeight: '800',
    marginTop: 12,
    paddingHorizontal: 10,
    paddingVertical: 5,
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
});
