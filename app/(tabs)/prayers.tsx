import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { BlessingsEntryCard } from '@/components/blessings/BlessingsEntryCard';
import { GlassCard } from '@/components/glass/GlassCard';
import { MorningShemaCard } from '@/components/prayer/MorningShemaCard';
import { PrayerActionModal } from '@/components/prayer/PrayerActionModal';
import { PrayerDayScale } from '@/components/prayer/PrayerDayScale';
import { PrayerWindowCard } from '@/components/prayer/PrayerWindowCard';
import { HeaderButton, Logo } from '@/components/ui/BrandHeader';
import { Screen } from '@/components/ui/Screen';
import { SectionTitle } from '@/components/ui/SectionTitle';
import { useNow } from '@/hooks/useNow';
import { addDays, formatRuDate, formatRuTime } from '@/lib/dates';
import { getHebrewDate, getHebrewDateLabel } from '@/lib/hebcal';
import { formatLocalDateKey, hasRecordedActivity, prayerActivityTypeFromPrayerId } from '@/lib/prayerTracker';
import { getDailyZmanim, getHebcalLocation, getPrayerWindows } from '@/lib/zmanim';
import type { PrayerWindow } from '@/lib/zmanim';
import { useAuthStore } from '@/store/useAuthStore';
import { usePrayerTrackerStore } from '@/store/usePrayerTrackerStore';
import { useSettingsStore } from '@/store/useSettingsStore';
import { colors } from '@/theme/colors';

function isPrayerRecordableNow(prayer: PrayerWindow) {
  const nowMs = Date.now();
  return nowMs >= prayer.start.getTime() && nowMs <= prayer.end.getTime();
}

