import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Image,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { GlassCard } from '@/components/glass/GlassCard';
import { Logo, OmerPill } from '@/components/ui/BrandHeader';
import { PrimaryButton } from '@/components/ui/PrimaryButton';
import { Screen } from '@/components/ui/Screen';
import { SegmentControl } from '@/components/ui/SegmentControl';
import {
  getEventRegistrationActionTitle,
  useEventRegistrationAction,
} from '@/hooks/useEventRegistrationAction';
import {
  getEventEarliestUpcomingTime,
  isEventPast,
} from '@/lib/eventTime';
import { useAuthStore } from '@/store/useAuthStore';
import { isActiveEventRegistration, useEventsStore } from '@/store/useEventsStore';
import { colors } from '@/theme/colors';
import type { EventItem, EventRegistration } from '@/types/event';
import type { EventOccurrence } from '@/types/eventOccurrence';

const SPECIAL_FILTERS = [
  { id: 'all', title: 'Все' },
  { id: 'members_only', title: 'Для участников' },
  { id: 'paid', title: 'Платные' },
  { id: 'free', title: 'Бесплатные' },
] as const;

const CATEGORY_FILTER_PREFIX = 'category:';

const timeFilters = ['Ближайшие', 'Прошедшие'] as const;

type SpecialFilterId = (typeof SPECIAL_FILTERS)[number]['id'];
type EventFilterId = SpecialFilterId | `${typeof CATEGORY_FILTER_PREFIX}${string}`;
type EventTimeFilter = (typeof timeFilters)[number];

type EventFilterOption = { id: EventFilterId; title: string };

function isCategoryFilter(filter: EventFilterId): filter is `${typeof CATEGORY_FILTER_PREFIX}${string}` {
  return filter.startsWith(CATEGORY_FILTER_PREFIX);
}

function categoryFilterSlug(filter: EventFilterId): string | null {
  return isCategoryFilter(filter) ? filter.slice(CATEGORY_FILTER_PREFIX.length) : null;
}

function normalizeSearchQuery(value: string): string {
  return value.trim().toLocaleLowerCase('ru-RU');
}

function normalizeFilterValue(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

function eventMatchesSearch(event: EventItem, query: string): boolean {
  if (!query) {
    return true;
  }

  return [
    event.title,
    event.subtitle,
    event.shortDescription,
    event.description,
    event.locationName,
    event.address,
  ].some((value) => (value ?? '').toLocaleLowerCase('ru-RU').includes(query));
}

function eventMatchesFilter(event: EventItem, filter: EventFilterId): boolean {
  const priceAmount = event.priceAmount ?? 0;
  const slug = categoryFilterSlug(filter);

  if (slug !== null) {
    return normalizeFilterValue(event.rawCategory) === slug;
  }

  switch (filter) {
    case 'all':
      return true;
    case 'members_only':
      return event.visibility === 'members_only';
    case 'paid':
      return priceAmount > 0 || event.registrationMode === 'internal_paid';
    case 'free':
      return priceAmount <= 0 && event.registrationMode !== 'internal_paid';
    default:
      return true;
  }
}

function parseEventTime(value: string | null | undefined): number | null {
  if (!value) {
    return null;
  }

  const time = new Date(value).getTime();

  return Number.isNaN(time) ? null : time;
}

function eventMatchesTimeFilter(
  event: EventItem,
  filter: EventTimeFilter,
  occurrences: EventOccurrence[] | undefined,
  now: number,
): boolean {
  const past = isEventPast(event, occurrences, now);
  return filter === 'Ближайшие' ? !past : past;
}

function getEventSortTime(
  event: EventItem,
  occurrences: EventOccurrence[] | undefined,
  filter: EventTimeFilter,
  now: number,
): number {
  if (filter === 'Ближайшие') {
    return (
      getEventEarliestUpcomingTime(event, occurrences, now)
      ?? parseEventTime(event.startsAt)
      ?? 0
    );
  }

  return parseEventTime(event.startsAt) ?? 0;
}

function sortEventsByTime(
  events: EventItem[],
  filter: EventTimeFilter,
  occurrencesByEventId: Record<string, EventOccurrence[]>,
  now: number,
): EventItem[] {
  return [...events].sort((first, second) => {
    const firstTime = getEventSortTime(first, occurrencesByEventId[first.id], filter, now);
    const secondTime = getEventSortTime(second, occurrencesByEventId[second.id], filter, now);

    if (firstTime === secondTime) {
      return first.title.localeCompare(second.title, 'ru');
    }

    return filter === 'Ближайшие'
      ? firstTime - secondTime
      : secondTime - firstTime;
  });
}

function markFirstEventFeatured(events: EventItem[]): EventItem[] {
  return events.map((event, index) => ({
    ...event,
    featured: index === 0,
  }));
}

type EventFilterChipProps = {
  active: boolean;
  onPress: () => void;
  title: string;
};

function EventFilterChip({ active, onPress, title }: EventFilterChipProps) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.filterChip,
        active && styles.filterChipActive,
        pressed && styles.pressed,
      ]}
    >
      <Text style={[styles.filterChipText, active && styles.filterChipTextActive]}>
        {title}
      </Text>
    </Pressable>
  );
}

