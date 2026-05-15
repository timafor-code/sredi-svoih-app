import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { GlassCard } from '@/components/glass/GlassCard';
import { PrimaryButton } from '@/components/ui/PrimaryButton';
import { Screen } from '@/components/ui/Screen';
import {
  getRegistrationStatusTitle,
  useEventRegistrationAction,
} from '@/hooks/useEventRegistrationAction';
import { isEventPast } from '@/lib/eventTime';
import {
  formatRegistrationWindowLabel,
  getNearestFutureOpening,
  getNearestOccurrence,
  getOpenOccurrences,
  getUnavailableRegistrationText,
} from '@/lib/registrationWindow';
import { listEventOccurrences } from '@/services/eventOccurrencesService';
import { useAuthStore } from '@/store/useAuthStore';
import { isActiveEventRegistration, useEventsStore } from '@/store/useEventsStore';
import { colors } from '@/theme/colors';
import type { EventItem, EventRegistration } from '@/types/event';
import type { EventOccurrence } from '@/types/eventOccurrence';

const registrationModeTitles: Record<EventItem['registrationMode'], string> = {
  none: 'Регистрация не требуется',
  external_link: 'Внешняя регистрация',
  internal_free: 'Бесплатная регистрация',
  internal_paid: 'Платное событие',
};

const eventStatusTitles: Partial<Record<NonNullable<EventItem['status']>, string>> = {
  cancelled: 'Событие отменено',
  archived: 'Событие в архиве',
};

