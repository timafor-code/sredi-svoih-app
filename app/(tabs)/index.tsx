import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { GlassCard } from '@/components/glass/GlassCard';
import { HomeEventCard } from '@/components/home/HomeEventCard';
import { HomeJewishCalendarInfoModal } from '@/components/home/HomeJewishCalendarInfoModal';
import { MorningShemaCard } from '@/components/prayer/MorningShemaCard';
import { PrayerActionModal } from '@/components/prayer/PrayerActionModal';
import { PrayerWindowCard } from '@/components/prayer/PrayerWindowCard';
import { Avatar } from '@/components/ui/Avatar';
import { Logo, OmerPill } from '@/components/ui/BrandHeader';
import { PrimaryButton } from '@/components/ui/PrimaryButton';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { Screen } from '@/components/ui/Screen';
import { SectionTitle } from '@/components/ui/SectionTitle';
import { useNow } from '@/hooks/useNow';
import { getCommunityContactRoute, getIphoneContactRoute } from '@/lib/contactRoutes';
import { formatRuDate, formatRuTime, formatRuWeekdayDayMonth } from '@/lib/dates';
import { selectHomeEvent, selectHomeShabbatEvent } from '@/lib/homeEvents';
import { getHebrewDate, getHebrewDateLabel, getUpcomingHoliday, getWeeklyParsha } from '@/lib/hebcal';
import type { UpcomingHoliday, WeeklyParsha } from '@/lib/hebcal';
import { formatLocalDateKey, hasRecordedActivity, prayerActivityTypeFromPrayerId } from '@/lib/prayerTracker';
import {
  getDailyZmanim,
  getHebcalLocation,
  getPrayerWindows,
  getUpcomingCandleLighting,
} from '@/lib/zmanim';
import type { CandleLightingInfo, PrayerWindow } from '@/lib/zmanim';
import { useAuthStore } from '@/store/useAuthStore';
import { useContactsStore } from '@/store/useContactsStore';
import { useEventsStore } from '@/store/useEventsStore';
import { usePrayerTrackerStore } from '@/store/usePrayerTrackerStore';
import { useSettingsStore } from '@/store/useSettingsStore';
import { colors } from '@/theme/colors';
import type { BirthdayOccurrence, ContactSource } from '@/types/contact';

