import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { BlessingsEntryCard } from '@/components/blessings/BlessingsEntryCard';
import { GlassCard } from '@/components/glass/GlassCard';
import { CityPickerModal } from '@/components/prayer/CityPickerModal';
import { MorningShemaCard } from '@/components/prayer/MorningShemaCard';
import { OmerCountCard } from '@/components/prayer/OmerCountCard';
import { PrayerActionModal } from '@/components/prayer/PrayerActionModal';
import { PrayerDayScale } from '@/components/prayer/PrayerDayScale';
import { PrayerDayScaleBackground } from '@/components/prayer/PrayerDayScaleBackground';
import { PrayerWindowCard } from '@/components/prayer/PrayerWindowCard';
import { ZmanimModal } from '@/components/prayer/ZmanimModal';
import { Logo } from '@/components/ui/BrandHeader';
import { Screen } from '@/components/ui/Screen';
import { useAutoDetectZmanimCity } from '@/hooks/useAutoDetectZmanimCity';
import { useNow } from '@/hooks/useNow';
import { addDays, formatRuDate, formatRuTime } from '@/lib/dates';
import { getHebrewDate, getHebrewDateLabel } from '@/lib/hebcal';
import { resolvePrayerDayPeriod } from '@/lib/prayerDayPeriod';
import { formatLocalDateKey, hasRecordedActivity, prayerActivityTypeFromPrayerId } from '@/lib/prayerTracker';
import { getDailyZmanim, getHebcalLocation, getPrayerWindows } from '@/lib/zmanim';
import type { PrayerWindow, ZmanimLocationInput } from '@/lib/zmanim';
import { useAuthStore } from '@/store/useAuthStore';
import { usePrayerTrackerStore } from '@/store/usePrayerTrackerStore';
import { useSettingsStore } from '@/store/useSettingsStore';
import { colors } from '@/theme/colors';

const OVERVIEW_PIN_WIDTH = 56;
const OVERVIEW_SUNSET_TZEIT_MIN_GAP = 8;

function isPrayerRecordableNow(prayer: PrayerWindow) {
  const nowMs = Date.now();
  return nowMs >= prayer.start.getTime() && nowMs <= prayer.end.getTime();
}

function clampProgress(value: number) {
  return Math.max(0, Math.min(1, value));
}

function getUpcomingPrayerPreviewProgress(
  prayers: PrayerWindow[],
  prayerIndex: number,
  now: Date,
) {
  const prayer = prayers[prayerIndex];
  if (!prayer) return 0;

  const startMs = prayer.start.getTime();
  const gapStartMs = prayerIndex > 0
    ? prayers[prayerIndex - 1]!.end.getTime()
    : new Date(now).setHours(0, 0, 0, 0);
  const gapDurationMs = startMs - gapStartMs;

  if (gapDurationMs <= 0) return 0;

  return clampProgress((now.getTime() - gapStartMs) / gapDurationMs);
}

