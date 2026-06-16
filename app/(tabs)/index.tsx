import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';

import { HomeBirthdaysCard } from '@/components/home/HomeBirthdaysCard';
import type { HomeBirthdayCardItem } from '@/components/home/HomeBirthdaysCard';
import { HomeCandleLightingCard } from '@/components/home/HomeCandleLightingCard';
import { HomeEventCard } from '@/components/home/HomeEventCard';
import { HomeJewishCalendarCard } from '@/components/home/HomeJewishCalendarCard';
import { HomeJewishCalendarInfoModal } from '@/components/home/HomeJewishCalendarInfoModal';
import { HomeLocationPill } from '@/components/home/HomeLocationPill';
import { HomeParshaCard } from '@/components/home/HomeParshaCard';
import { MorningShemaCard } from '@/components/prayer/MorningShemaCard';
import { PrayerActionModal } from '@/components/prayer/PrayerActionModal';
import { PrayerWindowCard } from '@/components/prayer/PrayerWindowCard';
import { Logo, OmerPill } from '@/components/ui/BrandHeader';
import { Screen } from '@/components/ui/Screen';
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
import type { BirthdayOccurrence } from '@/types/contact';

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

function toHomeBirthdayItem(birthday: BirthdayOccurrence): HomeBirthdayCardItem {
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

function getBirthdayContactRoute(item: HomeBirthdayCardItem) {
  return item.source === 'iphone'
    ? getIphoneContactRoute(item.contactId)
    : getCommunityContactRoute(item.contactId);
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
  const birthdays = useMemo<HomeBirthdayCardItem[]>(
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

  const handleBirthdayPress = useCallback((item: HomeBirthdayCardItem) => {
    router.push(getBirthdayContactRoute(item));
  }, [router]);

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

      <HomeLocationPill city={city} />

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

      <HomeParshaCard
        title={parsha?.ru ?? holiday?.nameRu ?? 'Особое чтение'}
        hebrew={parsha?.he ?? holiday?.nameHe ?? ''}
      />

      <HomeCandleLightingCard
        time={candle?.time ?? daily.times.sunset.time}
        subtitle={candle ? formatRuWeekdayDayMonth(candle.date, daily.timeZone) : 'перед Шабатом и праздниками'}
        onRegistrationPress={handleShabbatRegistrationPress}
      />

      <HomeJewishCalendarCard
        accessibilityLabel={getCalendarEventAccessibilityLabel(holiday)}
        buttonTitle={holiday ? `Подробнее: ${holiday.nameRu} →` : 'Открыть календарь →'}
        daysLabel={holiday ? pluralDays(holiday.daysUntil) : ''}
        daysValue={holiday?.daysUntil ?? '-'}
        disabled={!holiday}
        onPress={handleCalendarInfoPress}
        overline={getCalendarEventOverline(holiday)}
        subtitle={holiday ? `${formatRuWeekdayDayMonth(holiday.date, daily.timeZone)} · ${holiday.hebrewDateRu}` : 'Hebcal не нашёл событие'}
        title={holiday?.nameRu ?? 'Календарь'}
      />

      <HomeBirthdaysCard
        error={birthdaysError}
        items={birthdays}
        loading={birthdaysLoading}
        onBirthdayPress={handleBirthdayPress}
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
});