type HomeBirthdayItem = {
  active: boolean;
  bg: string;
  contactId: string;
  hebrew: string;
  id: string;
  initials: string;
  name: string;
  source: ContactSource;
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

function getCalendarEventOverline(event: UpcomingHoliday | null) {
  if (!event) return 'БЛИЖАЙШИЙ ПРАЗДНИК';

  if (event.kind === 'fast') return 'БЛИЖАЙШИЙ ПОСТ';
  if (event.kind === 'modern_holiday') return 'ПАМЯТНАЯ ДАТА';
  return 'БЛИЖАЙШИЙ ПРАЗДНИК';
}

function getCalendarEventAccessibilityLabel(event: UpcomingHoliday | null) {
  if (!event) return 'Открыть календарь';

  if (event.kind === 'fast') {
    return `Открыть описание поста ${event.nameRu}`;
  }

  if (event.kind === 'modern_holiday') {
    return `Открыть описание памятной даты ${event.nameRu}`;
  }

  return `Открыть описание праздника ${event.nameRu}`;
}

function isPrayerRecordableNow(prayer: PrayerWindow) {
  const nowMs = Date.now();
  return nowMs >= prayer.start.getTime() && nowMs <= prayer.end.getTime();
}

function toHomeBirthdayItem(birthday: BirthdayOccurrence): HomeBirthdayItem {
  return {
    active: birthday.daysUntil === 0,
    bg: birthday.avatarBg ?? '#2a3a4a',
    contactId: birthday.contactId,
    hebrew: birthday.nextDateHebrew.label || birthday.hebrewBirthDate.label,
    id: birthday.id,
    initials: birthday.initials,
    name: birthday.displayName,
    source: birthday.source,
    when: birthday.when,
  };
}

function getBirthdayContactRoute(item: HomeBirthdayItem) {
  return item.source === 'iphone'
    ? getIphoneContactRoute(item.contactId)
    : getCommunityContactRoute(item.contactId);
}

function BirthdayRow({ item, isLast }: { item: HomeBirthdayItem; isLast?: boolean }) {
  const router = useRouter();

  return (
    <Pressable
      onPress={() => router.push(getBirthdayContactRoute(item))}
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
  const router = useRouter();
  const now = useNow();
  const [selectedPrayerId, setSelectedPrayerId] = useState<PrayerWindow['id'] | null>(null);
  const [calendarInfoVisible, setCalendarInfoVisible] = useState(false);
  const requestedPrayerActivityForUserRef = useRef<string | null>(null);
  const authUser = useAuthStore((state) => state.user);
  const events = useEventsStore((state) => state.events);
  const eventsLoading = useEventsStore((state) => state.loading);
  const eventsError = useEventsStore((state) => state.error);
  const loadEvents = useEventsStore((state) => state.loadEvents);
  const upcomingBirthdays = useContactsStore((state) => state.upcomingBirthdays);
  const refreshContacts = useContactsStore((state) => state.refreshAll);
  const contactsLoadingCommunity = useContactsStore((state) => state.loadingCommunity);
  const contactsLoadingLocal = useContactsStore((state) => state.loadingLocal);
  const contactsCommunityError = useContactsStore((state) => state.communityError);
  const contactsError = useContactsStore((state) => state.error);
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
  const birthdays = useMemo<HomeBirthdayItem[]>(
    () => upcomingBirthdays.slice(0, 3).map(toHomeBirthdayItem),
    [upcomingBirthdays],
  );
  const birthdaysLoading = (contactsLoadingCommunity || contactsLoadingLocal) && birthdays.length === 0;
  const birthdaysError = Boolean((contactsCommunityError || contactsError) && birthdays.length === 0);
  const homeEvent = useMemo(() => selectHomeEvent(events, now.getTime()), [events, now]);
  const homeShabbatEvent = useMemo(() => selectHomeShabbatEvent(events, now.getTime()), [events, now]);
  const calendarDaysUntilText = useMemo(() => {
    if (!holiday) return undefined;
    if (holiday.daysUntil === 0) return 'сегодня';
    return `${holiday.daysUntil} ${pluralDays(holiday.daysUntil)}`;
  }, [holiday]);
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
    void loadEvents().catch(() => undefined);
  }, [authUser?.id, loadEvents]);

  useEffect(() => {
    void refreshContacts().catch(() => undefined);
  }, [authUser?.id, refreshContacts]);

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

  const handlePrayerPress = () => {
    if (!currentPrayer.active) {
      Alert.alert('Сейчас недоступно', 'Эту молитву можно отметить только в её текущее время.');
      return;
    }

    setSelectedPrayerId(currentPrayer.id);
  };

  const handleHomeEventPress = useCallback((eventId: string) => {
    router.push({ pathname: '/events/[id]', params: { id: eventId } });
  }, [router]);

  const handleShabbatRegistrationPress = useCallback(() => {
    if (!homeShabbatEvent) {
      Alert.alert('Регистрация на ближайший Шабат пока не опубликована.');
      return;
    }

    handleHomeEventPress(homeShabbatEvent.id);
  }, [handleHomeEventPress, homeShabbatEvent]);

  const handleCalendarInfoPress = useCallback(() => {
    if (!holiday) return;
    setCalendarInfoVisible(true);
  }, [holiday]);

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

      <MorningShemaCard
        city={city}
        daily={daily}
        hebrewDate={hebrewDatePayload}
        hebrewDateLabel={hebrewDateLabel}
        now={now}
        source="home_shema_card"
      />
      <HomeEventCard
        event={homeEvent}
        loading={eventsLoading}
        error={eventsError}
        onPress={handleHomeEventPress}
      />
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
            onPress={handleShabbatRegistrationPress}
            textStyle={styles.smallButtonText}
          />
        </View>
      </GlassCard>

      <GlassCard>
        <View style={styles.holidayTop}>
          <View style={styles.candleLeft}>
            <Text style={styles.largeEmoji}>📜</Text>
            <View style={styles.flex}>
              <Text style={styles.overline}>{getCalendarEventOverline(holiday)}</Text>
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
        <PrimaryButton
          accessibilityLabel={getCalendarEventAccessibilityLabel(holiday)}
          accessibilityRole="button"
          disabled={!holiday}
          onPress={handleCalendarInfoPress}
          textNumberOfLines={2}
          title={holiday ? `Подробнее: ${holiday.nameRu} →` : 'Открыть календарь →'}
        />
      </GlassCard>

      <View>
        <SectionTitle title="ДНИ РОЖДЕНИЯ · КОНТАКТЫ" action="Все контакты →" />
        <GlassCard padded={false}>
          {birthdaysLoading ? (
            <View style={styles.birthdayState}>
              <Text style={styles.birthdayStateText}>Загружаем дни рождения…</Text>
            </View>
          ) : birthdaysError ? (
            <View style={styles.birthdayState}>
              <Text style={styles.birthdayStateText}>Не удалось загрузить контакты</Text>
            </View>
          ) : birthdays.length === 0 ? (
            <View style={styles.birthdayState}>
              <Text style={styles.birthdayStateText}>Ближайшие дни рождения не найдены</Text>
            </View>
          ) : (
            birthdays.map((item, index) => (
              <BirthdayRow key={item.id} item={item} isLast={index === birthdays.length - 1} />
            ))
          )}
        </GlassCard>
      </View>

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

      <HomeJewishCalendarInfoModal
        daysUntilText={calendarDaysUntilText}
        event={holiday}
        onClose={() => setCalendarInfoVisible(false)}
        timeZone={daily.timeZone}
        visible={calendarInfoVisible}
      />
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
  overline: {
    color: colors.textDim,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.8,
    includeFontPadding: false,
  },
  dateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
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
  birthdayState: {
    minHeight: 64,
    justifyContent: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  birthdayStateText: {
    color: colors.textDim,
    fontSize: 13,
    fontWeight: '500',
  },
});
