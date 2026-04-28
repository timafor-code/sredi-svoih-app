import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Linking, Pressable, StyleSheet, Text, View } from 'react-native';

import { GlassCard } from '@/components/glass/GlassCard';
import { HeaderButton, Logo, OmerPill } from '@/components/ui/BrandHeader';
import { PrimaryButton } from '@/components/ui/PrimaryButton';
import { Screen } from '@/components/ui/Screen';
import { SegmentControl } from '@/components/ui/SegmentControl';
import { loadMyRegistrations, registerForEvent } from '@/services/registrationService';
import { useAuthStore } from '@/store/useAuthStore';
import { useEventsStore } from '@/store/useEventsStore';
import { colors } from '@/theme/colors';
import type { EventItem } from '@/types/event';

const filters = ['Все', 'Курсы', 'Праздники'] as const;

function eventMatchesFilter(event: EventItem, filter: (typeof filters)[number]) {
  if (filter === 'Все') return true;
  if (filter === 'Курсы') return event.category === 'Курс';
  return event.category === 'Праздник';
}

type EventCardProps = {
  event: EventItem;
  registered: boolean;
  registering: boolean;
  onRegister: (event: EventItem) => void;
};

function EventCard({ event, registered, registering, onRegister }: EventCardProps) {
  const buttonTitle = registering ? 'Записываем…' : registered ? 'Вы записаны' : 'Хочу пойти →';

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
          <PrimaryButton title={buttonTitle} disabled={registering} onPress={() => onRegister(event)} />
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
            disabled={registering}
            onPress={() => onRegister(event)}
            buttonStyle={styles.smallButton}
            textStyle={styles.smallButtonText}
          />
        </View>
      </View>
    </GlassCard>
  );
}

export default function EventsScreen() {
  const [filter, setFilter] = useState<(typeof filters)[number]>('Все');
  const [registeringEventId, setRegisteringEventId] = useState<string | null>(null);
  const [registeredEventIds, setRegisteredEventIds] = useState<Set<string>>(() => new Set());
  const { events, loading, error, loadEvents } = useEventsStore();
  const authUser = useAuthStore((state) => state.user);
  const loadSession = useAuthStore((state) => state.loadSession);

  useEffect(() => {
    void loadEvents();
  }, [loadEvents]);

  useEffect(() => {
    void loadSession().catch(() => undefined);
  }, [loadSession]);

  useEffect(() => {
    let cancelled = false;

    async function loadRegistrations() {
      if (!authUser) {
        setRegisteredEventIds(new Set());
        return;
      }

      try {
        const registrations = await loadMyRegistrations();

        if (cancelled) {
          return;
        }

        setRegisteredEventIds(new Set(
          registrations
            .filter((registration) => registration.status !== 'cancelled')
            .map((registration) => registration.event_id),
        ));
      } catch {
        if (!cancelled) {
          setRegisteredEventIds(new Set());
        }
      }
    }

    void loadRegistrations();

    return () => {
      cancelled = true;
    };
  }, [authUser]);

  const items = useMemo(() => events.filter((event) => eventMatchesFilter(event, filter)), [events, filter]);

  const handleRegister = useCallback(async (event: EventItem) => {
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

        if (registeredEventIds.has(event.id)) {
          Alert.alert('Вы уже записаны');
          return;
        }

        setRegisteringEventId(event.id);

        try {
          await registerForEvent(event.id, 1, null);
          setRegisteredEventIds((current) => {
            const next = new Set(current);
            next.add(event.id);
            return next;
          });
          Alert.alert('Вы записаны', 'Регистрация на событие создана.');
        } catch (error) {
          if (error instanceof Error && error.message === 'Auth required') {
            Alert.alert('Нужен вход', 'Чтобы записаться на событие, войдите в приложение.');
            return;
          }

          if (
            error instanceof Error
            && (error.message.includes('duplicate key') || error.message.includes('event_registrations_event_id_user_id_key'))
          ) {
            setRegisteredEventIds((current) => {
              const next = new Set(current);
              next.add(event.id);
              return next;
            });
            Alert.alert('Вы уже записаны');
            return;
          }

          Alert.alert(
            'Не удалось записаться',
            error instanceof Error ? error.message : 'Попробуйте повторить позже.',
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
  }, [authUser, registeredEventIds]);

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
        <Pressable key={event.id} style={({ pressed }) => [pressed && styles.pressed]}>
          <EventCard
            event={event}
            registered={registeredEventIds.has(event.id)}
            registering={registeringEventId === event.id}
            onRegister={handleRegister}
          />
        </Pressable>
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