export default function PrayersScreen() {
  const now = useNow();
  const [selectedPrayerId, setSelectedPrayerId] = useState<PrayerWindow['id'] | null>(null);
  const requestedPrayerActivityForUserRef = useRef<string | null>(null);
  const authUser = useAuthStore((state) => state.user);
  const prayerActivityItems = usePrayerTrackerStore((state) => state.items);
  const prayerActivityLoading = usePrayerTrackerStore((state) => state.loading);
  const loadMyActivity = usePrayerTrackerStore((state) => state.loadMyActivity);
  const city = useSettingsStore((state) => state.city);
  const location = useMemo(() => getHebcalLocation(city), [city]);
  const daily = useMemo(() => getDailyZmanim({ city, date: now }), [city, now]);
  const tomorrowDate = useMemo(() => addDays(now, 1), [now]);
  const tomorrowDaily = useMemo(
    () => getDailyZmanim({ city, date: tomorrowDate }),
    [city, tomorrowDate],
  );
  const hdate = useMemo(() => getHebrewDate(now, location), [location, now]);
  const hebrewDateLabel = useMemo(() => getHebrewDateLabel(hdate), [hdate]);
  const hebrewDatePayload = useMemo(
    () => ({
      day: hdate.getDate(),
      hebrew: hdate.renderGematriya(),
      label: hebrewDateLabel,
      month: hdate.getMonth(),
      monthName: hdate.getMonthName(),
      year: hdate.getFullYear(),
    }),
    [hdate, hebrewDateLabel],
  );
  const prayers = useMemo(() => getPrayerWindows(daily, now), [daily, now]);
  const selectedPrayer = useMemo(
    () => prayers.find((prayer) => prayer.id === selectedPrayerId) ?? null,
    [prayers, selectedPrayerId],
  );
  const activityDate = useMemo(() => formatLocalDateKey(now, daily.timeZone), [daily.timeZone, now]);
  const selectedPrayerAlreadyRecorded = Boolean(
    authUser
    && selectedPrayer
    && hasRecordedActivity(
      prayerActivityItems,
      prayerActivityTypeFromPrayerId(selectedPrayer.id),
      activityDate,
      authUser.id,
    ),
  );
  const nextZmanId = daily.items.find((item) => now.getTime() < item.at.getTime())?.id;
  const overview = useMemo(() => {
    const timelineStartMs = daily.times.sunrise.at.getTime();
    const timelineEndMs = tomorrowDaily.times.sunrise.at.getTime();
    const timelineDurationMs = Math.max(1, timelineEndMs - timelineStartMs);
    const raw = [
      { id: 'sunrise', l: 'Восход', t: daily.times.sunrise.time, at: daily.times.sunrise.at },
      { id: 'chatzot', l: 'Полдень', t: daily.times.chatzot.time, at: daily.times.chatzot.at },
      { id: 'sunset', l: 'Закат', t: daily.times.sunset.time, at: daily.times.sunset.at },
      { id: 'tzeit', l: 'Ночь', t: daily.times.tzeit.time, at: daily.times.tzeit.at },
    ];
    return raw.map((item) => {
      const rawPercent = ((item.at.getTime() - timelineStartMs) / timelineDurationMs) * 100;
      return { ...item, percent: Math.max(0, Math.min(100, rawPercent)) };
    });
  }, [daily.times, tomorrowDaily.times]);

  useEffect(() => {
    if (!authUser) {
      requestedPrayerActivityForUserRef.current = null;
      return;
    }

    if (prayerActivityItems.some((item) => item.userId === authUser.id)) {
      requestedPrayerActivityForUserRef.current = authUser.id;
      return;
    }

    if (requestedPrayerActivityForUserRef.current === authUser.id || prayerActivityLoading) {
      return;
    }

    requestedPrayerActivityForUserRef.current = authUser.id;
    void loadMyActivity({ limit: 100 }).catch(() => undefined);
  }, [authUser, loadMyActivity, prayerActivityItems, prayerActivityLoading]);

  useEffect(() => {
    if (selectedPrayer && !selectedPrayer.active) {
      setSelectedPrayerId(null);
    }
  }, [selectedPrayer]);

  const handlePrayerPress = (prayer: PrayerWindow) => {
    if (!isPrayerRecordableNow(prayer)) {
      Alert.alert('Сейчас недоступно', 'Эту молитву можно отметить только в её текущее время.');
      return;
    }

    setSelectedPrayerId(prayer.id);
  };

  return (
    <Screen>
      <View style={styles.header}>
        <Logo />
        <View style={styles.cityPill}>
          <Ionicons name="location" size={13} color="rgba(255,255,255,0.62)" />
          <Text style={styles.cityText}>По выбранному городу{'\n'}не по GPS</Text>
        </View>
      </View>

      <View>
        <Text style={styles.title}>Молитвы и зманим</Text>
        <Text style={styles.subtitle}>
          {hebrewDateLabel} · {formatRuDate(now, daily.timeZone)} · {city} ▾
        </Text>
      </View>

      <View style={styles.filterRow}>
        <HeaderButton icon="filter" />
      </View>

      <GlassCard>
        <Text style={[styles.overline, styles.scaleOverline]}>ШКАЛА ДНЯ</Text>
        <PrayerDayScale today={daily} tomorrow={tomorrowDaily} now={now} />
        <View style={styles.zmanOverview}>
          {overview.map((item) => {
            const isLeftEdge = item.percent <= 5;
            const isRightEdge = item.percent >= 95;
            const horizontalStyle = isLeftEdge
              ? { left: 0 as const, alignItems: 'flex-start' as const }
              : isRightEdge
                ? { right: 0 as const, alignItems: 'flex-end' as const }
                : { left: `${item.percent}%` as const, marginLeft: -28, alignItems: 'center' as const };
            return (
              <View key={item.id} style={[styles.zmanPoint, horizontalStyle]}>
                <Text style={styles.zmanTime}>{item.t}</Text>
                <Text style={styles.zmanLabel}>{item.l}</Text>
              </View>
            );
          })}
        </View>
      </GlassCard>

      <MorningShemaCard
        city={city}
        daily={daily}
        hebrewDate={hebrewDatePayload}
        hebrewDateLabel={hebrewDateLabel}
        now={now}
        source="prayers_screen_shema_card"
      />

      {prayers.map((prayer) => {
        const recordable = prayer.active;
        const alreadyRecorded = Boolean(
          authUser
          && hasRecordedActivity(
            prayerActivityItems,
            prayerActivityTypeFromPrayerId(prayer.id),
            activityDate,
            authUser.id,
          ),
        );

        return (
          <PrayerWindowCard
            key={prayer.id}
            accent={prayer.accent}
            active={prayer.active}
            alreadyRecorded={alreadyRecorded}
            icon={prayer.icon}
            prayerId={prayer.id}
            progress={prayer.progress}
            recordable={recordable}
            state={now.getTime() > prayer.end.getTime() ? 'done' : 'upcoming'}
            status={prayer.hebrew}
            onPress={recordable ? () => handlePrayerPress(prayer) : undefined}
            timeZone={daily.timeZone}
            title={prayer.title}
            windowEnd={prayer.end}
            windowStart={prayer.start}
          />
        );
      })}

      <BlessingsEntryCard />

      <View>
        <SectionTitle title="ЗМАНИМ · ТАБЛИЦА" action="Подробнее о зманим" />
        <GlassCard padded={false}>
          {daily.items.map((zman, index) => {
            const highlight = zman.id === nextZmanId;
            return (
              <View key={zman.id} style={[styles.zmanRow, index > 0 && styles.rowDivider, highlight && styles.zmanRowHighlight]}>
                <Text style={styles.zmanRowIcon}>{zman.icon}</Text>
                <Text style={[styles.zmanRowName, highlight && styles.zmanRowAccent]}>{zman.name}</Text>
                <Text style={[styles.zmanRowTime, highlight && styles.zmanRowAccent]}>{zman.time}</Text>
              </View>
            );
          })}
        </GlassCard>
      </View>

      <Pressable style={styles.infoCard}>
        <LinearGradient colors={['rgba(74,144,217,0.10)', 'rgba(74,144,217,0.04)']} style={StyleSheet.absoluteFillObject} />
        <Ionicons name="information-circle-outline" size={18} color="#4A90D9" />
        <Text style={styles.infoText}>Зманим рассчитаны через Hebcal для города {city}, часовой пояс {daily.timeZone}.</Text>
      </Pressable>

      {selectedPrayer?.active ? (
        <PrayerActionModal
          activityType={prayerActivityTypeFromPrayerId(selectedPrayer.id)}
          alreadyRecorded={selectedPrayerAlreadyRecorded}
          canRecord={() => {
            const recordable = isPrayerRecordableNow(selectedPrayer);
            if (!recordable) {
              setSelectedPrayerId(null);
            }
            return recordable;
          }}
          city={city}
          closeOnSuccess={false}
          confirmButtonTitle="Начал молиться"
          details={[
            {
              label: 'Окно',
              value: `${formatRuTime(selectedPrayer.start, daily.timeZone)} - ${formatRuTime(selectedPrayer.end, daily.timeZone)}`,
            },
            { label: 'Город', value: city },
            { label: 'Часовой пояс', value: daily.timeZone },
            { label: 'Еврейская дата', value: hebrewDateLabel },
          ]}
          hebrewDate={hebrewDatePayload}
          metadata={{
            active: selectedPrayer.active,
            prayerTitle: selectedPrayer.title,
            source: 'prayers_screen',
            windowEnd: selectedPrayer.end.toISOString(),
            windowStart: selectedPrayer.start.toISOString(),
          }}
          onClose={() => setSelectedPrayerId(null)}
          subtitle={selectedPrayer.hebrew}
          timezone={daily.timeZone}
          title={selectedPrayer.title}
          unavailableMessage="Эту молитву можно отметить только в её текущее время."
          unavailableTitle="Сейчас недоступно"
          visible
        />
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  cityPill: {
    minHeight: 42,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.glass.w10,
    backgroundColor: colors.glass.w07,
    paddingHorizontal: 12,
  },
  cityText: {
    color: colors.textMuted,
    fontSize: 11,
    lineHeight: 14,
    textAlign: 'center',
  },
  title: {
    color: colors.text,
    fontSize: 24,
    fontWeight: '700',
    letterSpacing: -0.5,
  },
  subtitle: {
    color: colors.textDim,
    fontSize: 13,
    marginTop: 3,
  },
  filterRow: {
    alignItems: 'flex-end',
  },
  overline: {
    color: colors.textDim,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.8,
    includeFontPadding: false,
  },
  scaleOverline: {
    marginBottom: 6,
  },
  zmanOverview: {
    position: 'relative',
    height: 28,
    marginTop: 2,
  },
  zmanPoint: {
    position: 'absolute',
    top: 0,
    width: 56,
  },
  zmanTime: {
    color: colors.textSecondary,
    fontSize: 10,
    fontWeight: '700',
    marginTop: 2,
  },
  zmanLabel: {
    color: colors.textGhost,
    fontSize: 9,
  },
  zmanRow: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  rowDivider: {
    borderTopWidth: 1,
    borderTopColor: colors.separator,
  },
  zmanRowHighlight: {
    backgroundColor: 'rgba(240,120,42,0.05)',
  },
  zmanRowIcon: {
    width: 20,
    textAlign: 'center',
    fontSize: 15,
  },
  zmanRowName: {
    flex: 1,
    color: colors.textSecondary,
    fontSize: 13,
  },
  zmanRowTime: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '700',
  },
  zmanRowAccent: {
    color: colors.orange,
  },
  infoCard: {
    minHeight: 48,
    overflow: 'hidden',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(74,144,217,0.20)',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
  },
  infoText: {
    flex: 1,
    color: colors.textDim,
    fontSize: 12,
  },
});
