import { Ionicons } from '@expo/vector-icons';
import { Stack, useFocusEffect } from 'expo-router';
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
import { appCapabilities } from '@/config/appCapabilities';
import { useAuthStore } from '@/store/useAuthStore';
import { usePrayerTrackerStore } from '@/store/usePrayerTrackerStore';
import { colors } from '@/theme/colors';
import type {
  PrayerActivitySummary,
  PrayerActivityType,
  PrayerTrackerActivity,
} from '@/types/prayerTracker';

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

const SUMMARY_ACTIVITY_TYPES: PrayerActivityType[] = [
  'shacharit',
  'mincha',
  'maariv',
  'shema_morning',
  'shema_evening',
  'omer_count',
];

type ActivityGroup = {
  date: string;
  items: PrayerTrackerActivity[];
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

function getActivityTimeLabel(item: PrayerTrackerActivity): string {
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

function getHebrewDateLabel(item: PrayerTrackerActivity): string | null {
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

function getPlaceLabel(item: PrayerTrackerActivity): string | null {
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

function getOmerDay(item: PrayerTrackerActivity): number | null {
  return getFirstNumberValue(item.metadata.omerDay, item.hebrewDate.omerDay);
}

function getOmerSefirahRu(item: PrayerTrackerActivity): string | null {
  return getFirstStringValue(item.metadata.sefirahRu, item.hebrewDate.sefirahRu);
}

function getOmerSefirahHe(item: PrayerTrackerActivity): string | null {
  return getFirstStringValue(item.metadata.sefirahHe, item.hebrewDate.sefirahHe);
}

function getOmerDayHe(item: PrayerTrackerActivity): string | null {
  return getFirstStringValue(item.metadata.dayHe, item.hebrewDate.dayHe);
}

function getActivityTitle(item: PrayerTrackerActivity): string {
  if (item.activityType !== 'omer_count') {
    return ACTIVITY_LABELS[item.activityType];
  }

  const omerDay = getOmerDay(item);

  return omerDay ? `Омер · день ${omerDay}` : ACTIVITY_LABELS.omer_count;
}

function getActivityDetails(item: PrayerTrackerActivity): string | null {
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

function groupActivities(items: PrayerTrackerActivity[]): ActivityGroup[] {
  const groups = new Map<string, PrayerTrackerActivity[]>();

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

function PrayerHistorySummaryCard({
  loading,
  summary,
}: {
  loading: boolean;
  summary: PrayerActivitySummary | null;
}) {
  return (
    <GlassCard style={styles.summaryCard}>
      <View style={styles.summaryHeader}>
        <View style={styles.summaryIcon}>
          <Ionicons name="phone-portrait-outline" size={19} color={colors.orange} />
        </View>
        <View style={styles.summaryTitleBlock}>
          <Text style={styles.summaryTitle}>История на этом устройстве</Text>
          <Text style={styles.summarySubtitle}>Сводка по всем локальным записям</Text>
        </View>
        {loading ? <ActivityIndicator size="small" color={colors.orange} /> : null}
      </View>

      <View style={styles.summaryMetrics}>
        <View style={styles.summaryMetric}>
          <Text style={styles.summaryMetricValue}>{summary?.totalLogs ?? '—'}</Text>
          <Text style={styles.summaryMetricLabel}>Всего записей</Text>
        </View>
        <View style={styles.summaryDivider} />
        <View style={styles.summaryMetric}>
          <Text style={styles.summaryMetricValue}>{summary?.activeDays ?? '—'}</Text>
          <Text style={styles.summaryMetricLabel}>Активных дней</Text>
        </View>
      </View>

      <View style={styles.summaryCounts}>
        {SUMMARY_ACTIVITY_TYPES.map((activityType) => (
          <View key={activityType} style={styles.summaryCountRow}>
            <Text style={styles.summaryCountLabel}>{ACTIVITY_LABELS[activityType]}</Text>
            <Text style={styles.summaryCountValue}>
              {summary?.countsByActivityType[activityType] ?? '—'}
            </Text>
          </View>
        ))}
      </View>
    </GlassCard>
  );
}

function ActivityCard({
  deleting,
  item,
  onDelete,
}: {
  deleting: boolean;
  item: PrayerTrackerActivity;
  onDelete?: (item: PrayerTrackerActivity) => void;
}) {
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
        {onDelete ? (
          <Pressable
            accessibilityLabel={`Удалить запись ${getActivityTitle(item)}`}
            accessibilityRole="button"
            disabled={deleting}
            hitSlop={8}
            onPress={() => onDelete(item)}
            style={({ pressed }) => [
              styles.deleteActivityButton,
              pressed && styles.pressed,
              deleting && styles.disabled,
            ]}
          >
            <Ionicons name="trash-outline" size={18} color={colors.danger} />
          </Pressable>
        ) : null}
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
  const summary = usePrayerTrackerStore((state) => state.summary);
  const loading = usePrayerTrackerStore((state) => state.loading);
  const summaryLoading = usePrayerTrackerStore((state) => state.summaryLoading);
  const deleting = usePrayerTrackerStore((state) => state.deleting);
  const error = usePrayerTrackerStore((state) => state.error);
  const loadMyActivity = usePrayerTrackerStore((state) => state.loadMyActivity);
  const loadSummary = usePrayerTrackerStore((state) => state.loadSummary);
  const deleteActivity = usePrayerTrackerStore((state) => state.deleteActivity);
  const deleteAllLocalHistory = usePrayerTrackerStore((state) => state.deleteAllLocalHistory);
  const resetPrayerTracker = usePrayerTrackerStore((state) => state.reset);
  const [refreshing, setRefreshing] = useState(false);

  useFocusEffect(
    useCallback(() => {
      if (!appCapabilities.isAccountMode) {
        return undefined;
      }

      void loadSession().catch(() => undefined);

      return undefined;
    }, [loadSession]),
  );

  const loadHistory = useCallback(async () => {
    try {
      await loadMyActivity({ limit: 100 });
    } catch {
      // The store keeps the visible provider-neutral error state.
    }

    if (appCapabilities.isGuestOnly) {
      try {
        await loadSummary();
      } catch {
        // The store keeps the visible provider-neutral error state.
      }
    }
  }, [loadMyActivity, loadSummary]);

  useFocusEffect(
    useCallback(() => {
      if (appCapabilities.isGuestOnly) {
        void loadHistory();
        return undefined;
      }

      if (!authUser) {
        resetPrayerTracker();
        return undefined;
      }

      const hasDifferentAccountItems = usePrayerTrackerStore
        .getState()
        .items
        .some((item) => item.userId !== authUser.id);

      if (hasDifferentAccountItems) {
        resetPrayerTracker();
      }

      void loadHistory();

      return undefined;
    }, [authUser, loadHistory, resetPrayerTracker]),
  );

  const canAccessHistory = appCapabilities.isGuestOnly || Boolean(authUser);
  const visibleItems = useMemo(() => {
    if (appCapabilities.isGuestOnly) {
      return items;
    }

    if (!authUser || items.some((item) => item.userId !== authUser.id)) {
      return [];
    }

    return items;
  }, [authUser, items]);
  const groups = useMemo(() => groupActivities(visibleItems), [visibleItems]);

  const handleRefresh = useCallback(async () => {
    if (appCapabilities.isAccountMode && !authUser) {
      return;
    }

    setRefreshing(true);

    try {
      await loadHistory();
    } finally {
      setRefreshing(false);
    }
  }, [authUser, loadHistory]);

  const handleDeleteActivity = useCallback((item: PrayerTrackerActivity) => {
    Alert.alert(
      'Удалить запись?',
      `${getActivityTitle(item)} будет удалена только из истории на этом устройстве.`,
      [
        { text: 'Отмена', style: 'cancel' },
        {
          text: 'Удалить',
          style: 'destructive',
          onPress: () => {
            void deleteActivity(item.id).catch(() => undefined);
          },
        },
      ],
    );
  }, [deleteActivity]);

  const handleDeleteAll = useCallback(() => {
    Alert.alert(
      'Удалить всю историю?',
      'Будет удалена только молитвенная история, сохранённая на этом устройстве. Это действие не удаляет данные аккаунта или сервера.',
      [
        { text: 'Отмена', style: 'cancel' },
        {
          text: 'Удалить всё',
          style: 'destructive',
          onPress: () => {
            void deleteAllLocalHistory().catch(() => undefined);
          },
        },
      ],
    );
  }, [deleteAllLocalHistory]);

  const showInitialLoading = Boolean(canAccessHistory && loading && visibleItems.length === 0);
  const showBlockingError = Boolean(canAccessHistory && error && !loading && visibleItems.length === 0);
  const showInlineError = Boolean(canAccessHistory && error && !loading && visibleItems.length > 0);
  const showEmpty = Boolean(canAccessHistory && !loading && !error && visibleItems.length === 0);
  const showDeleteAll = appCapabilities.isGuestOnly
    && (summary?.totalLogs ?? visibleItems.length) > 0;

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <Screen
        contentContainerStyle={styles.content}
        refreshControl={
          canAccessHistory ? (
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
          subtitle={appCapabilities.isGuestOnly
            ? 'Молитвенная история хранится только на этом устройстве.'
            : 'Ваша личная история молитв, Шма и счёта Омера.'}
        />

        {appCapabilities.isGuestOnly ? (
          <PrayerHistorySummaryCard loading={summaryLoading} summary={summary} />
        ) : null}

        {appCapabilities.isAccountMode && !authUser ? (
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
              <Text style={styles.errorText}>
                {appCapabilities.isGuestOnly ? 'Не удалось загрузить историю.' : error}
              </Text>
              <PrimaryButton title="Повторить" onPress={handleRefresh} />
            </View>
          </GlassCard>
        ) : null}

        {showInlineError ? (
          <Text style={styles.inlineErrorText}>
            {appCapabilities.isGuestOnly ? 'Не удалось обновить историю.' : error}
          </Text>
        ) : null}

        {showEmpty ? (
          <GlassCard>
            <View style={styles.stateCard}>
              <Ionicons name="book-outline" size={24} color={colors.textDim} />
              <Text style={styles.stateTitle}>История молитв пока пустая.</Text>
              <Text style={styles.stateText}>
                Отмеченные молитвы, Шма и счёт Омера появятся здесь.
              </Text>
            </View>
          </GlassCard>
        ) : null}

        {canAccessHistory && !showInitialLoading && !showBlockingError && groups.length > 0 ? (
          <View style={styles.historyList}>
            {groups.map((group) => (
              <View key={group.date} style={styles.group}>
                <Text style={styles.dateTitle}>{formatActivityDate(group.date)}</Text>
                <View style={styles.groupItems}>
                  {group.items.map((item) => (
                    <ActivityCard
                      key={item.id}
                      deleting={deleting}
                      item={item}
                      onDelete={appCapabilities.isGuestOnly ? handleDeleteActivity : undefined}
                    />
                  ))}
                </View>
              </View>
            ))}
          </View>
        ) : null}

        {showDeleteAll ? (
          <GlassCard style={styles.deleteAllCard}>
            <View style={styles.deleteAllContent}>
              <Ionicons name="trash-bin-outline" size={21} color={colors.danger} />
              <View style={styles.deleteAllCopy}>
                <Text style={styles.deleteAllTitle}>Локальная молитвенная история</Text>
                <Text style={styles.deleteAllText}>
                  Удаление затронет только записи на этом устройстве.
                </Text>
              </View>
            </View>
            <Pressable
              accessibilityRole="button"
              disabled={deleting}
              onPress={handleDeleteAll}
              style={({ pressed }) => [
                styles.deleteAllButton,
                pressed && styles.pressed,
                deleting && styles.disabled,
              ]}
            >
              {deleting ? (
                <ActivityIndicator size="small" color={colors.danger} />
              ) : (
                <Text style={styles.deleteAllButtonText}>
                  Удалить всю историю на этом устройстве
                </Text>
              )}
            </Pressable>
          </GlassCard>
        ) : null}
      </Screen>
    </>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: 16,
  },
  summaryCard: {
    gap: 16,
  },
  summaryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
  },
  summaryIcon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.accent.orangeBorder,
    backgroundColor: colors.accent.orangeBg,
  },
  summaryTitleBlock: {
    flex: 1,
    minWidth: 0,
  },
  summaryTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '700',
  },
  summarySubtitle: {
    color: colors.textDim,
    fontSize: 12,
    lineHeight: 17,
    marginTop: 2,
  },
  summaryMetrics: {
    flexDirection: 'row',
    alignItems: 'stretch',
    borderRadius: 12,
    backgroundColor: colors.glass.w04,
    paddingVertical: 12,
  },
  summaryMetric: {
    flex: 1,
    alignItems: 'center',
    gap: 3,
  },
  summaryMetricValue: {
    color: colors.text,
    fontSize: 22,
    fontWeight: '800',
  },
  summaryMetricLabel: {
    color: colors.textDim,
    fontSize: 12,
  },
  summaryDivider: {
    width: 1,
    backgroundColor: colors.separator,
  },
  summaryCounts: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    rowGap: 8,
  },
  summaryCountRow: {
    width: '50%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    paddingRight: 12,
  },
  summaryCountLabel: {
    flex: 1,
    color: colors.textDim,
    fontSize: 12,
    lineHeight: 16,
  },
  summaryCountValue: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '700',
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
  deleteActivityButton: {
    width: 36,
    height: 36,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.accent.redBorder,
    backgroundColor: colors.accent.redBg,
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
  deleteAllCard: {
    gap: 14,
    borderColor: colors.accent.redBorder,
  },
  deleteAllContent: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  deleteAllCopy: {
    flex: 1,
    gap: 3,
  },
  deleteAllTitle: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '700',
  },
  deleteAllText: {
    color: colors.textDim,
    fontSize: 13,
    lineHeight: 18,
  },
  deleteAllButton: {
    minHeight: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.accent.redBorder,
    backgroundColor: colors.accent.redBg,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  deleteAllButtonText: {
    color: colors.danger,
    fontSize: 14,
    fontWeight: '700',
    textAlign: 'center',
  },
  pressed: {
    opacity: 0.72,
  },
  disabled: {
    opacity: 0.5,
  },
});
