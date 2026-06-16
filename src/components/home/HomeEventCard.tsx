import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';

import { GlassCard } from '@/components/glass/GlassCard';
import { PrimaryButton } from '@/components/ui/PrimaryButton';
import { formatRuDayMonth, formatRuTime } from '@/lib/dates';
import { getEffectiveEventStartsAt } from '@/lib/eventTime';
import { colors } from '@/theme/colors';
import type { EventItem } from '@/types/event';

type HomeEventCardProps = {
  error?: string | null;
  event: EventItem | null;
  loading?: boolean;
  onPress: (eventId: string) => void;
};

function getActionTitle(event: EventItem): string {
  return event.registrationMode === 'none' ? 'Подробнее →' : 'Записаться →';
}

function formatEventDateTime(event: EventItem): string {
  const startsAt = getEffectiveEventStartsAt(event);

  if (!startsAt) {
    return event.date ?? 'Дата уточняется';
  }

  const date = new Date(startsAt);

  if (Number.isNaN(date.getTime())) {
    return event.date ?? 'Дата уточняется';
  }

  return `${formatRuDayMonth(date, event.timezone ?? undefined)}, ${formatRuTime(date, event.timezone ?? undefined)}`;
}

function FallbackVisual() {
  return (
    <LinearGradient colors={['#22233a', '#101119']} style={styles.eventImage}>
      <View style={styles.personLeft} />
      <View style={styles.personHeadLeft} />
      <View style={styles.personRight} />
      <View style={styles.personHeadRight} />
      <LinearGradient colors={['transparent', 'rgba(13,15,24,0.72)']} style={styles.eventImageShade} />
    </LinearGradient>
  );
}

function HomeEventStateCard({
  icon,
  text,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  text: string;
}) {
  return (
    <GlassCard>
      <View style={styles.stateContent}>
        <Ionicons name={icon} size={22} color={colors.textDim} />
        <Text style={styles.stateText}>{text}</Text>
      </View>
    </GlassCard>
  );
}

export function HomeEventCard({
  error,
  event,
  loading = false,
  onPress,
}: HomeEventCardProps) {
  const [imageFailed, setImageFailed] = useState(false);
  const showImage = Boolean(event?.imageUrl && !imageFailed);

  useEffect(() => {
    setImageFailed(false);
  }, [event?.imageUrl]);

  if (event) {
    const handlePress = () => onPress(event.id);

    return (
      <Pressable onPress={handlePress} style={({ pressed }) => pressed && styles.pressed}>
        <GlassCard padded={false}>
          <View style={styles.eventCard}>
            {showImage ? (
              <View style={styles.eventImage}>
                <Image
                  source={{ uri: event.imageUrl ?? '' }}
                  resizeMode="cover"
                  style={styles.eventPhoto}
                  onError={() => setImageFailed(true)}
                />
                <LinearGradient colors={['transparent', 'rgba(13,15,24,0.72)']} style={styles.eventImageShade} />
              </View>
            ) : (
              <FallbackVisual />
            )}

            <View style={styles.eventBody}>
              <View>
                <View style={styles.dateRow}>
                  <Ionicons name="calendar-outline" size={11} color={colors.textDim} />
                  <Text numberOfLines={1} style={styles.eventMeta}>
                    {formatEventDateTime(event)}
                  </Text>
                </View>
                <Text numberOfLines={2} style={styles.eventTitle}>
                  {event.title}
                </Text>
              </View>

              <PrimaryButton
                title={getActionTitle(event)}
                onPress={handlePress}
                buttonStyle={styles.eventButton}
              />
            </View>
          </View>
        </GlassCard>
      </Pressable>
    );
  }

  if (loading) {
    return <HomeEventStateCard icon="calendar-outline" text="Загружаем ближайшее событие…" />;
  }

  if (error) {
    return <HomeEventStateCard icon="alert-circle-outline" text="Не удалось загрузить ближайшее событие." />;
  }

  return <HomeEventStateCard icon="calendar-clear-outline" text="Ближайших событий пока нет." />;
}

const HOME_EVENT_CARD_HEIGHT = 160;
const HOME_EVENT_IMAGE_WIDTH = 138;

const styles = StyleSheet.create({
  eventCard: {
    height: HOME_EVENT_CARD_HEIGHT,
    flexDirection: 'row',
    alignItems: 'stretch',
  },
  eventImage: {
    width: HOME_EVENT_IMAGE_WIDTH,
    height: HOME_EVENT_CARD_HEIGHT,
    position: 'relative',
    overflow: 'hidden',
  },
  eventPhoto: {
    ...StyleSheet.absoluteFillObject,
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
    width: 0,
    flexGrow: 1,
    flexShrink: 1,
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
  pressed: {
    opacity: 0.86,
  },
  stateContent: {
    alignItems: 'center',
    gap: 8,
    paddingVertical: 6,
  },
  stateText: {
    color: colors.textDim,
    fontSize: 13,
    lineHeight: 18,
    textAlign: 'center',
  },
});
