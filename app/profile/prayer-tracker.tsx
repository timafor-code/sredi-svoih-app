import { Ionicons } from '@expo/vector-icons';
import { Stack, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
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
import { usePrayerTrackerStore } from '@/store/usePrayerTrackerStore';
import { colors } from '@/theme/colors';
import type { PrayerActivityLog, PrayerActivityType } from '@/types/prayerTracker';

const ACTIVITY_LABELS: Record<PrayerActivityType, string> = {
  shacharit: 'Шахарит',
  mincha: 'Минха',
  maariv: 'Маарив',
  shema_morning: 'Утреннее Шма',
  shema_evening: 'Вечернее Шма',
  omer_count: 'Омер',
};

const ACTIVITY_ICONS: Record<PrayerActivityType, keyof typeof Ionicons.glyphMap> = {
  shacharit: 'sunny-outline',
  mincha: 'partly-sunny-outline',
  maariv: 'moon-outline',
  shema_morning: 'volume-medium-outline',
  shema_evening: 'volume-low-outline',
  omer_count: 'calendar-number-outline',
};

type ActivityGroup = {
  date: string;
  items: PrayerActivityLog[];
};

function parseDateParts(value: string): Date | null {
  const [year, month, day] = value.split('-').map(Number);

  if (!year || !month || !day) {
    return null;
  }

  return new Date(year, month - 1, day);
}

function formatActivityDate(value: string): string {
  const date = parseDateParts(value);

  if (!date || Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'long',
    weekday: 'long',
  }).format(date);
}

function formatGregorianShortDate(value: string): string {
  const date = parseDateParts(value);

  if (!date || Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(date);
}

function formatTime(value: string, timezone: string): string {
  const options: Intl.DateTimeFormatOptions = {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: timezone,
  };

  try {
    return new Intl.DateTimeFormat('ru-RU', options).format(new Date(value));
  } catch {
    delete options.timeZone;
    return new Intl.DateTimeFormat('ru-RU', options).format(new Date(value));
  }
}

function getActivityTimeLabel(item: PrayerActivityLog): string {
  if (item.startedAt && item.completedAt) {
    return `${formatTime(item.startedAt, item.timezone)} - ${formatTime(item.completedAt, item.timezone)}`;
  }

  if (item.startedAt) {
    return `Начато в ${formatTime(item.startedAt, item.timezone)}`;
  }

  if (item.completedAt) {
    return `Завершено в ${formatTime(item.completedAt, item.timezone)}`;
  }

  return 'Время не указано';
}

function getHebrewDateLabel(item: PrayerActivityLog): string | null {
  const directLabel = [
    item.hebrewDate.label,
    item.hebrewDate.hebrew,
    item.hebrewDate.hebrewDate,
    item.hebrewDate.formatted,
    item.hebrewDate.text,
  ].find((value) => typeof value === 'string' && value.trim().length > 0);

  if (typeof directLabel === 'string') {
    return directLabel;
  }

  const day = item.hebrewDate.day;
  const month = item.hebrewDate.monthName ?? item.hebrewDate.month;
  const year = item.hebrewDate.year;

  if (day && month && year) {
    return `${day} ${month} ${year}`;
  }

  return null;
}

function getPlaceLabel(item: PrayerActivityLog): string | null {
  const parts = [item.city, item.timezone].filter(Boolean);

  return parts.length > 0 ? parts.join(', ') : null;
}

function getFirstStringValue(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
  }

  return null;
}

function getFirstNumberValue(...values: unknown[]): number | null {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return Math.trunc(value);
    }

    if (typeof value === 'string' && value.trim().length > 0) {
      const parsed = Number.parseInt(value, 10);

      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
  }

  return null;
}

function getOmerDay(item: PrayerActivityLog): number | null {
  return getFirstNumberValue(item.metadata.omerDay, item.hebrewDate.omerDay);
}

function getOmerSefirahRu(item: PrayerActivityLog): string | null {
  return getFirstStringValue(item.metadata.sefirahRu, item.hebrewDate.sefirahRu);
}

function getOmerSefirahHe(item: PrayerActivityLog): string | null {
  return getFirstStringValue(item.metadata.sefirahHe, item.hebrewDate.sefirahHe);
}

function getOmerDayHe(item: PrayerActivityLog): string | null {
  return getFirstStringValue(item.metadata.dayHe, item.hebrewDate.dayHe);
}

function getActivityTitle(item: PrayerActivityLog): string {
  if (item.activityType !== 'omer_count') {
    return ACTIVITY_LABELS[item.activityType];
  }

  const omerDay = getOmerDay(item);

  return omerDay ? `Омер · день ${omerDay}` : ACTIVITY_LABELS.omer_count;
}

function getActivityDetails(item: PrayerActivityLog): string | null {
  if (item.activityType !== 'omer_count') {
    return null;
  }

  const sefirahRu = getOmerSefirahRu(item);
  const sefirahHe = getOmerSefirahHe(item);

  if (sefirahRu && sefirahHe) {
    return `${sefirahRu} · ${sefirahHe}`;
  }

  return sefirahRu ?? sefirahHe ?? getOmerDayHe(item);
}

function groupActivities(items: PrayerActivityLog[]): ActivityGroup[] {
  const groups = new Map<string, PrayerActivityLog[]>();

  items.forEach((item) => {
    const group = groups.get(item.activityDate) ?? [];

    group.push(item);
    groups.set(item.activityDate, group);
  });

  return Array.from(groups.entries()).map(([date, groupItems]) => ({
    date,
    items: groupItems,
  }));
}