type EmptyStateProps = {
  text: string;
};

function EmptyState({ text }: EmptyStateProps) {
  return (
    <GlassCard>
      <View style={styles.emptyState}>
        <Ionicons name="calendar-clear-outline" size={22} color={colors.textDim} />
        <Text style={styles.stateText}>{text}</Text>
      </View>
    </GlassCard>
  );
}

type EventCardProps = {
  event: EventItem;
  registration: EventRegistration | null;
  registering: boolean;
  cancelling: boolean;
  onRegister: (event: EventItem, registration: EventRegistration | null) => void;
  onCancel: (registration: EventRegistration) => void;
  onOpen: (event: EventItem) => void;
};

function RegistrationModeBadge({ mode }: { mode: EventItem['registrationMode'] }) {
  if (mode === 'none') {
    return null;
  }

  const title = {
    external_link: 'Внешняя запись',
    internal_free: 'Бесплатно',
    internal_paid: 'Платно',
  }[mode];
  const toneStyle = {
    external_link: styles.badgeExternal,
    internal_free: styles.badgeFree,
    internal_paid: styles.badgePaid,
  }[mode];

  return (
    <View style={[styles.modeBadge, toneStyle]}>
      <Text style={styles.modeBadgeText}>{title}</Text>
    </View>
  );
}