export default function PrayersScreen() {
  const router = useRouter();
  const now = useNow();
  const [selectedPrayerId, setSelectedPrayerId] = useState<PrayerWindow['id'] | null>(null);
  const [cityPickerVisible, setCityPickerVisible] = useState(false);
  const [zmanimModalVisible, setZmanimModalVisible] = useState(false);
  const requestedPrayerActivityForUserRef = useRef<string | null>(null);
  useAutoDetectZmanimCity();
  const authUser = useAuthStore((state) => state.user);
  const prayerActivityItems = usePrayerTrackerStore((state) => state.items);
  const prayerActivityLoading = usePrayerTrackerStore((state) => state.loading);
  const loadMyActivity = usePrayerTrackerStore((state) => state.loadMyActivity);
  const city = useSettingsStore((state) => state.city);
  const customGpsLocation = useSettingsStore((state) => state.customGpsLocation);
  const zmanimSource = useSettingsStore((state) => state.zmanimSource);
  const activeZmanimLocation = useMemo<ZmanimLocationInput>(
    () => (zmanimSource === 'gps' && customGpsLocation ? customGpsLocation : city),
    [city, customGpsLocation, zmanimSource],
  );
  const activeCity = typeof activeZmanimLocation === 'string'
    ? activeZmanimLocation
    : activeZmanimLocation.city;
  const location = useMemo(() => getHebcalLocation(activeZmanimLocation), [activeZmanimLocation]);
  const daily = useMemo(
    () => getDailyZmanim({ date: now, location: activeZmanimLocation }),
    [activeZmanimLocation, now],
  );
  const tomorrowDate = useMemo(() => addDays(now, 1), [now]);
  const tomorrowDaily = useMemo(
    () => getDailyZmanim({ date: tomorrowDate, location: activeZmanimLocation }),
    [activeZmanimLocation, tomorrowDate],
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
  const dayPeriod = useMemo(() => resolvePrayerDayPeriod(daily, now), [daily, now]);
  const selectedPrayer = useMemo(
    () => prayers.find((prayer) => prayer.id === selectedPrayerId) ?? null,
    [prayers, selectedPrayerId],
  );
  const activityDate = useMemo(() => formatLocalDateKey(now, daily.timeZone), [daily.timeZone, now]);
  const upcomingPrayerPreview = useMemo(() => {
    const hasActivePrayer = prayers.some((prayer) => prayer.active);
    if (hasActivePrayer) return null;

    const nowMs = now.getTime();
    const nextPrayerIndex = prayers.findIndex((prayer) => nowMs < prayer.start.getTime());
    if (nextPrayerIndex < 0) return null;

    const nextPrayer = prayers[nextPrayerIndex]!;
    return {
      id: nextPrayer.id,
      progress: getUpcomingPrayerPreviewProgress(prayers, nextPrayerIndex, now),
    };
  }, [now, prayers]);
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

  const [overviewWidth, setOverviewWidth] = useState(0);
  const overviewPositioned = useMemo(() => {
    if (overviewWidth <= 0) return null;
    const find = (id: string) => overview.find((p) => p.id === id);
    const sunrise = find('sunrise');
    const chatzot = find('chatzot');
    const sunset = find('sunset');
    const tzeit = find('tzeit');
    if (!sunrise || !chatzot || !sunset || !tzeit) return null;

    const maxLeft = Math.max(0, overviewWidth - OVERVIEW_PIN_WIDTH);

    let sunsetRightX = (sunset.percent / 100) * overviewWidth;
    let tzeitLeftX = (tzeit.percent / 100) * overviewWidth;
    const naturalGap = tzeitLeftX - sunsetRightX;
    if (naturalGap < OVERVIEW_SUNSET_TZEIT_MIN_GAP) {
      const deficit = OVERVIEW_SUNSET_TZEIT_MIN_GAP - naturalGap;
      sunsetRightX -= deficit / 2;
      tzeitLeftX += deficit / 2;
    }

    const sunsetLeft = Math.max(0, Math.min(maxLeft, sunsetRightX - OVERVIEW_PIN_WIDTH));
    const tzeitLeft = Math.max(0, Math.min(maxLeft, tzeitLeftX));

    const chatzotCenter = (chatzot.percent / 100) * overviewWidth;
    const chatzotLeft = Math.max(0, Math.min(maxLeft, chatzotCenter - OVERVIEW_PIN_WIDTH / 2));

    return [
      { id: sunrise.id, l: sunrise.l, t: sunrise.t, leftPx: 0, align: 'left' as const },
      {
        id: chatzot.id,
        l: chatzot.l,
        t: chatzot.t,
        leftPx: chatzotLeft,
        align: 'center' as const,
      },
      {
        id: sunset.id,
        l: sunset.l,
        t: sunset.t,
        leftPx: sunsetLeft,
        align: 'right' as const,
      },
      {
        id: tzeit.id,
        l: tzeit.l,
        t: tzeit.t,
        leftPx: tzeitLeft,
        align: 'left' as const,
      },
    ];
  }, [overview, overviewWidth]);

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
      </View>

      <View>
        <Text style={styles.title}>Молитвы и зманим</Text>
        <View style={styles.subtitleRow}>
          <Text style={styles.subtitleDate}>
            {hebrewDateLabel} · {formatRuDate(now, daily.timeZone)}
          </Text>
          <Pressable
            accessibilityHint="Открыть выбор города для зманим"
            accessibilityLabel={`Город для зманим: ${activeCity}`}
            accessibilityRole="button"
            onPress={() => setCityPickerVisible(true)}
            style={({ pressed }) => [styles.cityChip, pressed && styles.cityChipPressed]}
          >
            <Ionicons name="location" size={12} color="rgba(255,255,255,0.72)" />
            <Text numberOfLines={1} style={styles.cityChipText}>{activeCity}</Text>
            <Ionicons name="chevron-down" size={12} color="rgba(255,255,255,0.46)" />
          </Pressable>
        </View>
      </View>

      <OmerCountCard
        city={activeCity}
        now={now}
        onPress={() => router.push('/modals/omer')}
      />

      <Pressable
        accessibilityHint="Открыть полный список зманим"
        accessibilityLabel="Шкала дня. Нажмите, чтобы открыть все зманим."
        accessibilityRole="button"
        onPress={() => setZmanimModalVisible(true)}
        style={({ pressed }) => pressed && styles.scalePressed}
      >
        <GlassCard>
          <View pointerEvents="none" style={styles.scaleBackgroundLayer}>
            <PrayerDayScaleBackground period={dayPeriod} />
          </View>
          <View style={styles.scaleContentLayer}>
            <Text style={[styles.overline, styles.scaleOverline]}>ШКАЛА ДНЯ</Text>
            <PrayerDayScale today={daily} tomorrow={tomorrowDaily} now={now} />
            <View
              style={styles.zmanOverview}
              onLayout={(e) => setOverviewWidth(e.nativeEvent.layout.width)}
            >
              {overviewPositioned?.map((item) => (
                <View key={item.id} style={[styles.zmanPoint, { left: item.leftPx }]}>
                  <Text style={[styles.zmanTime, { textAlign: item.align }]}>{item.t}</Text>
                  <Text style={[styles.zmanLabel, { textAlign: item.align }]}>{item.l}</Text>
                </View>
              ))}
            </View>
            <View style={styles.scaleFooter}>
              <Text style={styles.scaleCta}>Все зманим</Text>
              <Ionicons name="chevron-forward" size={14} color="rgba(255,200,50,0.85)" />
            </View>
          </View>
        </GlassCard>
      </Pressable>

      <MorningShemaCard
        city={activeCity}
        daily={daily}
        hebrewDate={hebrewDatePayload}
        hebrewDateLabel={hebrewDateLabel}
        now={now}
        source="prayers_screen_shema_card"
      />

      {prayers.map((prayer) => {
        const recordable = prayer.active;
        const upcomingPreview = Boolean(
          upcomingPrayerPreview
          && prayer.id === upcomingPrayerPreview.id
          && !prayer.active,
        );
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
            upcomingPreview={upcomingPreview}
            upcomingPreviewProgress={upcomingPreview ? upcomingPrayerPreview?.progress ?? 0 : 0}
            windowEnd={prayer.end}
            windowStart={prayer.start}
          />
        );
      })}

      <BlessingsEntryCard />

      <Pressable style={styles.infoCard}>
        <LinearGradient colors={['rgba(74,144,217,0.10)', 'rgba(74,144,217,0.04)']} style={StyleSheet.absoluteFillObject} />
        <Ionicons name="information-circle-outline" size={18} color="#4A90D9" />
        <Text style={styles.infoText}>Зманим рассчитаны через Hebcal для города {activeCity}, часовой пояс {daily.timeZone}.</Text>
      </Pressable>

      <ZmanimModal
        city={activeCity}
        daily={daily}
        date={now}
        nextZmanId={nextZmanId}
        onClose={() => setZmanimModalVisible(false)}
        visible={zmanimModalVisible}
      />

      <CityPickerModal
        onClose={() => setCityPickerVisible(false)}
        visible={cityPickerVisible}
      />

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
          city={activeCity}
          closeOnSuccess={false}
          confirmButtonTitle="Начал молиться"
          details={[
            {
              label: 'Окно',
              value: `${formatRuTime(selectedPrayer.start, daily.timeZone)} - ${formatRuTime(selectedPrayer.end, daily.timeZone)}`,
            },
            { label: 'Город', value: activeCity },
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
  subtitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 7,
    marginTop: 4,
  },
  subtitleDate: {
    color: colors.textDim,
    fontSize: 13,
  },
  cityChip: {
    minHeight: 28,
    maxWidth: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.glass.w10,
    backgroundColor: colors.glass.w07,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  cityChipPressed: {
    opacity: 0.78,
  },
  cityChipText: {
    flexShrink: 1,
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: '800',
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
  scaleCta: {
    color: 'rgba(255,200,50,0.85)',
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  scalePressed: {
    opacity: 0.92,
  },
  scaleBackgroundLayer: {
    position: 'absolute',
    top: -16,
    left: -16,
    right: -16,
    bottom: -16,
  },
  scaleContentLayer: {
    position: 'relative',
  },
  scaleFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
    gap: 4,
    marginTop: 6,
  },
  zmanOverview: {
    position: 'relative',
    height: 28,
    marginTop: 2,
  },
  zmanPoint: {
    position: 'absolute',
    top: 0,
    width: OVERVIEW_PIN_WIDTH,
  },
  zmanTime: {
    alignSelf: 'stretch',
    color: colors.textSecondary,
    fontSize: 10,
    fontWeight: '700',
    marginTop: 2,
  },
  zmanLabel: {
    alignSelf: 'stretch',
    color: colors.textGhost,
    fontSize: 9,
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
