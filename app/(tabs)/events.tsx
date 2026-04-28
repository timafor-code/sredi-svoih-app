import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { GlassCard } from '@/components/glass/GlassCard';
import { HeaderButton, Logo, OmerPill } from '@/components/ui/BrandHeader';
import { PrimaryButton } from '@/components/ui/PrimaryButton';
import { Screen } from '@/components/ui/Screen';
import { SegmentControl } from '@/components/ui/SegmentControl';
import { useEventsStore } from '@/store/useEventsStore';
import { colors } from '@/theme/colors';
import type { EventItem } from '@/types/event';

const filters = ['Все', 'Курсы', 'Праздники'] as const;

function eventMatchesFilter(event: EventItem, filter: (typeof filters)[number]) {
  if (filter === 'Все') return true;
  if (filter === 'Курсы') return event.category === 'Курс';
  return event.category === 'Праздник';
}

function EventCard({ event }: { event: EventItem }) {
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
          <PrimaryButton title="Хочу пойти →" />
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

          <PrimaryButton title="Хочу пойти →" buttonStyle={styles.smallButton} textStyle={styles.smallButtonText} />
        </View>
      </View>
    </GlassCard>
  );
}

export default function EventsScreen() {
  const [filter, setFilter] = useState<(typeof filters)[number]>('Все');
  const { events, loading, error, loadEvents } = useEventsStore();

  useEffect(() => {
    void loadEvents();
  }, [loadEvents]);

  const items = useMemo(() => events.filter((event) => eventMatchesFilter(event, filter)), [events, filter]);

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
          <EventCard event={event} />
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
    letterSpacing: -0.5,
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