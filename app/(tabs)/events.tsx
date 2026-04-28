import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Linking, Pressable, StyleSheet, Text, View } from 'react-native';

import { GlassCard } from '@/components/glass/GlassCard';
import { HeaderButton, Logo, OmerPill } from '@/components/ui/BrandHeader';
import { PrimaryButton } from '@/components/ui/PrimaryButton';
import { Screen } from '@/components/ui/Screen';
import { SegmentControl } from '@/components/ui/SegmentControl';
import { useAuthStore } from '@/store/useAuthStore';
import { isActiveEventRegistration, useEventsStore } from '@/store/useEventsStore';
import { colors } from '@/theme/colors';
import type { EventItem, EventRegistration } from '@/types/event';

const filters = ['Все', 'Курсы', 'Праздники'] as const;

function eventMatchesFilter(event: EventItem, filter: (typeof filters)[number]) {
  if (filter === 'Все') return true;
  if (filter === 'Курсы') return event.category === 'Курс';
  return event.category === 'Праздник';
}

type EventCardProps = {
  event: EventItem;
  registration: EventRegistration | null;
  registering: boolean;
  cancelling: boolean;
  onRegister: (event: EventItem, registration: EventRegistration | null) => void;
  onCancel: (registration: EventRegistration) => void;
};

function getRegistrationStatusTitle(registration: EventRegistration): string {
  switch (registration.status) {
    case 'confirmed':
      return 'Вы записаны';
    case 'pending':
      return 'Заявка отправлена';
    case 'waitlisted':
      return 'Вы в листе ожидания';
    default:
      return 'Записаться';
  }
}

function getButtonTitle(event: EventItem, registration: EventRegistration | null, registering: boolean): string {
  if (registering) {
    return 'Записываем...';
  }

  switch (event.registrationMode) {
    case 'none':
      return 'Регистрация не нужна';
    case 'external_link':
      return 'Открыть регистрацию';
    case 'internal_paid':
      return 'Оплата позже';
    case 'internal_free':
      return registration && isActiveEventRegistration(registration)
        ? getRegistrationStatusTitle(registration)
        : 'Записаться';
    default:
      return 'Регистрация недоступна';
  }
}

