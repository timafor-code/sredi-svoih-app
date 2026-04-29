import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { GlassCard } from '@/components/glass/GlassCard';
import { PrayerActionModal } from '@/components/prayer/PrayerActionModal';
import { PrayerWindowCard } from '@/components/prayer/PrayerWindowCard';
import { Avatar } from '@/components/ui/Avatar';
import { Logo, OmerPill } from '@/components/ui/BrandHeader';
import { PrimaryButton } from '@/components/ui/PrimaryButton';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { Screen } from '@/components/ui/Screen';
import { SectionTitle } from '@/components/ui/SectionTitle';
import { mockContacts } from '@/data/mockContacts';
import { useNow } from '@/hooks/useNow';
import { getUpcomingContactBirthdays } from '@/lib/birthdays';
import { formatDurationRu, formatRuDate, formatRuTime, formatRuWeekdayDayMonth, progressBetween } from '@/lib/dates';
import { getHebrewDate, getHebrewDateLabel, getUpcomingHoliday, getWeeklyParsha } from '@/lib/hebcal';
import type { UpcomingHoliday, WeeklyParsha } from '@/lib/hebcal';
import { formatLocalDateKey, hasRecordedActivity, prayerActivityTypeFromPrayerId } from '@/lib/prayerTracker';
import {
  getDailyZmanim,
  getHebcalLocation,
  getPrayerWindows,
  getUpcomingCandleLighting,
} from '@/lib/zmanim';
import type { CandleLightingInfo, DailyZmanim, PrayerWindow } from '@/lib/zmanim';
import { useAuthStore } from '@/store/useAuthStore';
import { usePrayerTrackerStore } from '@/store/usePrayerTrackerStore';
import { useSettingsStore } from '@/store/useSettingsStore';
import { colors } from '@/theme/colors';

type HomeBirthdayItem = {
  active: boolean;
  bg: string;
  hebrew: string;
  id: string;
  initials: string;
  name: string;
  when: string;
};

function pluralDays(count: number) {
  const lastTwo = count % 100;
  const last = count % 10;
  if (lastTwo >= 11 && lastTwo <= 14) return 'дней';
  if (last === 1) return 'день';
  if (last >= 2 && last <= 4) return 'дня';
  return 'дней';
}

