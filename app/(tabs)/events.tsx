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
  getEffectiveEventEndsAt,
  getEffectiveEventStartsAt,
  getEventSortTime,
  isEventPast,
  parseEventTime,
} from '@/lib/eventTime';
import { useAuthStore } from '@/store/useAuthStore';
import {
  findActiveRegistrationForTarget,
  isActiveEventRegistration,
  useEventsStore,
} from '@/store/useEventsStore';
import { colors } from '@/theme/colors';
import type { EventItem, EventRegistration } from '@/types/event';

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

function eventMatchesTimeFilter(event: EventItem, filter: EventTimeFilter, now: number): boolean {
  const past = isEventPast(event, null, now);

  if (filter === 'Прошедшие') {
    return past;
  }

  const hasAnyTime = parseEventTime(getEffectiveEventStartsAt(event)) !== null
    || parseEventTime(getEffectiveEventEndsAt(event)) !== null;

  if (!hasAnyTime && event.isPermanent !== true) {
    return false;
  }

  return !past;
}

function sortEventsByTime(events: EventItem[], filter: EventTimeFilter): EventItem[] {
  return [...events].sort((first, second) => {
    const firstTime = getEventSortTime(first);
    const secondTime = getEventSortTime(second);

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

function getRegistrationForEventTarget(
  registrations: EventRegistration[],
  event: EventItem,
): EventRegistration | null {
  const occurrenceId = event.nextOccurrence?.id ?? null;

  return occurrenceId
    ? findActiveRegistrationForTarget(registrations, event.id, occurrenceId)
    : findActiveRegistrationForTarget(registrations, event.id);
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
  const descriptionText = event.subtitle ?? event.shortDescription ?? null;

  useEffect(() => {
    setImageFailed(false);
  }, [event.imageUrl]);

  const badges = (
    <View style={styles.cardBadgeRow}>
      <View
        style={[
          styles.tag,
          { backgroundColor: `${event.tagColor}20`, borderColor: `${event.tagColor}55` },
        ]}
      >
        <Text style={[styles.tagText, { color: event.tagColor }]}>{event.category}</Text>
      </View>
      {event.visibility === 'members_only' ? (
        <View style={styles.visibilityBadge}>
          <Text style={styles.visibilityBadgeText}>Для участников</Text>
        </View>
      ) : null}
      <RegistrationModeBadge mode={event.registrationMode} />
    </View>
  );

  return (
    <GlassCard padded={false}>
      <View style={styles.cardContent}>
        <Pressable
          onPress={() => onOpen(event)}
          style={({ pressed }) => [styles.posterPressable, pressed && styles.pressed]}
        >
          <LinearGradient
            colors={['rgba(255,255,255,0.08)', 'rgba(240,122,42,0.08)', 'rgba(9,11,20,0.98)']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.posterFrame}
          >
            <LinearGradient
              colors={['rgba(255,200,50,0.10)', 'transparent', 'rgba(0,0,0,0.24)']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={StyleSheet.absoluteFillObject}
            />
            {showImage ? (
              <Image
                source={{ uri: event.imageUrl ?? '' }}
                resizeMode="contain"
                style={styles.posterPhoto}
                onError={() => setImageFailed(true)}
              />
            ) : (
              <View style={styles.posterFallback}>
                <Text style={styles.posterEmoji}>{event.imageIcon}</Text>
              </View>
            )}
          </LinearGradient>
        </Pressable>

        <Pressable
          onPress={() => onOpen(event)}
          style={({ pressed }) => [
            event.featured ? styles.featuredBody : styles.eventBody,
            pressed && styles.pressed,
          ]}
        >
          {badges}

          <Text style={event.featured ? styles.featuredTitle : styles.eventTitle}>
            {event.title}
          </Text>

          {descriptionText ? (
            <Text style={event.featured ? styles.featuredSub : styles.eventSub}>
              {descriptionText}
            </Text>
          ) : null}

          {event.date ? (
            <Text style={event.featured ? styles.featuredDate : styles.eventDate}>
              {event.date}
            </Text>
          ) : null}
        </Pressable>

        <View style={event.featured ? styles.featuredActions : styles.eventActions}>
          <PrimaryButton
            title={buttonTitle}
            disabled={registering || cancelling}
            onPress={() => onRegister(event, registration)}
            style={styles.actionButton}
            buttonStyle={styles.actionButtonGradient}
            textNumberOfLines={2}
          />
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
          eventMatchesTimeFilter(event, timeFilter, now)
          && eventMatchesFilter(event, filter)
          && eventMatchesSearch(event, normalizedSearch)
        )),
        timeFilter,
      ),
    );
  }, [events, filter, normalizedSearch, timeFilter]);

  const registrationByEventTarget = useMemo(() => {
    const registrationMap = new Map<string, EventRegistration | null>();

    items.forEach((event) => {
      registrationMap.set(event.id, getRegistrationForEventTarget(myRegistrations, event));
    });

    return registrationMap;
  }, [items, myRegistrations]);

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
            registration={registrationByEventTarget.get(event.id) ?? null}
            registering={registeringEventId === event.id}
            cancelling={cancellingRegistrationId === registrationByEventTarget.get(event.id)?.id}
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
  cardContent: {
    gap: 12,
    padding: 12,
  },
  posterPressable: {
    width: '100%',
    borderRadius: 18,
  },
  posterFrame: {
    width: '100%',
    aspectRatio: 1,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.glass.w12,
    backgroundColor: '#10121c',
  },
  posterPhoto: {
    width: '100%',
    height: '100%',
  },
  posterFallback: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  posterEmoji: {
    fontSize: 58,
    opacity: 0.48,
  },
  tag: {
    alignSelf: 'flex-start',
    borderRadius: 6,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 3,
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
  featuredBody: {
    gap: 8,
    paddingHorizontal: 4,
  },
  featuredActions: {
    gap: 8,
    paddingTop: 2,
  },
  featuredTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '700',
    lineHeight: 24,
  },
  featuredSub: {
    color: colors.textMuted,
    fontSize: 13,
    lineHeight: 18,
  },
  featuredDate: {
    color: colors.textDim,
    fontSize: 12,
  },
  eventBody: {
    gap: 7,
    paddingHorizontal: 2,
  },
  eventTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '700',
    lineHeight: 20,
  },
  eventSub: {
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 17,
  },
  eventDate: {
    color: colors.textDim,
    fontSize: 12,
  },
  eventActions: {
    gap: 8,
    paddingTop: 2,
  },
  actionButton: {
    width: '100%',
  },
  actionButtonGradient: {
    width: '100%',
    minHeight: 42,
    borderRadius: 14,
  },
  cancelAction: {
    alignSelf: 'center',
    minHeight: 34,
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  cancelActionPressed: {
    opacity: 0.72,
  },
  cancelActionText: {
    color: colors.textDim,
    fontSize: 13,
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