function formatDateTime(value: string, timeZone?: string | null, includeDate = true): string {
  const options: Intl.DateTimeFormatOptions = includeDate
    ? {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
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
    return new Intl.DateTimeFormat('ru-RU', options).format(new Date(value));
  } catch {
    delete options.timeZone;
    return new Intl.DateTimeFormat('ru-RU', options).format(new Date(value));
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

function formatEventDate(event: EventItem): string {
  if (!event.startsAt) {
    return 'Дата уточняется';
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

function hasEventPassed(event: EventItem): boolean {
  return isEventPast(event);
}

function getPlace(event: EventItem): string {
  if (event.locationName && event.address) {
    return `${event.locationName}, ${event.address}`;
  }

  return event.locationName ?? event.address ?? 'Место уточняется';
}

function formatPrice(event: EventItem): string | null {
  if (event.priceAmount === null || event.priceAmount === undefined) {
    return null;
  }

  return `${event.priceAmount} ${event.priceCurrency ?? 'RUB'}`;
}

function getActiveRegistration(registration: EventRegistration | null): EventRegistration | null {
  return isActiveEventRegistration(registration) ? registration : null;
}

function getPaidRegistrationButtonTitle(event: EventItem): string {
  switch (event.eventKind) {
    case 'shabbat':
    case 'single':
      return 'Выбрать участие';
    case 'course':
    case 'sunday_school':
    case 'holiday':
    default:
      return 'Выбрать дату и участие';
  }
}

type PaidRegistrationAvailability = {
  canRegister: boolean;
  hasOccurrences: boolean;
  loading: boolean;
  statusLabel: string | null;
  unavailableReason: string | null;
};

function getPaidRegistrationAvailability(
  occurrences: EventOccurrence[],
  loading: boolean,
  error: string | null,
): PaidRegistrationAvailability {
  if (loading) {
    return {
      canRegister: false,
      hasOccurrences: true,
      loading: true,
      statusLabel: 'Проверяем доступные сеансы...',
      unavailableReason: null,
    };
  }

  if (error) {
    return {
      canRegister: false,
      hasOccurrences: true,
      loading: false,
      statusLabel: 'Регистрация сейчас недоступна',
      unavailableReason: 'Не удалось проверить доступные сеансы. Попробуйте обновить событие.',
    };
  }

  if (occurrences.length === 0) {
    return {
      canRegister: false,
      hasOccurrences: false,
      loading: false,
      statusLabel: 'Регистрация сейчас недоступна',
      unavailableReason: getUnavailableRegistrationText(occurrences),
    };
  }

  const openOccurrences = getOpenOccurrences(occurrences);

  if (openOccurrences.length > 0) {
    return {
      canRegister: true,
      hasOccurrences: true,
      loading: false,
      statusLabel: 'Регистрация открыта',
      unavailableReason: null,
    };
  }

  const nextOpening = getNearestFutureOpening(occurrences);
  const nearestOccurrence = getNearestOccurrence(occurrences);

  if (nextOpening?.registrationOpensAt) {
    return {
      canRegister: false,
      hasOccurrences: true,
      loading: false,
      statusLabel: formatRegistrationWindowLabel(nextOpening),
      unavailableReason: getUnavailableRegistrationText(occurrences),
    };
  }

  return {
    canRegister: false,
    hasOccurrences: true,
    loading: false,
    statusLabel: formatRegistrationWindowLabel(nearestOccurrence),
    unavailableReason: getUnavailableRegistrationText(occurrences),
  };
}

type ChipProps = {
  children: string;
  tone?: 'default' | 'warning' | 'danger' | 'success';
};

function Chip({ children, tone = 'default' }: ChipProps) {
  const toneStyle = {
    default: styles.chipDefault,
    warning: styles.chipWarning,
    danger: styles.chipDanger,
    success: styles.chipSuccess,
  }[tone];

  return (
    <View style={[styles.chip, toneStyle]}>
      <Text style={styles.chipText}>{children}</Text>
    </View>
  );
}

type InfoRowProps = {
  icon: keyof typeof Ionicons.glyphMap;
  text: string;
};

function InfoRow({ icon, text }: InfoRowProps) {
  return (
    <View style={styles.infoRow}>
      <Ionicons name={icon} size={17} color={colors.orange} />
      <Text style={styles.infoText}>{text}</Text>
    </View>
  );
}

type RegistrationBlockProps = {
  cancelling: boolean;
  event: EventItem;
  hasSession: boolean;
  onCancel: (registration: EventRegistration) => void;
  onOpenPaidRegistration: (event: EventItem) => void;
  onRegister: (event: EventItem, registration: EventRegistration | null) => void;
  paidRegistrationAvailability: PaidRegistrationAvailability | null;
  registration: EventRegistration | null;
  registering: boolean;
};

function RegistrationBlock({
  cancelling,
  event,
  hasSession,
  onCancel,
  onOpenPaidRegistration,
  onRegister,
  paidRegistrationAvailability,
  registration,
  registering,
}: RegistrationBlockProps) {
  const activeRegistration = getActiveRegistration(registration);
  const eventPassed = hasEventPassed(event);

  if (event.registrationMode === 'external_link') {
    return (
      <GlassCard>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Регистрация</Text>
          <Chip>Внешняя ссылка</Chip>
        </View>
        <Text style={styles.sectionText}>Запись проходит на внешней странице события.</Text>
        <PrimaryButton
          title="Записаться"
          onPress={() => onRegister(event, registration)}
          buttonStyle={styles.registrationButton}
        />
      </GlassCard>
    );
  }

  if (event.registrationMode === 'internal_paid') {
    const canOpenPaidRegistration = paidRegistrationAvailability?.canRegister ?? true;
    const paidRegistrationButtonTitle = paidRegistrationAvailability?.loading
      ? 'Загружаем сеансы...'
      : canOpenPaidRegistration
        ? getPaidRegistrationButtonTitle(event)
        : 'Регистрация сейчас недоступна';

    return (
      <GlassCard>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Регистрация</Text>
          <Chip tone="warning">Платное участие</Chip>
        </View>
        <Text style={styles.sectionText}>Выберите дату и вариант участия. Оплату и финальную запись подключим следующим этапом.</Text>
        {paidRegistrationAvailability?.statusLabel ? (
          <View style={styles.registrationStatusRow}>
            <Ionicons
              name={canOpenPaidRegistration ? 'checkmark-circle-outline' : 'time-outline'}
              size={17}
              color={canOpenPaidRegistration ? colors.success : colors.warning}
            />
            <Text style={styles.registrationStatusText}>
              {paidRegistrationAvailability.statusLabel}
            </Text>
          </View>
        ) : null}
        {paidRegistrationAvailability?.unavailableReason ? (
          <Text style={styles.mutedNote}>
            {paidRegistrationAvailability.unavailableReason}
          </Text>
        ) : null}
        <PrimaryButton
          title={paidRegistrationButtonTitle}
          disabled={!canOpenPaidRegistration}
          onPress={() => {
            if (canOpenPaidRegistration) {
              onOpenPaidRegistration(event);
            }
          }}
          buttonStyle={styles.registrationButton}
        />
      </GlassCard>
    );
  }

  if (event.registrationMode === 'none') {
    return (
      <GlassCard>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Регистрация</Text>
          <Chip tone="success">Не требуется</Chip>
        </View>
        <Text style={styles.sectionText}>Регистрация не требуется. Можно просто прийти в указанное время.</Text>
      </GlassCard>
    );
  }

  if (!hasSession) {
    return (
      <GlassCard>
        <Text style={styles.sectionTitle}>Нужен вход</Text>
        <Text style={styles.sectionText}>Чтобы записаться на событие, войдите в приложение.</Text>
      </GlassCard>
    );
  }

  if (activeRegistration) {
    return (
      <GlassCard>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Регистрация</Text>
          <Chip tone="success">{getRegistrationStatusTitle(activeRegistration.status)}</Chip>
        </View>
        <Text style={styles.sectionText}>
          {activeRegistration.status === 'pending'
            ? 'Заявка отправлена. Мы покажем обновленный статус после подтверждения.'
            : 'Ваша запись сохранена в профиле в разделе «Мои записи».'}
        </Text>
        {!eventPassed ? (
          <Pressable
            disabled={cancelling}
            onPress={() => onCancel(activeRegistration)}
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
        ) : (
          <Text style={styles.mutedNote}>Событие уже прошло, отмена записи недоступна.</Text>
        )}
      </GlassCard>
    );
  }

  return (
    <GlassCard>
      <Text style={styles.sectionTitle}>Регистрация</Text>
      <Text style={styles.sectionText}>Запись проходит внутри приложения.</Text>
      <PrimaryButton
        title={registering ? 'Записываем...' : 'Записаться'}
        disabled={registering}
        onPress={() => onRegister(event, registration)}
        buttonStyle={styles.registrationButton}
      />
    </GlassCard>
  );
}

export default function EventDetailScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const eventId = Array.isArray(params.id) ? params.id[0] : params.id;
  const [heroImageFailed, setHeroImageFailed] = useState(false);
  const [paidOccurrences, setPaidOccurrences] = useState<EventOccurrence[]>([]);
  const [paidOccurrencesLoadedEventId, setPaidOccurrencesLoadedEventId] = useState<string | null>(null);
  const [paidOccurrencesLoading, setPaidOccurrencesLoading] = useState(false);
  const [paidOccurrencesError, setPaidOccurrencesError] = useState<string | null>(null);
  const session = useAuthStore((state) => state.session);
  const authUser = useAuthStore((state) => state.user);
  const membership = useAuthStore((state) => state.membership);
  const loadSession = useAuthStore((state) => state.loadSession);
  const {
    events,
    loadEventById,
    loadMyRegistrations,
    myRegistrations,
    selectedEvent,
    selectedEventError,
    selectedEventLoading,
  } = useEventsStore();
  const {
    cancellingRegistrationId,
    handleCancelRegistration,
    handleRegistrationAction,
    registeringEventId,
  } = useEventRegistrationAction();

  useEffect(() => {
    void loadSession().catch(() => undefined);
  }, [loadSession]);

  useEffect(() => {
    if (!eventId) {
      return;
    }

    void loadEventById(eventId, { forceRefresh: true }).catch(() => undefined);
  }, [authUser?.id, eventId, loadEventById, membership?.id, membership?.status]);

  useEffect(() => {
    if (!authUser) {
      return;
    }

    void loadMyRegistrations().catch(() => undefined);
  }, [authUser?.id, loadMyRegistrations]);

  const event = useMemo(() => {
    if (!eventId) {
      return null;
    }

    if (selectedEvent?.id === eventId) {
      return selectedEvent;
    }

    if (selectedEventLoading) {
      return null;
    }

    return events.find((item) => item.id === eventId) ?? null;
  }, [eventId, events, selectedEvent, selectedEventLoading]);

  useEffect(() => {
    setHeroImageFailed(false);
  }, [event?.imageUrl]);

  useEffect(() => {
    if (!event?.id || event.registrationMode !== 'internal_paid') {
      setPaidOccurrences([]);
      setPaidOccurrencesLoadedEventId(null);
      setPaidOccurrencesLoading(false);
      setPaidOccurrencesError(null);
      return;
    }

    let cancelled = false;

    setPaidOccurrencesLoading(true);
    setPaidOccurrencesError(null);

    void listEventOccurrences(event.id)
      .then((loadedOccurrences) => {
        if (cancelled) {
          return;
        }

        setPaidOccurrences(loadedOccurrences);
        setPaidOccurrencesLoadedEventId(event.id);
        setPaidOccurrencesError(null);
      })
      .catch(() => {
        if (cancelled) {
          return;
        }

        setPaidOccurrences([]);
        setPaidOccurrencesLoadedEventId(event.id);
        setPaidOccurrencesError('Не удалось проверить доступные сеансы.');
      })
      .finally(() => {
        if (!cancelled) {
          setPaidOccurrencesLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [event?.id, event?.registrationMode]);

  const registration = useMemo(() => {
    if (!eventId) {
      return null;
    }

    const eventRegistrations = myRegistrations.filter((item) => item.eventId === eventId);

    return eventRegistrations.find(isActiveEventRegistration) ?? eventRegistrations[0] ?? null;
  }, [eventId, myRegistrations]);

  const handleBack = useCallback(() => {
    if (router.canGoBack()) {
      router.back();
      return;
    }

    router.push('/events');
  }, [router]);

  const handleRetry = useCallback(() => {
    if (!eventId) {
      return;
    }

    void loadEventById(eventId, { forceRefresh: true }).catch(() => undefined);
  }, [eventId, loadEventById]);

  const handleOpenPaidRegistration = useCallback((targetEvent: EventItem) => {
    const openOccurrences = getOpenOccurrences(
      paidOccurrencesLoadedEventId === targetEvent.id ? paidOccurrences : [],
    );

    if (openOccurrences.length === 0) {
      return;
    }

    if (openOccurrences.length === 1) {
      router.push({
        pathname: '/events/paid-options',
        params: { eventId: targetEvent.id, occurrenceId: openOccurrences[0].id },
      });
      return;
    }

    router.push({
      pathname: '/events/paid-occurrences',
      params: { eventId: targetEvent.id },
    });
  }, [paidOccurrences, paidOccurrencesLoadedEventId, router]);

  const conditionRows = useMemo(() => {
    if (!event) {
      return [];
    }

    const rows = [registrationModeTitles[event.registrationMode]];
    const price = formatPrice(event);

    if (event.capacity) {
      rows.push(`Мест: ${event.capacity}`);
    }

    if (event.requiresApproval) {
      rows.push('Требуется подтверждение');
    }

    if (event.waitlistEnabled) {
      rows.push('Есть лист ожидания');
    }

    if (event.registrationMode === 'internal_paid' && price) {
      rows.push(`Стоимость: ${price}`);
    }

    return rows;
  }, [event]);

  const paidRegistrationAvailability = useMemo(() => {
    if (!event || event.registrationMode !== 'internal_paid') {
      return null;
    }

    return getPaidRegistrationAvailability(
      paidOccurrences,
      paidOccurrencesLoading || paidOccurrencesLoadedEventId !== event.id,
      paidOccurrencesError,
    );
  }, [
    event,
    paidOccurrences,
    paidOccurrencesError,
    paidOccurrencesLoadedEventId,
    paidOccurrencesLoading,
  ]);

  const description = event?.description ?? event?.shortDescription ?? null;
  const statusTitle = event?.status ? eventStatusTitles[event.status] : undefined;
  const showHeroImage = Boolean(event?.imageUrl && !heroImageFailed);
  const unavailableHint = !session
    ? 'Войдите и примите приглашение, чтобы увидеть это событие.'
    : membership?.status !== 'active'
      ? 'Примите приглашение, чтобы увидеть события для участников общины.'
      : 'У вас нет доступа к этому событию или оно больше не опубликовано.';

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <Screen contentContainerStyle={styles.content}>
        <Pressable onPress={handleBack} style={styles.backButton}>
          <Ionicons name="chevron-back" size={22} color={colors.orange} />
          <Text style={styles.backText}>Назад</Text>
        </Pressable>

        {selectedEventLoading && !event ? (
          <GlassCard>
            <View style={styles.stateCard}>
              <ActivityIndicator color={colors.orange} />
              <Text style={styles.stateText}>Загружаем событие...</Text>
            </View>
          </GlassCard>
        ) : null}

        {!selectedEventLoading && selectedEventError && !event ? (
          <GlassCard>
            <View style={styles.stateCard}>
              <Ionicons name="alert-circle-outline" size={24} color={colors.danger} />
              <Text style={styles.errorText}>{selectedEventError}</Text>
              <Text style={styles.stateText}>{unavailableHint}</Text>
              <PrimaryButton title="Повторить" onPress={handleRetry} />
            </View>
          </GlassCard>
        ) : null}

        {!selectedEventLoading && !selectedEventError && !event ? (
          <GlassCard>
            <View style={styles.stateCard}>
              <Ionicons name="calendar-clear-outline" size={24} color={colors.textDim} />
              <Text style={styles.stateText}>Событие не найдено</Text>
            </View>
          </GlassCard>
        ) : null}

        {event ? (
          <>
            <View style={styles.hero}>
              {showHeroImage ? (
                <Image
                  source={{ uri: event.imageUrl ?? '' }}
                  resizeMode="cover"
                  style={styles.heroImage}
                  onError={() => setHeroImageFailed(true)}
                />
              ) : (
                <LinearGradient
                  colors={['rgba(240,122,42,0.28)', 'rgba(74,144,217,0.18)', 'rgba(13,15,24,0.96)']}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={styles.heroPlaceholder}
                >
                  <Text style={styles.heroEmoji}>{event.imageIcon}</Text>
                </LinearGradient>
              )}
              <LinearGradient
                colors={['transparent', 'rgba(6,8,16,0.92)']}
                style={StyleSheet.absoluteFillObject}
              />
              <View style={styles.heroChips}>
                <Chip>{event.category}</Chip>
                {event.visibility === 'members_only' ? <Chip tone="warning">Для участников</Chip> : null}
                {event.audience ? <Chip>{event.audience}</Chip> : null}
              </View>
            </View>

            <View style={styles.titleBlock}>
              {statusTitle ? <Chip tone={event.status === 'cancelled' ? 'danger' : 'warning'}>{statusTitle}</Chip> : null}
              <Text style={styles.title}>{event.title}</Text>
              {event.subtitle ? <Text style={styles.subtitle}>{event.subtitle}</Text> : null}
            </View>

            <GlassCard>
              <View style={styles.infoBlock}>
                <InfoRow icon="calendar-outline" text={formatEventDate(event)} />
                <InfoRow icon="location-outline" text={getPlace(event)} />
              </View>
            </GlassCard>

            {description ? (
              <GlassCard>
                <Text style={styles.sectionTitle}>Описание</Text>
                <Text style={styles.descriptionText}>{description}</Text>
              </GlassCard>
            ) : null}

            <GlassCard>
              <Text style={styles.sectionTitle}>Условия</Text>
              <View style={styles.conditions}>
                {conditionRows.map((row) => (
                  <View key={row} style={styles.conditionRow}>
                    <View style={styles.conditionDot} />
                    <Text style={styles.conditionText}>{row}</Text>
                  </View>
                ))}
              </View>
            </GlassCard>

            <RegistrationBlock
              event={event}
              registration={registration}
              hasSession={Boolean(session)}
              registering={registeringEventId === event.id}
              cancelling={cancellingRegistrationId === registration?.id}
              paidRegistrationAvailability={paidRegistrationAvailability}
              onRegister={handleRegistrationAction}
              onCancel={handleCancelRegistration}
              onOpenPaidRegistration={handleOpenPaidRegistration}
            />
          </>
        ) : null}
      </Screen>
    </>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: 14,
    paddingBottom: 36,
  },
  backButton: {
    alignSelf: 'flex-start',
    minHeight: 36,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  backText: {
    color: colors.orange,
    fontSize: 15,
    fontWeight: '600',
  },
  hero: {
    height: 224,
    borderRadius: 22,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surface,
  },
  heroImage: {
    width: '100%',
    height: '100%',
  },
  heroPlaceholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroEmoji: {
    fontSize: 70,
    opacity: 0.58,
  },
  heroChips: {
    position: 'absolute',
    left: 14,
    right: 14,
    bottom: 14,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    alignSelf: 'flex-start',
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 9,
    paddingVertical: 4,
  },
  chipDefault: {
    borderColor: colors.glass.w16,
    backgroundColor: colors.glass.w10,
  },
  chipWarning: {
    borderColor: colors.accent.goldBorder,
    backgroundColor: colors.accent.goldBg,
  },
  chipDanger: {
    borderColor: colors.accent.redBorder,
    backgroundColor: colors.accent.redBg,
  },
  chipSuccess: {
    borderColor: colors.accent.greenBorder,
    backgroundColor: colors.accent.greenBg,
  },
  chipText: {
    color: colors.text,
    fontSize: 12,
    fontWeight: '700',
    includeFontPadding: false,
  },
  titleBlock: {
    gap: 8,
  },
  title: {
    color: colors.text,
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: 0,
    lineHeight: 34,
  },
  subtitle: {
    color: colors.textMuted,
    fontSize: 15,
    lineHeight: 21,
  },
  infoBlock: {
    gap: 11,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 9,
  },
  infoText: {
    flex: 1,
    color: colors.textSecondary,
    fontSize: 14,
    lineHeight: 20,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    marginBottom: 10,
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '700',
  },
  sectionText: {
    color: colors.textDim,
    fontSize: 14,
    lineHeight: 20,
    marginTop: 8,
  },
  descriptionText: {
    color: colors.textSecondary,
    fontSize: 14,
    lineHeight: 22,
    marginTop: 10,
  },
  conditions: {
    gap: 9,
    marginTop: 12,
  },
  conditionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
  },
  conditionDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.orange,
  },
  conditionText: {
    flex: 1,
    color: colors.textDim,
    fontSize: 14,
    lineHeight: 20,
  },
  registrationButton: {
    marginTop: 14,
  },
  registrationStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    marginTop: 12,
  },
  registrationStatusText: {
    flex: 1,
    color: colors.textSecondary,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
  },
  cancelButton: {
    minHeight: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.accent.redBorder,
    backgroundColor: colors.accent.redBg,
    marginTop: 16,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  cancelButtonPressed: {
    opacity: 0.78,
  },
  cancelButtonDisabled: {
    opacity: 0.55,
  },
  cancelButtonText: {
    color: colors.danger,
    fontSize: 14,
    fontWeight: '700',
  },
  mutedNote: {
    color: colors.textGhost,
    fontSize: 13,
    lineHeight: 18,
    marginTop: 12,
  },
  stateCard: {
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
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
});