function EventCard({
  event,
  registration,
  registering,
  cancelling,
  onRegister,
  onCancel,
}: EventCardProps) {
  const activeRegistration = isActiveEventRegistration(registration) ? registration : null;
  const buttonTitle = getButtonTitle(event, registration, registering);
  const showCancelAction = Boolean(activeRegistration && event.registrationMode === 'internal_free');

  if (event.featured) {
    return (
      <GlassCard padded={false}>
        <View style={styles.featuredImage}>
          <Text style={styles.featuredEmoji}>{event.imageIcon}</Text>
          <LinearGradient colors={['rgba(10,10,20,0.85)', 'transparent']} style={StyleSheet.absoluteFillObject} />
          <View style={[styles.tag, styles.featuredTag, { backgroundColor: `${event.tagColor}DD` }]}>
            <Text style={styles.tagTextWhite}>{event.category}</Text>
          </View>
          <Text style={styles.siteText}>www.sredisvoih.com</Text>
        </View>

        <View style={styles.featuredBody}>
          <Text style={styles.featuredTitle}>{event.title}</Text>
          {event.date ? <Text style={styles.featuredDate}>{event.date}</Text> : null}
          <PrimaryButton title={buttonTitle} disabled={registering || cancelling} onPress={() => onRegister(event, registration)} />
          {showCancelAction && activeRegistration ? (
            <Pressable
              disabled={cancelling}
              onPress={() => onCancel(activeRegistration)}
              style={({ pressed }) => [styles.cancelAction, pressed && styles.cancelActionPressed]}
            >
              <Text style={styles.cancelActionText}>{cancelling ? 'Отменяем...' : 'Отменить запись'}</Text>
            </Pressable>
          ) : null}
        </View>
      </GlassCard>
    );
  }

  return (
    <GlassCard padded={false}>
      <View style={styles.eventRow}>
        <LinearGradient colors={['#1a1440', '#0f0f1a']} style={styles.eventImage}>
          <Text style={styles.eventEmoji}>{event.imageIcon}</Text>
          <LinearGradient colors={['transparent', 'rgba(13,15,24,0.45)']} style={StyleSheet.absoluteFillObject} />
        </LinearGradient>

        <View style={styles.eventBody}>
          <View>
            <View style={[styles.tag, { alignSelf: 'flex-start', backgroundColor: `${event.tagColor}22` }]}>
              <Text style={[styles.tagText, { color: event.tagColor }]}>{event.category}</Text>
            </View>

            <Text style={styles.eventTitle}>{event.title}</Text>

            {event.subtitle || event.date ? (
              <Text style={styles.eventSub}>{event.subtitle ?? event.date}</Text>
            ) : null}

            {event.date ? <Text style={styles.eventDate}>{event.date}</Text> : null}
          </View>

          <PrimaryButton
            title={buttonTitle}
            disabled={registering || cancelling}
            onPress={() => onRegister(event, registration)}
            buttonStyle={styles.smallButton}
            textStyle={styles.smallButtonText}
          />
          {showCancelAction && activeRegistration ? (
            <Pressable
              disabled={cancelling}
              onPress={() => onCancel(activeRegistration)}
              style={({ pressed }) => [styles.smallCancelAction, pressed && styles.cancelActionPressed]}
            >
              <Text style={styles.smallCancelActionText}>{cancelling ? 'Отменяем...' : 'Отменить запись'}</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    </GlassCard>
  );
}

export default function EventsScreen() {
  const [filter, setFilter] = useState<(typeof filters)[number]>('Все');
  const [registeringEventId, setRegisteringEventId] = useState<string | null>(null);
  const [cancellingRegistrationId, setCancellingRegistrationId] = useState<string | null>(null);
  const {
    events,
    myRegistrations,
    loading,
    error,
    loadEvents,
    loadMyRegistrations,
    registerForEvent,
    cancelRegistration,
  } = useEventsStore();
  const authUser = useAuthStore((state) => state.user);
  const membership = useAuthStore((state) => state.membership);
  const loadSession = useAuthStore((state) => state.loadSession);

  useEffect(() => {
    void loadEvents();
  }, [loadEvents]);

  useEffect(() => {
    void loadSession().catch(() => undefined);
  }, [loadSession]);

  useEffect(() => {
    void loadMyRegistrations().catch(() => undefined);
  }, [authUser, loadMyRegistrations, membership?.id]);

  const items = useMemo(() => events.filter((event) => eventMatchesFilter(event, filter)), [events, filter]);

  const registrationByEventId = useMemo(() => {
    const registrationMap = new Map<string, EventRegistration>();

    myRegistrations.forEach((registration) => {
      const currentRegistration = registrationMap.get(registration.eventId);

      if (!currentRegistration || isActiveEventRegistration(registration)) {
        registrationMap.set(registration.eventId, registration);
      }
    });

    return registrationMap;
  }, [myRegistrations]);

  const handleRegister = useCallback(async (event: EventItem, registration: EventRegistration | null) => {
    switch (event.registrationMode) {
      case 'none':
        Alert.alert('Регистрация не требуется');
        return;

      case 'external_link':
        if (!event.registrationUrl) {
          Alert.alert('Ссылка недоступна', 'У события пока нет ссылки для регистрации.');
          return;
        }

        try {
          await Linking.openURL(event.registrationUrl);
        } catch (error) {
          Alert.alert(
            'Не удалось открыть ссылку',
            error instanceof Error ? error.message : 'Попробуйте открыть регистрацию позже.',
          );
        }
        return;

      case 'internal_free':
        if (!authUser) {
          Alert.alert('Нужен вход', 'Чтобы записаться на событие, войдите в приложение.');
          return;
        }

        if (registration && isActiveEventRegistration(registration)) {
          Alert.alert('Вы уже записаны', 'Вы уже записаны на это событие.');
          return;
        }

        setRegisteringEventId(event.id);

        try {
          await registerForEvent(event.id);
          Alert.alert('Вы записаны', 'Регистрация на событие создана.');
        } catch (error) {
          if (error instanceof Error && (error.message === 'Auth required' || error.message.includes('Нужен вход'))) {
            Alert.alert('Нужен вход', 'Чтобы записаться на событие, войдите в приложение.');
            return;
          }

          if (
            error instanceof Error
            && (
              error.message.includes('Вы уже записаны')
              || error.message.includes('duplicate key')
              || error.message.includes('event_registrations_event_id_user_id_key')
            )
          ) {
            Alert.alert('Вы уже записаны', 'Вы уже записаны на это событие.');
            return;
          }

          Alert.alert(
            'Не удалось выполнить действие',
            'Проверьте подключение и попробуйте ещё раз.',
          );
        } finally {
          setRegisteringEventId(null);
        }
        return;

      case 'internal_paid':
        Alert.alert('Оплата будет доступна позже');
        return;

      default:
        Alert.alert('Регистрация недоступна');
    }
  }, [authUser, registerForEvent]);

  const handleCancelRegistration = useCallback((registration: EventRegistration) => {
    Alert.alert(
      'Отменить запись?',
      'Вы сможете записаться заново, если места ещё будут доступны.',
      [
        { text: 'Оставить', style: 'cancel' },
        {
          text: 'Отменить запись',
          style: 'destructive',
          onPress: () => {
            async function cancelCurrentRegistration() {
              setCancellingRegistrationId(registration.id);

              try {
                await cancelRegistration(registration.id);
                Alert.alert('Запись отменена');
              } catch {
                Alert.alert(
                  'Не удалось выполнить действие',
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
  }, [cancelRegistration]);

  return (
    <Screen>
      <View style={styles.header}>
        <Logo />
        <OmerPill />
      </View>

      <View style={styles.titleRow}>
        <View>
          <Text style={styles.title}>События</Text>
          <Text style={styles.subtitle}>Афиша мероприятий общины</Text>
        </View>
        <HeaderButton icon="search" />
      </View>

      <SegmentControl items={filters} value={filter} onChange={setFilter} />

      {loading ? <Text style={styles.stateText}>Загружаем события…</Text> : null}

      {error ? <Text style={styles.errorText}>{error}</Text> : null}

      {!loading && !error && items.length === 0 ? (
        <Text style={styles.stateText}>Пока нет опубликованных событий</Text>
      ) : null}

      {items.map((event) => (
        <View key={event.id}>
          <EventCard
            event={event}
            registration={registrationByEventId.get(event.id) ?? null}
            registering={registeringEventId === event.id}
            cancelling={cancellingRegistrationId === registrationByEventId.get(event.id)?.id}
            onRegister={handleRegister}
            onCancel={handleCancelRegistration}
          />
        </View>
      ))}

      <View style={styles.footerHint}>
        <Ionicons name="sparkles" size={14} color={colors.orange} />
        <Text style={styles.footerHintText}>Новые встречи появляются каждую неделю</Text>
      </View>
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
  titleRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: 16,
  },
  title: {
    color: colors.text,
    fontSize: 28,
    fontWeight: '700',
    letterSpacing: 0,
  },
  subtitle: {
    color: colors.textDim,
    fontSize: 13,
    marginTop: 2,
  },
  stateText: {
    color: colors.textDim,
    fontSize: 14,
    textAlign: 'center',
    paddingVertical: 18,
  },
  errorText: {
    color: colors.red,
    fontSize: 14,
    textAlign: 'center',
    paddingVertical: 18,
  },
  featuredImage: {
    height: 140,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    backgroundColor: '#141420',
  },
  featuredEmoji: {
    fontSize: 60,
    opacity: 0.34,
  },
  tag: {
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  featuredTag: {
    position: 'absolute',
    top: 12,
    left: 12,
  },
  tagTextWhite: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '700',
    includeFontPadding: false,
  },
  tagText: {
    fontSize: 11,
    fontWeight: '700',
    includeFontPadding: false,
  },
  siteText: {
    position: 'absolute',
    left: 14,
    right: 14,
    bottom: 10,
    color: colors.textMuted,
    fontSize: 12,
  },
  featuredBody: {
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 16,
  },
  featuredTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '700',
    lineHeight: 21,
    marginBottom: 6,
  },
  featuredDate: {
    color: colors.textGhost,
    fontSize: 12,
    marginBottom: 14,
  },
  eventRow: {
    minHeight: 96,
    flexDirection: 'row',
  },
  eventImage: {
    width: 100,
    alignItems: 'center',
    justifyContent: 'center',
  },
  eventEmoji: {
    fontSize: 40,
    opacity: 0.55,
  },
  eventBody: {
    flex: 1,
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  eventTitle: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '600',
    lineHeight: 18,
    marginTop: 7,
  },
  eventSub: {
    color: colors.textGhost,
    fontSize: 12,
    marginTop: 3,
  },
  eventDate: {
    color: colors.textDim,
    fontSize: 12,
    marginTop: 5,
  },
  smallButton: {
    alignSelf: 'flex-start',
    minHeight: 32,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  smallButtonText: {
    fontSize: 12,
  },
  cancelAction: {
    alignSelf: 'center',
    minHeight: 34,
    justifyContent: 'center',
    marginTop: 8,
    paddingHorizontal: 12,
  },
  smallCancelAction: {
    alignSelf: 'flex-start',
    minHeight: 30,
    justifyContent: 'center',
    marginTop: 6,
    paddingHorizontal: 2,
  },
  cancelActionPressed: {
    opacity: 0.72,
  },
  cancelActionText: {
    color: colors.textDim,
    fontSize: 13,
    fontWeight: '600',
  },
  smallCancelActionText: {
    color: colors.textDim,
    fontSize: 12,
    fontWeight: '600',
  },
  pressed: {
    opacity: 0.82,
  },
  footerHint: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
  },
  footerHintText: {
    color: colors.textGhost,
    fontSize: 12,
  },
});
