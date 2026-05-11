import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GlassCard } from '@/components/glass/GlassCard';
import { PrimaryButton } from '@/components/ui/PrimaryButton';
import { Screen } from '@/components/ui/Screen';
import {
  getOccurrenceRegistrationState,
  getOccurrenceRegistrationStateLabel,
  type OccurrenceRegistrationState,
} from '@/lib/eventTime';
import { listEventOccurrences } from '@/services/eventOccurrencesService';
import { useEventsStore } from '@/store/useEventsStore';
import { colors } from '@/theme/colors';
import type { EventItem } from '@/types/event';
import type { EventOccurrence } from '@/types/eventOccurrence';

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function formatDate(value: string, timeZone?: string | null, includeYear = true): string {
  const options: Intl.DateTimeFormatOptions = {
    day: 'numeric',
    month: 'long',
  };

  if (includeYear) {
    options.year = 'numeric';
  }

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

function formatTime(value: string, timeZone?: string | null): string {
  const options: Intl.DateTimeFormatOptions = {
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

function formatDateTime(value: string, timeZone?: string | null): string {
  const options: Intl.DateTimeFormatOptions = {
    day: 'numeric',
    month: 'long',
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

function formatRegistrationWindowDetail(occurrence: EventOccurrence): string | null {
  const opens = occurrence.registrationOpensAt
    ? formatDateTime(occurrence.registrationOpensAt, occurrence.timezone)
    : null;
  const closes = occurrence.registrationClosesAt
    ? formatDateTime(occurrence.registrationClosesAt, occurrence.timezone)
    : null;

  if (opens && closes) {
    return `Регистрация: ${opens} – ${closes}`;
  }
  if (opens) {
    return `Регистрация открывается ${opens}`;
  }
  if (closes) {
    return `Регистрация закрывается ${closes}`;
  }
  return null;
}

function getPlace(event: EventItem): string {
  if (event.locationName && event.address) {
    return `${event.locationName}, ${event.address}`;
  }

  return event.locationName ?? event.address ?? 'Место уточняется';
}

function formatSelectedOccurrence(occurrence: EventOccurrence): string {
  return `${formatDate(occurrence.startsAt, occurrence.timezone, false)}, ${formatTime(
    occurrence.startsAt,
    occurrence.timezone,
  )}`;
}

type ChipProps = {
  children: string;
};

function Chip({ children }: ChipProps) {
  return (
    <View style={styles.chip}>
      <Text style={styles.chipText}>{children}</Text>
    </View>
  );
}

type OccurrenceCardProps = {
  disabled: boolean;
  eventTitle: string;
  occurrence: EventOccurrence;
  registrationState: OccurrenceRegistrationState;
  selected: boolean;
  onPress: () => void;
};

function OccurrenceCard({
  disabled,
  eventTitle,
  occurrence,
  onPress,
  registrationState,
  selected,
}: OccurrenceCardProps) {
  const stateLabel = getOccurrenceRegistrationStateLabel(registrationState);
  const windowDetail = formatRegistrationWindowDetail(occurrence);
  const badgeStyle =
    registrationState === 'open' || registrationState === 'always_open'
      ? styles.stateBadgeOpen
      : registrationState === 'past'
        ? styles.stateBadgePast
        : styles.stateBadgeMuted;

  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.occurrenceCard,
        selected && styles.occurrenceCardSelected,
        disabled && styles.occurrenceCardDisabled,
        pressed && !disabled && styles.pressed,
      ]}
    >
      <View style={styles.occurrenceContent}>
        <Text style={styles.occurrenceDate}>
          {formatDate(occurrence.startsAt, occurrence.timezone)}
        </Text>
        <Text style={styles.occurrenceTime}>
          {formatTime(occurrence.startsAt, occurrence.timezone)}
        </Text>
        <Text style={styles.occurrenceTitle}>
          {occurrence.title?.trim() || eventTitle}
        </Text>
        <View style={styles.occurrenceMetaRow}>
          <View style={[styles.stateBadge, badgeStyle]}>
            <Text style={styles.stateBadgeText}>{stateLabel}</Text>
          </View>
          {windowDetail ? <Text style={styles.windowText}>{windowDetail}</Text> : null}
        </View>
      </View>
      <View style={[styles.radio, selected && styles.radioSelected, disabled && styles.radioDisabled]}>
        {selected && !disabled ? <View style={styles.radioDot} /> : null}
      </View>
    </Pressable>
  );
}

export default function PaidOccurrencesScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ eventId?: string | string[] }>();
  const eventId = firstParam(params.eventId);
  const loadEventById = useEventsStore((state) => state.loadEventById);
  const [event, setEvent] = useState<EventItem | null>(null);
  const [occurrences, setOccurrences] = useState<EventOccurrence[]>([]);
  const [selectedOccurrenceId, setSelectedOccurrenceId] = useState<string | null>(null);
  const [heroImageFailed, setHeroImageFailed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const selectedOccurrence = useMemo(
    () => occurrences.find((occurrence) => occurrence.id === selectedOccurrenceId) ?? null,
    [occurrences, selectedOccurrenceId],
  );

  const loadData = useCallback(async () => {
    if (!eventId) {
      setEvent(null);
      setOccurrences([]);
      setError('Событие не найдено');
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const [loadedEvent, loadedOccurrences] = await Promise.all([
        loadEventById(eventId),
        listEventOccurrences(eventId),
      ]);

      if (!loadedEvent) {
        throw new Error('Событие не найдено');
      }

      setEvent(loadedEvent);
      setOccurrences(loadedOccurrences);
      setSelectedOccurrenceId((current) => (
        current && loadedOccurrences.some((occurrence) => occurrence.id === current)
          ? current
          : null
      ));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Не удалось загрузить даты события');
    } finally {
      setLoading(false);
    }
  }, [eventId, loadEventById]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    setHeroImageFailed(false);
  }, [event?.imageUrl]);

  const handleBack = useCallback(() => {
    if (router.canGoBack()) {
      router.back();
      return;
    }

    if (eventId) {
      router.push({ pathname: '/events/[id]', params: { id: eventId } });
      return;
    }

    router.push('/events');
  }, [eventId, router]);

  const openOptions = useCallback((occurrenceId?: string) => {
    if (!eventId) {
      return;
    }

    router.push({
      pathname: '/events/paid-options',
      params: occurrenceId ? { eventId, occurrenceId } : { eventId },
    });
  }, [eventId, router]);

  const showHeroImage = Boolean(event?.imageUrl && !heroImageFailed);
  const bottomOffset = Math.max(insets.bottom, Platform.OS === 'ios' ? 16 : 12);

  return (
    <View style={styles.root}>
      <Stack.Screen options={{ headerShown: false }} />
      <Screen contentContainerStyle={styles.content}>
        <Pressable onPress={handleBack} style={styles.backButton}>
          <Ionicons name="chevron-back" size={22} color={colors.orange} />
          <Text style={styles.backText}>Назад</Text>
        </Pressable>

        {loading ? (
          <GlassCard>
            <View style={styles.stateCard}>
              <ActivityIndicator color={colors.orange} />
              <Text style={styles.stateText}>Загружаем даты события...</Text>
            </View>
          </GlassCard>
        ) : null}

        {!loading && error ? (
          <GlassCard>
            <View style={styles.stateCard}>
              <Ionicons name="alert-circle-outline" size={24} color={colors.danger} />
              <Text style={styles.errorText}>{error}</Text>
              <PrimaryButton title="Повторить" onPress={loadData} />
            </View>
          </GlassCard>
        ) : null}

        {!loading && !error && event ? (
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
                colors={['transparent', 'rgba(6,8,16,0.94)']}
                style={StyleSheet.absoluteFillObject}
              />
              <View style={styles.heroChips}>
                <Chip>{event.category}</Chip>
              </View>
            </View>

            <View style={styles.titleBlock}>
              <Text style={styles.title}>{event.title}</Text>
              {event.subtitle ? <Text style={styles.subtitle}>{event.subtitle}</Text> : null}
            </View>

            <GlassCard>
              <View style={styles.infoRow}>
                <View style={styles.infoIcon}>
                  <Ionicons name="repeat-outline" size={18} color={colors.orange} />
                </View>
                <View style={styles.infoTextBlock}>
                  <Text style={styles.infoTitle}>Цикл встреч</Text>
                  <Text style={styles.infoText}>{getPlace(event)}</Text>
                </View>
              </View>
            </GlassCard>

            <View style={styles.sectionIntro}>
              <Text style={styles.sectionTitle}>Выберите дату</Text>
              <Text style={styles.helperText}>
                Сначала выберите конкретную встречу, затем формат участия.
              </Text>
            </View>

            {occurrences.length === 0 ? (
              <GlassCard>
                <View style={styles.stateCard}>
                  <Ionicons name="calendar-clear-outline" size={24} color={colors.textDim} />
                  <Text style={styles.emptyTitle}>Даты пока не добавлены</Text>
                  <Text style={styles.stateText}>
                    Можно перейти к вариантам участия на уровне события.
                  </Text>
                  <PrimaryButton
                    title="Перейти к вариантам участия"
                    onPress={() => openOptions()}
                    buttonStyle={styles.emptyButton}
                  />
                </View>
              </GlassCard>
            ) : (
              <View style={styles.occurrencesList}>
                {occurrences.map((occurrence) => {
                  const state = getOccurrenceRegistrationState(
                    occurrence,
                    Date.now(),
                    event.registrationMode,
                  );
                  const selectable = state === 'open' || state === 'always_open';
                  return (
                    <OccurrenceCard
                      key={occurrence.id}
                      disabled={!selectable}
                      eventTitle={event.title}
                      occurrence={occurrence}
                      registrationState={state}
                      selected={occurrence.id === selectedOccurrenceId}
                      onPress={() => setSelectedOccurrenceId(occurrence.id)}
                    />
                  );
                })}
              </View>
            )}
          </>
        ) : null}
      </Screen>

      {!loading && !error && event && occurrences.length > 0 ? (
        <View pointerEvents="box-none" style={[styles.stickyWrap, { bottom: bottomOffset }]}>
          <GlassCard style={styles.stickyCard} contentStyle={styles.stickyContent}>
            <View style={styles.selectedSummary}>
              <Ionicons name="calendar-outline" size={20} color={colors.orange} />
              <View style={styles.selectedTextBlock}>
                <Text style={styles.selectedLabel}>Выбрано</Text>
                <Text numberOfLines={1} style={styles.selectedText}>
                  {selectedOccurrence ? formatSelectedOccurrence(selectedOccurrence) : 'Выберите дату'}
                </Text>
              </View>
            </View>
            <PrimaryButton
              title="Продолжить"
              disabled={!selectedOccurrence}
              onPress={() => selectedOccurrence && openOptions(selectedOccurrence.id)}
              buttonStyle={styles.stickyButton}
            />
          </GlassCard>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  content: {
    gap: 14,
    paddingBottom: 150,
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
    borderColor: colors.glass.w16,
    backgroundColor: colors.glass.w10,
    paddingHorizontal: 9,
    paddingVertical: 4,
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
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  infoIcon: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accent.orangeBg,
    borderWidth: 1,
    borderColor: colors.accent.orangeBorder,
  },
  infoTextBlock: {
    flex: 1,
    gap: 3,
  },
  infoTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '700',
  },
  infoText: {
    color: colors.textMuted,
    fontSize: 13,
    lineHeight: 18,
  },
  sectionIntro: {
    gap: 6,
    marginTop: 2,
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 20,
    fontWeight: '800',
    letterSpacing: 0,
  },
  helperText: {
    color: colors.textMuted,
    fontSize: 14,
    lineHeight: 20,
  },
  occurrencesList: {
    gap: 10,
  },
  occurrenceCard: {
    minHeight: 136,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.glass.w06,
    padding: 16,
  },
  occurrenceCardSelected: {
    borderColor: colors.accent.orangeBorder,
    backgroundColor: colors.accent.orangeBg,
    shadowColor: colors.orange,
    shadowOpacity: 0.28,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
  },
  occurrenceCardDisabled: {
    opacity: 0.55,
  },
  pressed: {
    opacity: 0.84,
  },
  occurrenceContent: {
    flex: 1,
    gap: 5,
  },
  occurrenceDate: {
    color: colors.text,
    fontSize: 17,
    fontWeight: '800',
    lineHeight: 22,
  },
  occurrenceTime: {
    color: colors.orange,
    fontSize: 16,
    fontWeight: '800',
    lineHeight: 21,
  },
  occurrenceTitle: {
    color: colors.textSecondary,
    fontSize: 14,
    lineHeight: 20,
  },
  occurrenceMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 4,
  },
  stateBadge: {
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  stateBadgeOpen: {
    borderColor: colors.accent.greenBorder,
    backgroundColor: colors.accent.greenBg,
  },
  stateBadgeMuted: {
    borderColor: colors.glass.w16,
    backgroundColor: colors.glass.w10,
  },
  stateBadgePast: {
    borderColor: colors.accent.redBorder,
    backgroundColor: colors.accent.redBg,
  },
  stateBadgeText: {
    color: colors.text,
    fontSize: 11,
    fontWeight: '700',
    includeFontPadding: false,
  },
  windowText: {
    flexShrink: 1,
    color: colors.textDim,
    fontSize: 12,
    lineHeight: 17,
  },
  radio: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: colors.glass.w35,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioSelected: {
    borderColor: colors.orange,
    backgroundColor: colors.accent.orangeBg,
  },
  radioDisabled: {
    opacity: 0.4,
  },
  radioDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.orange,
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
  emptyTitle: {
    color: colors.text,
    fontSize: 17,
    fontWeight: '800',
    textAlign: 'center',
  },
  emptyButton: {
    marginTop: 4,
  },
  errorText: {
    color: colors.danger,
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
  },
  stickyWrap: {
    position: 'absolute',
    left: 12,
    right: 12,
  },
  stickyCard: {
    shadowColor: '#000',
    shadowOpacity: 0.28,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 10 },
  },
  stickyContent: {
    minHeight: 72,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
  },
  selectedSummary: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  selectedTextBlock: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  selectedLabel: {
    color: colors.textDim,
    fontSize: 12,
    fontWeight: '600',
  },
  selectedText: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '800',
  },
  stickyButton: {
    minWidth: 128,
  },
});