function EventCard({
  event,
  registration,
  registering,
  cancelling,
  onRegister,
  onCancel,
  onOpen,
}: EventCardProps) {
  const activeRegistration = isActiveEventRegistration(registration) ? registration : null;
  const buttonTitle = getEventRegistrationActionTitle(event, registration, registering);
  const showCancelAction = Boolean(activeRegistration && event.registrationMode === 'internal_free');
  const [imageFailed, setImageFailed] = useState(false);
  const showImage = Boolean(event.imageUrl && !imageFailed);

  useEffect(() => {
    setImageFailed(false);
  }, [event.imageUrl]);

  if (event.featured) {
    return (
      <GlassCard padded={false}>
        <Pressable onPress={() => onOpen(event)} style={({ pressed }) => [pressed && styles.pressed]}>
          <View style={styles.featuredImage}>
            {showImage ? (
              <Image
                source={{ uri: event.imageUrl ?? '' }}
                resizeMode="cover"
                style={styles.featuredPhoto}
                onError={() => setImageFailed(true)}
              />
            ) : (
              <LinearGradient
                colors={['rgba(240,122,42,0.28)', 'rgba(74,144,217,0.18)', '#141420']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.featuredPlaceholder}
              >
                <Text style={styles.featuredEmoji}>{event.imageIcon}</Text>
              </LinearGradient>
            )}
            <LinearGradient colors={['rgba(10,10,20,0.85)', 'transparent']} style={StyleSheet.absoluteFillObject} />
            <View style={styles.featuredBadgeRow}>
              <View style={[styles.tag, { backgroundColor: `${event.tagColor}DD` }]}>
                <Text style={styles.tagTextWhite}>{event.category}</Text>
              </View>
              <RegistrationModeBadge mode={event.registrationMode} />
              {event.visibility === 'members_only' ? (
                <View style={styles.visibilityBadge}>
                  <Text style={styles.visibilityBadgeText}>Для участников</Text>
                </View>
              ) : null}
            </View>
            <Text style={styles.siteText}>www.sredisvoih.com</Text>
          </View>

          <View style={styles.featuredBody}>
            <Text style={styles.featuredTitle}>{event.title}</Text>
            {event.date ? <Text style={styles.featuredDate}>{event.date}</Text> : null}
          </View>
        </Pressable>

        <View style={styles.featuredActions}>
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
        <Pressable onPress={() => onOpen(event)} style={({ pressed }) => [styles.eventImagePressable, pressed && styles.pressed]}>
          {showImage ? (
            <Image
              source={{ uri: event.imageUrl ?? '' }}
              resizeMode="cover"
              style={styles.eventPhoto}
              onError={() => setImageFailed(true)}
            />
          ) : (
            <LinearGradient colors={['#1a1440', '#0f0f1a']} style={styles.eventImage}>
              <Text style={styles.eventEmoji}>{event.imageIcon}</Text>
              <LinearGradient colors={['transparent', 'rgba(13,15,24,0.45)']} style={StyleSheet.absoluteFillObject} />
            </LinearGradient>
          )}
        </Pressable>

        <View style={styles.eventBody}>
          <Pressable onPress={() => onOpen(event)} style={({ pressed }) => [styles.eventTextPressable, pressed && styles.pressed]}>
            <View style={styles.cardBadgeRow}>
              <View style={[styles.tag, { backgroundColor: `${event.tagColor}22` }]}>
                <Text style={[styles.tagText, { color: event.tagColor }]}>{event.category}</Text>
              </View>
              {event.visibility === 'members_only' ? (
                <View style={styles.visibilityBadge}>
                  <Text style={styles.visibilityBadgeText}>Для участников</Text>
                </View>
              ) : null}
              <RegistrationModeBadge mode={event.registrationMode} />
            </View>

            <Text style={styles.eventTitle}>{event.title}</Text>

            {event.subtitle || event.shortDescription || event.date ? (
              <Text style={styles.eventSub}>{event.subtitle ?? event.shortDescription ?? event.date}</Text>
            ) : null}

            {event.date ? <Text style={styles.eventDate}>{event.date}</Text> : null}
          </Pressable>

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
  const router = useRouter();
  const [filter, setFilter] = useState<EventFilterId>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [timeFilter, setTimeFilter] = useState<EventTimeFilter>('Ближайшие');
  const [refreshing, setRefreshing] = useState(false);
  const {
    events,
    categories,
    activeOccurrencesByEventId,
    myRegistrations,
    loading,
    error,
    loadEvents,
  } = useEventsStore();
  const {
    cancellingRegistrationId,
    handleCancelRegistration,
    handleRegistrationAction,
    registeringEventId,
  } = useEventRegistrationAction();
  const authUser = useAuthStore((state) => state.user);
  const membership = useAuthStore((state) => state.membership);
  const loadSession = useAuthStore((state) => state.loadSession);

  useEffect(() => {
    void loadEvents();
  }, [authUser?.id, loadEvents, membership?.id, membership?.status]);

  useEffect(() => {
    void loadSession().catch(() => undefined);
  }, [loadSession]);

  const eventFilters = useMemo<EventFilterOption[]>(() => {
    const categoryChips: EventFilterOption[] = [...categories]
      .filter((category) => category.isActive)
      .sort((first, second) => {
        if (first.sortOrder !== second.sortOrder) {
          return first.sortOrder - second.sortOrder;
        }
        return first.title.localeCompare(second.title, 'ru');
      })
      .map((category) => ({
        id: `${CATEGORY_FILTER_PREFIX}${category.slug}` as EventFilterId,
        title: category.title,
      }));

    return [
      ...SPECIAL_FILTERS.map((option) => ({ id: option.id as EventFilterId, title: option.title })),
      ...categoryChips,
    ];
  }, [categories]);

  useEffect(() => {
    if (!eventFilters.some((option) => option.id === filter)) {
      setFilter('all');
    }
  }, [eventFilters, filter]);

  const normalizedSearch = useMemo(() => normalizeSearchQuery(searchQuery), [searchQuery]);
  const items = useMemo(() => {
    const now = Date.now();

    return markFirstEventFeatured(
      sortEventsByTime(
        events.filter((event) => (
          eventMatchesTimeFilter(event, timeFilter, activeOccurrencesByEventId[event.id], now)
          && eventMatchesFilter(event, filter)
          && eventMatchesSearch(event, normalizedSearch)
        )),
        timeFilter,
        activeOccurrencesByEventId,
        now,
      ),
    );
  }, [activeOccurrencesByEventId, events, filter, normalizedSearch, timeFilter]);

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

  const handleOpenEvent = useCallback((event: EventItem) => {
    router.push({ pathname: '/events/[id]', params: { id: event.id } });
  }, [router]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);

    try {
      await loadSession();
      await loadEvents();
    } catch {
      // The store keeps the visible error state.
    } finally {
      setRefreshing(false);
    }
  }, [loadEvents, loadSession]);

  const emptyStateText = useMemo(() => {
    if (filter === 'members_only' && (!authUser || membership?.status !== 'active')) {
      return 'Войдите и примите приглашение, чтобы видеть события для участников общины.';
    }

    if (events.length === 0) {
      return 'Событий пока нет. Когда появятся новые встречи, они будут здесь.';
    }

    if (normalizedSearch) {
      return 'По вашему запросу ничего не найдено.';
    }

    if (filter === 'all') {
      return timeFilter === 'Ближайшие'
        ? 'Ближайших событий пока нет.'
        : 'Прошедших событий пока нет.';
    }

    return 'Для выбранного фильтра пока нет событий.';
  }, [authUser, events.length, filter, membership?.status, normalizedSearch, timeFilter]);

  return (
    <Screen
      keyboardShouldPersistTaps="handled"
      refreshControl={(
        <RefreshControl
          refreshing={refreshing}
          onRefresh={handleRefresh}
          tintColor={colors.orange}
          colors={[colors.orange]}
        />
      )}
    >
      <View style={styles.header}>
        <Logo />
        <OmerPill />
      </View>

      <View style={styles.titleRow}>
        <View>
          <Text style={styles.title}>События</Text>
          <Text style={styles.subtitle}>Афиша мероприятий общины</Text>
        </View>
      </View>

      <View style={styles.searchBox}>
        <Ionicons name="search" size={18} color={colors.textDim} />
        <TextInput
          value={searchQuery}
          onChangeText={setSearchQuery}
          placeholder="Поиск по событиям"
          placeholderTextColor={colors.textGhost}
          autoCapitalize="none"
          autoCorrect={false}
          style={styles.searchInput}
        />
        {searchQuery ? (
          <Pressable
            onPress={() => setSearchQuery('')}
            style={({ pressed }) => [styles.clearSearchButton, pressed && styles.pressed]}
          >
            <Ionicons name="close-circle" size={18} color={colors.textDim} />
          </Pressable>
        ) : null}
      </View>

      <SegmentControl items={timeFilters} value={timeFilter} onChange={setTimeFilter} />

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.filterScroll}
        contentContainerStyle={styles.filterScrollContent}
      >
        {eventFilters.map((item) => (
          <EventFilterChip
            key={item.id}
            title={item.title}
            active={filter === item.id}
            onPress={() => setFilter(item.id)}
          />
        ))}
      </ScrollView>

      {loading && !refreshing ? <Text style={styles.stateText}>Загружаем события…</Text> : null}

      {error ? <Text style={styles.errorText}>{error}</Text> : null}

      {!loading && !error && items.length === 0 ? (
        <EmptyState text={emptyStateText} />
      ) : null}

      {items.map((event) => (
        <View key={event.id}>
          <EventCard
            event={event}
            registration={registrationByEventId.get(event.id) ?? null}
            registering={registeringEventId === event.id}
            cancelling={cancellingRegistrationId === registrationByEventId.get(event.id)?.id}
            onRegister={handleRegistrationAction}
            onCancel={handleCancelRegistration}
            onOpen={handleOpenEvent}
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
  searchBox: {
    minHeight: 46,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.glass.w08,
    backgroundColor: colors.glass.w07,
    paddingHorizontal: 12,
  },
  searchInput: {
    flex: 1,
    minHeight: 42,
    color: colors.text,
    fontSize: 14,
    paddingHorizontal: 0,
    paddingVertical: 0,
  },
  clearSearchButton: {
    width: 30,
    height: 30,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 15,
  },
  filterScroll: {
    marginHorizontal: -16,
  },
  filterScrollContent: {
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 2,
  },
  filterChip: {
    minHeight: 34,
    justifyContent: 'center',
    borderRadius: 17,
    borderWidth: 1,
    borderColor: colors.glass.w12,
    backgroundColor: colors.glass.w07,
    paddingHorizontal: 13,
    paddingVertical: 7,
  },
  filterChipActive: {
    borderColor: colors.accent.orangeBorder,
    backgroundColor: colors.accent.orangeBg,
  },
  filterChipText: {
    color: colors.textFaint,
    fontSize: 13,
    fontWeight: '600',
    includeFontPadding: false,
  },
  filterChipTextActive: {
    color: colors.text,
  },
  emptyState: {
    alignItems: 'center',
    gap: 8,
    paddingVertical: 2,
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
  featuredPhoto: {
    width: '100%',
    height: '100%',
  },
  featuredPlaceholder: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
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
  featuredBadgeRow: {
    position: 'absolute',
    top: 12,
    left: 12,
    right: 12,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 6,
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
  cardBadgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 6,
  },
  visibilityBadge: {
    alignSelf: 'flex-start',
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.accent.orangeBorder,
    backgroundColor: colors.accent.orangeBg,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  visibilityBadgeText: {
    color: colors.orange,
    fontSize: 11,
    fontWeight: '700',
    includeFontPadding: false,
  },
  modeBadge: {
    alignSelf: 'flex-start',
    borderRadius: 6,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  modeBadgeText: {
    color: colors.text,
    fontSize: 11,
    fontWeight: '700',
    includeFontPadding: false,
  },
  badgeExternal: {
    borderColor: colors.accent.blueBorder,
    backgroundColor: colors.accent.blueBg,
  },
  badgeFree: {
    borderColor: colors.accent.greenBorder,
    backgroundColor: colors.accent.greenBg,
  },
  badgePaid: {
    borderColor: colors.accent.goldBorder,
    backgroundColor: colors.accent.goldBg,
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
    paddingBottom: 10,
  },
  featuredActions: {
    paddingHorizontal: 16,
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
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  eventImage: {
    flex: 1,
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  eventImagePressable: {
    width: 100,
    height: 154,
    overflow: 'hidden',
    backgroundColor: '#141420',
  },
  eventPhoto: {
    width: '100%',
    height: '100%',
  },
  eventEmoji: {
    fontSize: 40,
    opacity: 0.55,
  },
  eventBody: {
    flex: 1,
    justifyContent: 'space-between',
    minHeight: 154,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  eventTextPressable: {
    flex: 1,
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