function ActivityCard({ item }: { item: PrayerActivityLog }) {
  const gregorianDateLabel = formatGregorianShortDate(item.activityDate);
  const hebrewDateLabel = getHebrewDateLabel(item);
  const dateLabel = hebrewDateLabel ? `${gregorianDateLabel} · ${hebrewDateLabel}` : gregorianDateLabel;
  const placeLabel = getPlaceLabel(item);
  const activityDetails = getActivityDetails(item);

  return (
    <GlassCard style={styles.activityCard}>
      <View style={styles.activityHeader}>
        <View style={styles.activityIcon}>
          <Ionicons name={ACTIVITY_ICONS[item.activityType]} size={19} color={colors.orange} />
        </View>
        <View style={styles.activityTitleBlock}>
          <Text style={styles.activityTitle}>{getActivityTitle(item)}</Text>
          <Text style={styles.activityTime}>{getActivityTimeLabel(item)}</Text>
        </View>
      </View>

      {activityDetails || dateLabel || placeLabel ? (
        <View style={styles.metaBlock}>
          {activityDetails ? (
            <View style={styles.metaRow}>
              <Ionicons name="calendar-number-outline" size={15} color={colors.textDim} />
              <Text style={styles.metaText}>{activityDetails}</Text>
            </View>
          ) : null}
          {dateLabel ? (
            <View style={styles.metaRow}>
              <Ionicons name="calendar-outline" size={15} color={colors.textDim} />
              <Text style={styles.metaText}>{dateLabel}</Text>
            </View>
          ) : null}
          {placeLabel ? (
            <View style={styles.metaRow}>
              <Ionicons name="location-outline" size={15} color={colors.textDim} />
              <Text style={styles.metaText}>{placeLabel}</Text>
            </View>
          ) : null}
        </View>
      ) : null}
    </GlassCard>
  );
}

export default function PrayerTrackerScreen() {
  const authUser = useAuthStore((state) => state.user);
  const loadSession = useAuthStore((state) => state.loadSession);
  const items = usePrayerTrackerStore((state) => state.items);
  const loading = usePrayerTrackerStore((state) => state.loading);
  const error = usePrayerTrackerStore((state) => state.error);
  const loadMyActivity = usePrayerTrackerStore((state) => state.loadMyActivity);
  const resetPrayerTracker = usePrayerTrackerStore((state) => state.reset);
  const [refreshing, setRefreshing] = useState(false);

  useFocusEffect(
    useCallback(() => {
      void loadSession().catch(() => undefined);
    }, [loadSession]),
  );

  useFocusEffect(
    useCallback(() => {
      if (!authUser) {
        resetPrayerTracker();
        return undefined;
      }

      void loadMyActivity({ limit: 100 }).catch(() => undefined);

      return undefined;
    }, [authUser, loadMyActivity, resetPrayerTracker]),
  );

  const groups = useMemo(() => groupActivities(items), [items]);

  const handleRefresh = useCallback(async () => {
    if (!authUser) {
      return;
    }

    setRefreshing(true);

    try {
      await loadMyActivity({ limit: 100 });
    } catch {
      // The store keeps the visible error message.
    } finally {
      setRefreshing(false);
    }
  }, [authUser, loadMyActivity]);

  const showInitialLoading = Boolean(authUser && loading && items.length === 0);
  const showBlockingError = Boolean(authUser && error && !loading && items.length === 0);
  const showInlineError = Boolean(authUser && error && !loading && items.length > 0);
  const showEmpty = Boolean(authUser && !loading && !error && items.length === 0);

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
        <SubHeader
          title="Молитвенный трекер"
          subtitle="Ваша личная история молитв, Шма и счёта Омера."
        />

        {!authUser ? (
          <GlassCard>
            <View style={styles.stateCard}>
              <Ionicons name="lock-closed-outline" size={24} color={colors.textDim} />
              <Text style={styles.stateTitle}>
                Войдите, чтобы вести личную историю молитв, Шма и Омера.
              </Text>
            </View>
          </GlassCard>
        ) : null}

        {showInitialLoading ? (
          <GlassCard>
            <View style={styles.stateCard}>
              <ActivityIndicator color={colors.orange} />
              <Text style={styles.stateText}>Загружаем историю...</Text>
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
              <Ionicons name="book-outline" size={24} color={colors.textDim} />
              <Text style={styles.stateTitle}>История молитв пока пустая.</Text>
              <Text style={styles.stateText}>
                Скоро действия на экранах молитв, Шма и Омера начнут появляться здесь.
              </Text>
            </View>
          </GlassCard>
        ) : null}

        {authUser && !showInitialLoading && !showBlockingError && groups.length > 0 ? (
          <View style={styles.historyList}>
            {groups.map((group) => (
              <View key={group.date} style={styles.group}>
                <Text style={styles.dateTitle}>{formatActivityDate(group.date)}</Text>
                <View style={styles.groupItems}>
                  {group.items.map((item) => (
                    <ActivityCard key={item.id} item={item} />
                  ))}
                </View>
              </View>
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
  historyList: {
    gap: 18,
  },
  group: {
    gap: 10,
  },
  groupItems: {
    gap: 10,
  },
  dateTitle: {
    color: colors.textMuted,
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0,
    textTransform: 'capitalize',
  },
  activityCard: {
    paddingVertical: 14,
  },
  activityHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  activityIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.accent.orangeBorder,
    backgroundColor: colors.accent.orangeBg,
  },
  activityTitleBlock: {
    flex: 1,
    minWidth: 0,
  },
  activityTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '700',
  },
  activityTime: {
    color: colors.textDim,
    fontSize: 13,
    lineHeight: 18,
    marginTop: 3,
  },
  metaBlock: {
    gap: 8,
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: colors.separator,
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