function DeadlineCard({ daily, now, onPress }: { daily: DailyZmanim; now: Date; onPress?: () => void }) {
  const progress = progressBetween(daily.times.sunrise.at, daily.times.shemaGra.at, now);
  const isBefore = now.getTime() < daily.times.sunrise.at.getTime();
  const isDone = now.getTime() > daily.times.shemaGra.at.getTime();
  const value = isDone
    ? 'завершено'
    : isBefore
      ? `через ${formatDurationRu(daily.times.sunrise.at.getTime() - now.getTime())}`
      : formatDurationRu(daily.times.shemaGra.at.getTime() - now.getTime());
  const subtitle = isDone ? 'на сегодня' : isBefore ? 'до восхода' : `осталось · ${Math.round(progress * 100)}%`;

  const card = (
    <GlassCard style={styles.deadlineCard}>
      <View style={[styles.progressTint, { width: `${Math.round(progress * 100)}%` }]} />
      <View style={styles.deadlineTop}>
        <View style={styles.deadlineLeft}>
          <View style={[styles.emojiBox, styles.greenBox]}>
            <Text style={styles.emoji}>🙏</Text>
          </View>
          <View>
            <Text style={styles.overline}>УТРЕННЕЕ ШМА ДО</Text>
            <Text style={styles.deadlineTime}>{daily.times.shemaGra.time}</Text>
          </View>
        </View>
        <View style={styles.deadlineRight}>
          <Text style={styles.greenValue}>{value}</Text>
          <Text style={styles.tinyMuted}>{subtitle}</Text>
        </View>
      </View>
      <ProgressBar value={progress} color={colors.success} />
      <View style={styles.progressLegend}>
        <Text style={styles.tinyMuted}>{daily.times.sunrise.time} восход</Text>
        <Text style={styles.tinyMuted}>{daily.times.shemaGra.time} дедлайн</Text>
      </View>
    </GlassCard>
  );

  if (!onPress) {
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

function isShemaRecordableNow(daily: DailyZmanim) {
  return Date.now() <= daily.times.shemaGra.at.getTime();
}

function isPrayerRecordableNow(prayer: PrayerWindow) {
  const nowMs = Date.now();
  return nowMs >= prayer.start.getTime() && nowMs <= prayer.end.getTime();
}

function EventCard() {
  return (
    <GlassCard padded={false}>
      <View style={styles.eventCard}>
        <LinearGradient colors={['#22233a', '#101119']} style={styles.eventImage}>
          <View style={styles.personLeft} />
          <View style={styles.personHeadLeft} />
          <View style={styles.personRight} />
          <View style={styles.personHeadRight} />
          <LinearGradient colors={['transparent', 'rgba(13,15,24,0.72)']} style={styles.eventImageShade} />
        </LinearGradient>
        <View style={styles.eventBody}>
          <View>
            <View style={styles.dateRow}>
              <Ionicons name="calendar-outline" size={11} color={colors.textDim} />
              <Text style={styles.eventMeta}>23 апреля, 19:00</Text>
            </View>
            <Text style={styles.eventTitle}>Встреча с Игорем Маричем</Text>
          </View>
          <PrimaryButton title="Записаться →" buttonStyle={styles.eventButton} />
        </View>
      </View>
    </GlassCard>
  );
}

function BirthdayRow({ item, isLast }: { item: HomeBirthdayItem; isLast?: boolean }) {
  const router = useRouter();

  return (
    <Pressable
      onPress={() => router.push(`/contacts/${item.id}`)}
      style={({ pressed }) => [styles.birthdayRow, !isLast && styles.rowDivider, pressed && styles.rowPressed]}
    >
      <Avatar initials={item.initials} bg={item.bg} size={40} />
      <View style={styles.birthdayContent}>
        <View style={styles.flex}>
          <Text style={styles.birthdayName}>{item.name}</Text>
          <Text style={styles.birthdayHebrew}>{item.hebrew}</Text>
        </View>
        <Text style={[styles.birthdayWhen, item.active && styles.birthdayToday]}>{item.when}</Text>
      </View>
    </Pressable>
  );
}

export default function HomeScreen() {
  const now = useNow();
  const [showShemaAction, setShowShemaAction] = useState(false);
  const [selectedPrayerId, setSelectedPrayerId] = useState<PrayerWindow['id'] | null>(null);
  const requestedPrayerActivityForUserRef = useRef<string | null>(null);
  const authUser = useAuthStore((state) => state.user);
  const prayerActivityItems = usePrayerTrackerStore((state) => state.items);
  const prayerActivityLoading = usePrayerTrackerStore((state) => state.loading);
  const loadMyActivity = usePrayerTrackerStore((state) => state.loadMyActivity);
  const city = useSettingsStore((state) => state.city);
  const location = useMemo(() => getHebcalLocation(city), [city]);
  const daily = useMemo(() => getDailyZmanim({ city, date: now }), [city, now]);
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
  const parsha = useMemo<WeeklyParsha | null>(() => getWeeklyParsha(hdate, location.getIsrael()), [hdate, location]);
  const holiday = useMemo<UpcomingHoliday | null>(() => getUpcomingHoliday(hdate, location.getIsrael()), [hdate, location]);
  const candle = useMemo<CandleLightingInfo | null>(() => getUpcomingCandleLighting(now, location), [location, now]);
  const prayers = useMemo(() => getPrayerWindows(daily, now), [daily, now]);
  const isShemaAvailable = now.getTime() <= daily.times.shemaGra.at.getTime();
  const birthdays = useMemo<HomeBirthdayItem[]>(
    () =>
      getUpcomingContactBirthdays(mockContacts, now, 3).map(({ birthday, contact }) => ({
        active: birthday.daysUntil === 0,
        bg: contact.avatarBg ?? '#2a3a4a',
        hebrew: contact.hebrewName,
        id: contact.id,
        initials: contact.initials,
        name: contact.name,
        when: birthday.when,
      })),
    [now],
  );
  const currentPrayer =
    prayers.find((item) => item.active) ?? prayers.find((item) => now.getTime() < item.start.getTime()) ?? prayers[prayers.length - 1]!;
  const selectedPrayer = useMemo(
    () => prayers.find((prayer) => prayer.id === selectedPrayerId) ?? null,
    [prayers, selectedPrayerId],
  );
  const activityDate = useMemo(() => formatLocalDateKey(now, daily.timeZone), [daily.timeZone, now]);
  const currentPrayerAlreadyRecorded = Boolean(
    authUser
    && hasRecordedActivity(
      prayerActivityItems,
      prayerActivityTypeFromPrayerId(currentPrayer.id),
      activityDate,
      authUser.id,
    ),
  );
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
    if (!isShemaAvailable && showShemaAction) {
      setShowShemaAction(false);
    }
  }, [isShemaAvailable, showShemaAction]);

  useEffect(() => {
    if (selectedPrayer && !selectedPrayer.active) {
      setSelectedPrayerId(null);
    }
  }, [selectedPrayer]);

  const handleShemaPress = () => {
    if (!isShemaRecordableNow(daily)) {
      Alert.alert('Сейчас недоступно', 'Время утреннего Шма на сегодня уже прошло.');
      setShowShemaAction(false);
      return;
    }

    setShowShemaAction(true);
  };

  const handlePrayerPress = () => {
    if (!currentPrayer.active) {
      Alert.alert('Сейчас недоступно', 'Эту молитву можно отметить только в её текущее время.');
      return;
    }

    setSelectedPrayerId(currentPrayer.id);
  };

  return (
    <Screen>
      <View style={styles.header}>
        <Logo />
        <OmerPill />
      </View>

      <View>
        <Text style={styles.dateTitle}>{hebrewDateLabel}</Text>
        <Text style={styles.dateSubtitle}>{formatRuDate(now, location.getTzid())}</Text>
      </View>

      <Pressable style={styles.locationPill}>
        <Ionicons name="location" size={13} color="rgba(255,255,255,0.62)" />
        <Text style={styles.locationText}>{city} · зманим</Text>
        <Ionicons name="chevron-forward" size={13} color="rgba(255,255,255,0.4)" />
      </Pressable>

      {isShemaAvailable ? <DeadlineCard daily={daily} now={now} onPress={handleShemaPress} /> : null}
      <EventCard />
      <PrayerWindowCard
        accent={currentPrayer.accent}
        active={currentPrayer.active}
        alreadyRecorded={currentPrayerAlreadyRecorded}
        icon={currentPrayer.icon}
        prayerId={currentPrayer.id}
        progress={currentPrayer.progress}
        recordable={currentPrayer.active}
        state={now.getTime() > currentPrayer.end.getTime() ? 'done' : 'upcoming'}
        status={currentPrayer.hebrew}
        onPress={currentPrayer.active ? handlePrayerPress : undefined}
        timeZone={daily.timeZone}
        title={currentPrayer.title}
        windowEnd={currentPrayer.end}
        windowStart={currentPrayer.start}
      />

      <GlassCard>
        <View style={styles.rowBetween}>
          <View>
            <Text style={styles.overline}>НЕДЕЛЬНАЯ ГЛАВА</Text>
            <Text style={styles.cardTitle}>{parsha?.ru ?? holiday?.nameRu ?? 'Особое чтение'}</Text>
            <Text style={styles.hebrew}>{parsha?.he ?? holiday?.nameHe ?? ''}</Text>
            <View style={[styles.dateRow, styles.teacherRow]}>
              <Ionicons name="person-outline" size={11} color={colors.textDim} />
              <Text style={styles.mutedSmall}>Урок раввина Рувена Колина</Text>
            </View>
          </View>
          <View style={[styles.roundIcon, styles.blueBox]}>
            <Text style={styles.roundIconText}>📖</Text>
          </View>
        </View>
      </GlassCard>

      <GlassCard>
        <View style={styles.rowBetween}>
          <View style={styles.candleLeft}>
            <Text style={styles.largeEmoji}>🕯️</Text>
            <View>
              <Text style={styles.overline}>ЗАЖИГАНИЕ СВЕЧЕЙ</Text>
              <Text style={styles.bigTime}>{candle?.time ?? daily.times.sunset.time}</Text>
              <Text style={styles.mutedSmall}>
                {candle ? formatRuWeekdayDayMonth(candle.date, daily.timeZone) : 'перед Шабатом и праздниками'}
              </Text>
            </View>
          </View>
          <PrimaryButton
            title="Записаться на Шабат"
            buttonStyle={styles.candleButton}
            textStyle={styles.smallButtonText}
          />
        </View>
      </GlassCard>

      <GlassCard>
        <View style={styles.holidayTop}>
          <View style={styles.candleLeft}>
            <Text style={styles.largeEmoji}>📜</Text>
            <View style={styles.flex}>
              <Text style={styles.overline}>БЛИЖАЙШИЙ ПРАЗДНИК</Text>
              <Text style={styles.orangeTitle}>{holiday?.nameRu ?? 'Календарь'}</Text>
              <Text style={styles.mutedSmall}>
                {holiday ? `${formatRuWeekdayDayMonth(holiday.date, daily.timeZone)} · ${holiday.hebrewDateRu}` : 'Hebcal не нашёл событие'}
              </Text>
            </View>
          </View>
          <View style={styles.daysBlock}>
            <Text style={styles.daysNumber}>{holiday?.daysUntil ?? '-'}</Text>
            <Text style={styles.mutedSmall}>{holiday ? pluralDays(holiday.daysUntil) : ''}</Text>
          </View>
        </View>
        <PrimaryButton title={holiday ? `Подробнее: ${holiday.nameRu} →` : 'Открыть календарь →'} />
      </GlassCard>

      <View>
        <SectionTitle title="ДНИ РОЖДЕНИЯ · КОНТАКТЫ" action="Все контакты →" />
        <GlassCard padded={false}>
          {birthdays.map((item, index) => (
            <BirthdayRow key={item.name} item={item} isLast={index === birthdays.length - 1} />
          ))}
        </GlassCard>
      </View>

      <PrayerActionModal
        activityType="shema_morning"
        canRecord={() => {
          const recordable = isShemaRecordableNow(daily);
          if (!recordable) {
            setShowShemaAction(false);
          }
          return recordable;
        }}
        city={city}
        confirmButtonTitle="Начал читать Шма"
        details={[
          { label: 'Дедлайн', value: daily.times.shemaGra.time },
          { label: 'Окно', value: `${daily.times.sunrise.time} - ${daily.times.shemaGra.time}` },
          { label: 'Город', value: city },
          { label: 'Часовой пояс', value: daily.timeZone },
          { label: 'Еврейская дата', value: hebrewDateLabel },
        ]}
        hebrewDate={hebrewDatePayload}
        metadata={{
          deadline: daily.times.shemaGra.at.toISOString(),
          source: 'home_shema_card',
          sunrise: daily.times.sunrise.at.toISOString(),
          zmanType: 'shemaGra',
        }}
        onClose={() => setShowShemaAction(false)}
        subtitle={`До ${daily.times.shemaGra.time}`}
        timezone={daily.timeZone}
        title="Утреннее Шма"
        unavailableMessage="Время утреннего Шма на сегодня уже прошло."
        unavailableTitle="Сейчас недоступно"
        visible={showShemaAction && isShemaAvailable}
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
            source: 'home_prayer_card',
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
  dateTitle: {
    color: colors.text,
    fontSize: 28,
    fontWeight: '700',
    letterSpacing: -0.5,
  },
  dateSubtitle: {
    color: colors.textDim,
    fontSize: 14,
    marginTop: 2,
  },
  locationPill: {
    alignSelf: 'flex-start',
    minHeight: 34,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.glass.w10,
    backgroundColor: colors.glass.w07,
    paddingHorizontal: 14,
  },
  locationText: {
    color: colors.textSecondary,
    fontSize: 13,
    fontWeight: '500',
  },
  deadlineCard: {
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
    width: '42%',
    backgroundColor: 'rgba(76,175,80,0.08)',
  },
  deadlineTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
    marginBottom: 10,
  },
  deadlineLeft: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  deadlineRight: {
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
  greenBox: {
    borderColor: 'rgba(76,175,80,0.30)',
    backgroundColor: 'rgba(76,175,80,0.15)',
  },
  emoji: {
    fontSize: 14,
  },
  overline: {
    color: colors.textDim,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.8,
    includeFontPadding: false,
  },
  deadlineTime: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: -0.3,
    marginTop: 2,
  },
  greenValue: {
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
  eventCard: {
    minHeight: 130,
    flexDirection: 'row',
  },
  eventImage: {
    width: 140,
    minHeight: 130,
    position: 'relative',
    overflow: 'hidden',
  },
  eventImageShade: {
    ...StyleSheet.absoluteFillObject,
  },
  personLeft: {
    position: 'absolute',
    bottom: 0,
    left: 10,
    width: 55,
    height: 90,
    borderTopLeftRadius: 40,
    borderTopRightRadius: 40,
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  personHeadLeft: {
    position: 'absolute',
    bottom: 70,
    left: 22,
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  personRight: {
    position: 'absolute',
    bottom: 0,
    right: 10,
    width: 60,
    height: 100,
    borderTopLeftRadius: 40,
    borderTopRightRadius: 40,
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
  personHeadRight: {
    position: 'absolute',
    bottom: 80,
    right: 16,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.09)',
  },
  eventBody: {
    flex: 1,
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 14,
  },
  dateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  eventMeta: {
    color: colors.textDim,
    fontSize: 11,
  },
  eventTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '700',
    lineHeight: 20,
    marginTop: 6,
  },
  eventButton: {
    minHeight: 36,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  rowBetween: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 14,
  },
  cardTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '700',
    marginTop: 6,
  },
  hebrew: {
    color: colors.textGhost,
    fontSize: 12,
    fontStyle: 'italic',
    marginTop: 2,
  },
  teacherRow: {
    marginTop: 6,
  },
  mutedSmall: {
    color: colors.textDim,
    fontSize: 12,
  },
  roundIcon: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
  },
  blueBox: {
    borderColor: 'rgba(80,120,200,0.30)',
    backgroundColor: 'rgba(80,120,200,0.15)',
  },
  roundIconText: {
    fontSize: 26,
  },
  candleLeft: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  largeEmoji: {
    fontSize: 30,
  },
  bigTime: {
    color: colors.text,
    fontSize: 26,
    fontWeight: '700',
  },
  candleButton: {
    width: 104,
    minHeight: 48,
    paddingHorizontal: 10,
  },
  smallButtonText: {
    fontSize: 12,
    lineHeight: 16,
  },
  holidayTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 12,
  },
  orangeTitle: {
    color: colors.orange,
    fontSize: 16,
    fontWeight: '700',
  },
  daysBlock: {
    alignItems: 'center',
  },
  daysNumber: {
    color: colors.orange,
    fontSize: 36,
    fontWeight: '800',
    lineHeight: 38,
  },
  birthdayRow: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  rowDivider: {
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.12)',
  },
  rowPressed: {
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
  birthdayContent: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  flex: {
    flex: 1,
    minWidth: 0,
  },
  birthdayName: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '600',
  },
  birthdayHebrew: {
    color: colors.textGhost,
    fontSize: 12,
    fontStyle: 'italic',
    marginTop: 2,
  },
  birthdayWhen: {
    color: colors.textDim,
    fontSize: 13,
    fontWeight: '600',
  },
  birthdayToday: {
    color: colors.orange,
  },
});
