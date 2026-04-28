import { Ionicons } from '@expo/vector-icons';
import { Stack, useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { GlassCard } from '@/components/glass/GlassCard';
import { PrimaryButton } from '@/components/ui/PrimaryButton';
import { Screen } from '@/components/ui/Screen';
import { SubHeader } from '@/components/ui/SubHeader';
import { useAuthStore } from '@/store/useAuthStore';
import { isActiveEventRegistration, useEventsStore } from '@/store/useEventsStore';
import { colors } from '@/theme/colors';
import type { Event, EventRegistration, EventRegistrationStatus } from '@/types/event';

const inactiveStatuses = new Set<EventRegistrationStatus>([
  'cancelled',
  'rejected',
  'attended',
  'no_show',
]);

const statusTitles: Record<EventRegistrationStatus, string> = {
  confirmed: 'Вы записаны',
  pending: 'Заявка отправлена',
  waitlisted: 'Вы в листе ожидания',
  cancelled: 'Запись отменена',
  rejected: 'Заявка отклонена',
  attended: 'Вы посетили событие',
  no_show: 'Не посетили',
};

const statusTones: Record<EventRegistrationStatus, {
  backgroundColor: string;
  borderColor: string;
  color: string;
}> = {
  confirmed: {
    backgroundColor: colors.accent.greenBg,
    borderColor: colors.accent.greenBorder,
    color: colors.success,
  },
  pending: {
    backgroundColor: colors.accent.goldBg,
    borderColor: colors.accent.goldBorder,
    color: colors.warning,
  },
  waitlisted: {
    backgroundColor: colors.accent.blueBg,
    borderColor: colors.accent.blueBorder,
    color: colors.blueSoft,
  },
  cancelled: {
    backgroundColor: colors.glass.w06,
    borderColor: colors.glass.w12,
    color: colors.textDim,
  },
  rejected: {
    backgroundColor: colors.accent.redBg,
    borderColor: colors.accent.redBorder,
    color: colors.danger,
  },
  attended: {
    backgroundColor: colors.accent.greenBg,
    borderColor: colors.accent.greenBorder,
    color: colors.success,
  },
  no_show: {
    backgroundColor: colors.glass.w06,
    borderColor: colors.glass.w12,
    color: colors.textDim,
  },
};

function parseDate(value: string | null | undefined): number | null {
  if (!value) {
    return null;
  }

  const time = new Date(value).getTime();

  return Number.isNaN(time) ? null : time;
}

function getEventSortTime(registration: EventRegistration): number | null {
  return parseDate(registration.event?.startsAt);
}

function hasEventPassed(event: Event | undefined, now: number): boolean {
  const eventTime = parseDate(event?.endsAt) ?? parseDate(event?.startsAt);

  return eventTime !== null && eventTime < now;
}

function isUpcomingActiveRegistration(registration: EventRegistration, now: number): boolean {
  const startsAt = getEventSortTime(registration);

  return isActiveEventRegistration(registration) && startsAt !== null && startsAt >= now;
}

function getFallbackSortTime(registration: EventRegistration): number {
  return getEventSortTime(registration) ?? parseDate(registration.registeredAt) ?? 0;
}

function sortRegistrations(registrations: EventRegistration[]): EventRegistration[] {
  const now = Date.now();

  return [...registrations].sort((first, second) => {
    const firstUpcoming = isUpcomingActiveRegistration(first, now);
    const secondUpcoming = isUpcomingActiveRegistration(second, now);

    if (firstUpcoming !== secondUpcoming) {
      return firstUpcoming ? -1 : 1;
    }

    if (firstUpcoming && secondUpcoming) {
      return getFallbackSortTime(first) - getFallbackSortTime(second);
    }

    const firstInactive = inactiveStatuses.has(first.status) || hasEventPassed(first.event, now);
    const secondInactive = inactiveStatuses.has(second.status) || hasEventPassed(second.event, now);

    if (firstInactive !== secondInactive) {
      return firstInactive ? 1 : -1;
    }

    return getFallbackSortTime(second) - getFallbackSortTime(first);
  });
}

function formatDateTime(value: string, timeZone?: string | null, includeDate = true): string {
  const date = new Date(value);
  const options: Intl.DateTimeFormatOptions = includeDate
    ? {
      day: 'numeric',
      month: 'long',
      hour: '2-digit',
      minute: '2-digit',
    }
    : {
      hour: '2-digit',
      minute: '2-digit',
    };

  if (timeZone) {
    options.timeZone = timeZone;
  }

  try {
    return new Intl.DateTimeFormat('ru-RU', options).format(date);
  } catch {
    delete options.timeZone;
    return new Intl.DateTimeFormat('ru-RU', options).format(date);
  }
}

function isSameCalendarDay(first: string, second: string, timeZone?: string | null): boolean {
  const options: Intl.DateTimeFormatOptions = {
    day: 'numeric',
    month: 'numeric',
    year: 'numeric',
  };

  if (timeZone) {
    options.timeZone = timeZone;
  }

  try {
    const formatter = new Intl.DateTimeFormat('ru-RU', options);

    return formatter.format(new Date(first)) === formatter.format(new Date(second));
  } catch {
    delete options.timeZone;
    const formatter = new Intl.DateTimeFormat('ru-RU', options);

    return formatter.format(new Date(first)) === formatter.format(new Date(second));
  }
}

function formatEventDate(event: Event | undefined, registeredAt: string): string {
  if (!event?.startsAt) {
    return formatDateTime(registeredAt);
  }

  const start = formatDateTime(event.startsAt, event.timezone);

  if (!event.endsAt) {
    return start;
  }

  const end = isSameCalendarDay(event.startsAt, event.endsAt, event.timezone)
    ? formatDateTime(event.endsAt, event.timezone, false)
    : formatDateTime(event.endsAt, event.timezone);

  return `${start} - ${end}`;
}

function getPlace(event: Event | undefined): string {
  if (event?.locationName && event.address) {
    return `${event.locationName}, ${event.address}`;
  }

  return event?.locationName ?? event?.address ?? 'Место уточняется';
}

type RegistrationCardProps = {
  cancelling: boolean;
  onCancel: (registration: EventRegistration) => void;
  registration: EventRegistration;
};

function RegistrationCard({ cancelling, onCancel, registration }: RegistrationCardProps) {
  const event = registration.event;
  const now = Date.now();
  const canCancel = isActiveEventRegistration(registration) && !hasEventPassed(event, now);
  const statusTone = statusTones[registration.status];

  return (
    <GlassCard style={!canCancel && inactiveStatuses.has(registration.status) ? styles.inactiveCard : undefined}>
      <View style={styles.cardHeader}>
        <View style={styles.cardTitleBlock}>
          <Text style={styles.cardTitle}>{event?.title ?? 'Событие'}</Text>
          <View
            style={[
              styles.statusPill,
              {
                backgroundColor: statusTone.backgroundColor,
                borderColor: statusTone.borderColor,
              },
            ]}
          >
            <Text style={[styles.statusText, { color: statusTone.color }]}>
              {statusTitles[registration.status]}
            </Text>
          </View>
        </View>
      </View>

      <View style={styles.metaBlock}>
        <View style={styles.metaRow}>
          <Ionicons name="calendar-outline" size={15} color={colors.textDim} />
          <Text style={styles.metaText}>{formatEventDate(event, registration.registeredAt)}</Text>
        </View>
        <View style={styles.metaRow}>
          <Ionicons name="location-outline" size={15} color={colors.textDim} />
          <Text style={styles.metaText}>{getPlace(event)}</Text>
        </View>
        {registration.seatsCount > 1 ? (
          <View style={styles.metaRow}>
            <Ionicons name="people-outline" size={15} color={colors.textDim} />
            <Text style={styles.metaText}>Мест: {registration.seatsCount}</Text>
          </View>
        ) : null}
      </View>

      {canCancel ? (
        <Pressable
          disabled={cancelling}
          onPress={() => onCancel(registration)}
          style={({ pressed }) => [
            styles.cancelButton,
            cancelling && styles.cancelButtonDisabled,
            pressed && !cancelling && styles.cancelButtonPressed,
          ]}
        >
          <Text style={styles.cancelButtonText}>
            {cancelling ? 'Отменяем...' : 'Отменить запись'}
          </Text>
        </Pressable>
      ) : null}
    </GlassCard>
  );
}

export default function MyRegistrationsScreen() {
  const router = useRouter();
  const authUser = useAuthStore((state) => state.user);
  const loadSession = useAuthStore((state) => state.loadSession);
  const {
    cancelRegistration,
    error,
    loadMyRegistrations,
    myRegistrations,
    registrationsLoading,
  } = useEventsStore();
  const [refreshing, setRefreshing] = useState(false);
  const [cancellingRegistrationId, setCancellingRegistrationId] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      void loadSession().catch(() => undefined);
    }, [loadSession]),
  );

  useFocusEffect(
    useCallback(() => {
      if (!authUser) {
        return undefined;
      }

      void loadMyRegistrations().catch(() => undefined);

      return undefined;
    }, [authUser, loadMyRegistrations]),
  );

  const sortedRegistrations = useMemo(
    () => sortRegistrations(myRegistrations),
    [myRegistrations],
  );

  const handleRefresh = useCallback(async () => {
    if (!authUser) {
      return;
    }

    setRefreshing(true);

    try {
      await loadMyRegistrations();
    } catch {
      // The store keeps a human-readable error for the screen state.
    } finally {
      setRefreshing(false);
    }
  }, [authUser, loadMyRegistrations]);

  const handleCancelRegistration = useCallback((registration: EventRegistration) => {
    Alert.alert(
      'Отменить запись?',
      'Вы действительно хотите отменить запись на это событие?',
      [
        { text: 'Нет', style: 'cancel' },
        {
          text: 'Отменить запись',
          style: 'destructive',
          onPress: () => {
            async function cancelCurrentRegistration() {
              setCancellingRegistrationId(registration.id);

              try {
                await cancelRegistration(registration.id);
                void loadMyRegistrations().catch(() => undefined);
                Alert.alert('Запись отменена', 'Вы больше не записаны на это событие.');
              } catch {
                Alert.alert(
                  'Не удалось отменить запись',
                  'Проверьте подключение и попробуйте ещё раз.',
                );
              } finally {
                setCancellingRegistrationId(null);
              }
            }

            void cancelCurrentRegistration();
          },
        },
      ],
    );
  }, [cancelRegistration, loadMyRegistrations]);

  const openEvents = useCallback(() => {
    router.push('/events');
  }, [router]);

  const showInitialLoading = authUser && registrationsLoading && sortedRegistrations.length === 0;
  const showBlockingError = authUser && Boolean(error) && !registrationsLoading && sortedRegistrations.length === 0;
  const showInlineError = authUser && Boolean(error) && !registrationsLoading && sortedRegistrations.length > 0;
  const showEmpty = authUser && !registrationsLoading && !error && sortedRegistrations.length === 0;

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <Screen
        contentContainerStyle={styles.content}
        refreshControl={
          authUser ? (
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              tintColor={colors.orange}
              colors={[colors.orange]}
            />
          ) : undefined
        }
      >
        <SubHeader title="Мои записи" subtitle="Ваши регистрации на события" />

        {!authUser ? (
          <GlassCard>
            <View style={styles.stateCard}>
              <Ionicons name="lock-closed-outline" size={24} color={colors.textDim} />
              <Text style={styles.stateTitle}>Войдите, чтобы увидеть свои записи на события.</Text>
            </View>
          </GlassCard>
        ) : null}

        {showInitialLoading ? (
          <GlassCard>
            <View style={styles.stateCard}>
              <ActivityIndicator color={colors.orange} />
              <Text style={styles.stateText}>Загружаем ваши записи...</Text>
            </View>
          </GlassCard>
        ) : null}

        {showBlockingError ? (
          <GlassCard>
            <View style={styles.stateCard}>
              <Ionicons name="alert-circle-outline" size={24} color={colors.danger} />
              <Text style={styles.errorText}>{error}</Text>
              <PrimaryButton title="Повторить" onPress={handleRefresh} />
            </View>
          </GlassCard>
        ) : null}

        {showInlineError ? <Text style={styles.inlineErrorText}>{error}</Text> : null}

        {showEmpty ? (
          <GlassCard>
            <View style={styles.stateCard}>
              <Ionicons name="calendar-clear-outline" size={24} color={colors.textDim} />
              <Text style={styles.stateTitle}>У вас пока нет записей на события.</Text>
              <PrimaryButton title="Посмотреть события" onPress={openEvents} />
            </View>
          </GlassCard>
        ) : null}

        {authUser && !showInitialLoading && !showBlockingError && sortedRegistrations.length > 0 ? (
          <View style={styles.list}>
            {sortedRegistrations.map((registration) => (
              <RegistrationCard
                key={registration.id}
                registration={registration}
                cancelling={cancellingRegistrationId === registration.id}
                onCancel={handleCancelRegistration}
              />
            ))}
          </View>
        ) : null}
      </Screen>
    </>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: 16,
  },
  list: {
    gap: 12,
  },
  cardHeader: {
    gap: 10,
  },
  cardTitleBlock: {
    gap: 9,
  },
  cardTitle: {
    color: colors.text,
    fontSize: 17,
    fontWeight: '700',
    lineHeight: 23,
  },
  inactiveCard: {
    opacity: 0.72,
  },
  statusPill: {
    alignSelf: 'flex-start',
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 9,
    paddingVertical: 4,
  },
  statusText: {
    fontSize: 12,
    fontWeight: '700',
    includeFontPadding: false,
  },
  metaBlock: {
    gap: 8,
    marginTop: 14,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 7,
  },
  metaText: {
    flex: 1,
    color: colors.textDim,
    fontSize: 13,
    lineHeight: 18,
  },
  cancelButton: {
    minHeight: 38,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.accent.redBorder,
    backgroundColor: colors.accent.redBg,
    marginTop: 16,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  cancelButtonPressed: {
    opacity: 0.78,
  },
  cancelButtonDisabled: {
    opacity: 0.55,
  },
  cancelButtonText: {
    color: colors.danger,
    fontSize: 13,
    fontWeight: '700',
  },
  stateCard: {
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
  },
  stateTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '700',
    lineHeight: 21,
    textAlign: 'center',
  },
  stateText: {
    color: colors.textDim,
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
  },
  errorText: {
    color: colors.danger,
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
  },
  inlineErrorText: {
    color: colors.danger,
    fontSize: 13,
    lineHeight: 18,
    textAlign: 'center',
  },
});
