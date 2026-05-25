import { Stack, useRouter } from 'expo-router';
import type { Href } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { GlassCard } from '@/components/glass/GlassCard';
import { IOSGroup } from '@/components/ui/IOSGroup';
import { PrimaryButton } from '@/components/ui/PrimaryButton';
import { Screen } from '@/components/ui/Screen';
import { SubHeader } from '@/components/ui/SubHeader';
import { ToggleRow } from '@/components/ui/ToggleRow';
import {
  cancelAllLocalNotifications,
  getNotificationPermissionStatus,
  requestNotificationPermissions,
  scheduleTestLocalNotification,
  type NotificationPermissionStatus,
} from '@/services/notificationsService';
import {
  buildNotificationSchedulePreview,
  normalizeNotificationPreferencesForSchedule,
} from '@/services/notificationPlannerService';
import { useAuthStore } from '@/store/useAuthStore';
import { useContactsStore } from '@/store/useContactsStore';
import { useEventsStore } from '@/store/useEventsStore';
import { useSettingsStore } from '@/store/useSettingsStore';
import { colors } from '@/theme/colors';
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  type ProfileNotificationPreferences,
} from '@/types/profile';
import type { NotificationScheduleItem, NotificationScheduleStatus } from '@/types/notification';

const profileHref = '/profile' as Href;

const notificationPreferenceKeys = [
  'prayers',
  'shabbat',
  'holidays',
  'candles',
  'events',
  'birthdays',
  'weekly',
  'news',
] as const;

const advancedNotificationPreferenceKeys = [
  'candlesReminderOffsetMinutes',
  'shabbatReminderOffsetHours',
  'holidaysReminderHour',
  'weeklyReminderOffsetHours',
  'birthdaysReminderHour',
  'eventsPrimaryReminderOffsetHours',
  'eventsFallbackReminderOffsetHours',
  'quietHoursEnabled',
  'quietHoursStart',
  'quietHoursEnd',
] as const;

const allNotificationPreferenceKeys = [
  ...notificationPreferenceKeys,
  ...advancedNotificationPreferenceKeys,
] as const;

type NotificationPreferenceKey = (typeof notificationPreferenceKeys)[number];
type AdvancedNumericPreferenceKey =
  | 'candlesReminderOffsetMinutes'
  | 'eventsPrimaryReminderOffsetHours'
  | 'birthdaysReminderHour';

type NotificationPreferenceRow = {
  icon: string;
  key: NotificationPreferenceKey;
  label: string;
  subtitle: string;
};

const notificationRows: readonly NotificationPreferenceRow[] = [
  { key: 'prayers', icon: '🕌', label: 'Молитвы', subtitle: 'Напоминания о начале молитв' },
  { key: 'shabbat', icon: '✡️', label: 'Шаббат', subtitle: 'Начало и окончание Шаббата' },
  { key: 'holidays', icon: '🎉', label: 'Праздники', subtitle: 'Еврейские праздники и даты' },
  { key: 'candles', icon: '🕯️', label: 'Зажигание свечей', subtitle: 'Пятница и ערב праздников' },
  { key: 'events', icon: '📅', label: 'Мероприятия', subtitle: 'Ваши записи и напоминания' },
  { key: 'birthdays', icon: '🎂', label: 'Дни рождения', subtitle: 'Дни рождения контактов' },
  { key: 'weekly', icon: '📖', label: 'Недельная глава', subtitle: 'Каждую пятницу утром' },
  { key: 'news', icon: '📰', label: 'Новости общины', subtitle: 'Объявления и новости' },
];

const permissionStatusLabels: Record<NotificationPermissionStatus, string> = {
  granted: 'Разрешены',
  denied: 'Не разрешены',
  undetermined: 'Ещё не запрошены',
  unknown: 'Неизвестно',
};

const scheduleStatusLabels: Record<NotificationScheduleStatus, string> = {
  candidate: 'включено',
  disabled_by_preferences: 'выключено',
  needs_data: 'нужны данные',
  skipped: 'пропущено',
  unsupported_in_this_pr: 'будет подключено в следующем PR',
};

const candleOffsetOptions = [30, 60, 90] as const;
const eventPrimaryOffsetOptions = [12, 24, 48] as const;
const birthdayHourOptions = [9, 10, 11] as const;

type AdvancedOptionRowProps = {
  isLast?: boolean;
  label: string;
  onChange: (value: number) => void;
  options: readonly number[];
  subtitle: string;
  value: number;
  valueSuffix: string;
};

function areNotificationPreferencesEqual(
  left: ProfileNotificationPreferences,
  right: ProfileNotificationPreferences,
): boolean {
  return allNotificationPreferenceKeys.every((key) => left[key] === right[key]);
}

function getNumericPreferenceValue(
  preferences: ProfileNotificationPreferences,
  key: AdvancedNumericPreferenceKey,
  fallback: number,
): number {
  const value = preferences[key];
  return typeof value === 'number' ? value : fallback;
}

function AdvancedOptionRow({
  isLast,
  label,
  onChange,
  options,
  subtitle,
  value,
  valueSuffix,
}: AdvancedOptionRowProps) {
  return (
    <View style={[styles.advancedOptionRow, !isLast && styles.advancedDivider]}>
      <View style={styles.advancedOptionTextBlock}>
        <Text numberOfLines={2} style={styles.advancedOptionLabel}>
          {label}
        </Text>
        <Text numberOfLines={2} style={styles.advancedOptionSubtitle}>
          {subtitle}
        </Text>
      </View>
      <View style={styles.advancedOptionChips}>
        {options.map((option) => {
          const selected = option === value;

          return (
            <Pressable
              key={option}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              onPress={() => onChange(option)}
              style={[styles.advancedOptionChip, selected && styles.advancedOptionChipSelected]}
            >
              <Text
                numberOfLines={1}
                style={[
                  styles.advancedOptionChipText,
                  selected && styles.advancedOptionChipTextSelected,
                ]}
              >
                {option} {valueSuffix}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function getScheduleStatusStyle(status: NotificationScheduleStatus) {
  if (status === 'candidate') {
    return styles.scheduleStatusEnabled;
  }

  if (status === 'disabled_by_preferences') {
    return styles.scheduleStatusDisabled;
  }

  return styles.scheduleStatusPending;
}

function formatScheduleTriggerAt(item: NotificationScheduleItem) {
  if (!item.triggerAt) {
    return null;
  }

  const date = new Date(item.triggerAt);

  if (!Number.isFinite(date.getTime())) {
    return null;
  }

  const timezone = item.timezone ?? undefined;
  const day = date.toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'short',
    timeZone: timezone,
  });
  const time = date.toLocaleTimeString('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: timezone,
  });

  return `${day}, ${time}`;
}

function getScheduleCandidateDetails(items: readonly NotificationScheduleItem[]) {
  return items
    .filter((item) => item.status === 'candidate')
    .map((item) => {
      const triggerAt = formatScheduleTriggerAt(item);
      const quietHoursLabel = item.metadata?.isInsideQuietHours === true ? ' · тихие часы' : '';

      return triggerAt ? `${item.title} · ${triggerAt}${quietHoursLabel}` : `${item.title}${quietHoursLabel}`;
    });
}

export default function NotificationsScreen() {
  const router = useRouter();
  const user = useAuthStore((state) => state.user);
  const profile = useAuthStore((state) => state.profile);
  const loading = useAuthStore((state) => state.loading);
  const loadSession = useAuthStore((state) => state.loadSession);
  const updateProfile = useAuthStore((state) => state.updateProfile);
  const communityContacts = useContactsStore((state) => state.communityContacts);
  const localContacts = useContactsStore((state) => state.localContacts);
  const events = useEventsStore((state) => state.events);
  const loadedMyRegistrations = useEventsStore((state) => state.myRegistrations);
  const myRegistrationsUserId = useEventsStore((state) => state.myRegistrationsUserId);
  const city = useSettingsStore((state) => state.city);

  const [preferences, setPreferences] = useState<ProfileNotificationPreferences>(DEFAULT_NOTIFICATION_PREFERENCES);
  const [sessionRequested, setSessionRequested] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isSaved, setIsSaved] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [permissionStatus, setPermissionStatus] = useState<NotificationPermissionStatus>('unknown');
  const [notificationActionMessage, setNotificationActionMessage] = useState<string | null>(null);
  const [isPermissionStatusLoading, setIsPermissionStatusLoading] = useState(true);
  const [isRequestingPermission, setIsRequestingPermission] = useState(false);
  const [isSendingTestNotification, setIsSendingTestNotification] = useState(false);
  const [isCancellingLocalNotifications, setIsCancellingLocalNotifications] = useState(false);

  const savedPreferences = useMemo(
    () => normalizeNotificationPreferencesForSchedule(profile?.notification_preferences),
    [profile?.notification_preferences],
  );
  const isDirty = useMemo(
    () => !areNotificationPreferencesEqual(preferences, savedPreferences),
    [preferences, savedPreferences],
  );
  const permissionStatusLabel = isPermissionStatusLoading
    ? 'Проверяем...'
    : permissionStatusLabels[permissionStatus];
  const myRegistrations = useMemo(
    () => (user?.id && myRegistrationsUserId === user.id ? loadedMyRegistrations : []),
    [loadedMyRegistrations, myRegistrationsUserId, user?.id],
  );
  const schedulePreview = useMemo(
    () => buildNotificationSchedulePreview({
      city,
      communityContacts,
      events,
      localContacts,
      myRegistrations,
      preferences,
    }),
    [city, communityContacts, events, localContacts, myRegistrations, preferences],
  );

  useEffect(() => {
    if (user || loading || sessionRequested) {
      return;
    }

    setSessionRequested(true);
    void loadSession().catch((error) => {
      setLocalError(error instanceof Error ? error.message : 'Не удалось загрузить профиль.');
    });
  }, [loadSession, loading, sessionRequested, user]);

  useEffect(() => {
    if (!profile) {
      return;
    }

    setPreferences(savedPreferences);
    setLocalError(null);
  }, [profile, savedPreferences]);

  useEffect(() => {
    let isMounted = true;

    const loadPermissionStatus = async () => {
      setIsPermissionStatusLoading(true);
      const status = await getNotificationPermissionStatus();

      if (!isMounted) {
        return;
      }

      setPermissionStatus(status);
      setIsPermissionStatusLoading(false);
    };

    void loadPermissionStatus();

    return () => {
      isMounted = false;
    };
  }, []);

  const handleGoProfile = useCallback(() => {
    router.replace(profileHref);
  }, [router]);

  const handleToggle = useCallback((key: NotificationPreferenceKey, value: boolean) => {
    setIsSaved(false);
    setLocalError(null);
    setNotificationActionMessage(null);
    setPreferences((current) => ({
      ...current,
      [key]: value,
    }));
  }, []);

  const handleAdvancedPreferenceChange = useCallback((
    key: keyof ProfileNotificationPreferences,
    value: boolean | number | string,
  ) => {
    setIsSaved(false);
    setLocalError(null);
    setNotificationActionMessage(null);
    setPreferences((current) => ({
      ...current,
      [key]: value,
    }));
  }, []);

  const handleSave = useCallback(async () => {
    setLocalError(null);

    if (!user || !profile) {
      setLocalError('Профиль не загружен.');
      return;
    }

    const nextPreferences = normalizeNotificationPreferencesForSchedule(preferences);

    setIsSaving(true);

    try {
      await updateProfile({ notification_preferences: nextPreferences });
      setPreferences(nextPreferences);
      setIsSaved(true);
      Alert.alert('Сохранено', 'Настройки уведомлений сохранены.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Не удалось сохранить настройки.';

      setLocalError(message);
      Alert.alert('Не удалось сохранить', message);
    } finally {
      setIsSaving(false);
    }
  }, [preferences, profile, updateProfile, user]);

  const handleRequestPermission = useCallback(async () => {
    setLocalError(null);
    setNotificationActionMessage(null);
    setIsRequestingPermission(true);

    try {
      const status = await requestNotificationPermissions();
      setPermissionStatus(status);

      if (status === 'granted') {
        setNotificationActionMessage('Уведомления разрешены на этом устройстве.');
        return;
      }

      if (status === 'denied') {
        setNotificationActionMessage('Уведомления не разрешены. Изменить это можно в настройках iOS.');
        return;
      }

      if (status === 'undetermined') {
        setNotificationActionMessage('Разрешение на уведомления ещё не выдано.');
        return;
      }

      setNotificationActionMessage('Не удалось определить статус уведомлений.');
    } finally {
      setIsRequestingPermission(false);
      setIsPermissionStatusLoading(false);
    }
  }, []);

  const handleSendTestNotification = useCallback(async () => {
    setLocalError(null);
    setNotificationActionMessage(null);
    setIsSendingTestNotification(true);

    try {
      const result = await scheduleTestLocalNotification();
      setPermissionStatus(result.permissionStatus);

      if (result.ok) {
        setNotificationActionMessage('Тестовое локальное уведомление отправлено.');
        return;
      }

      if (result.error === 'notifications_permission_not_granted') {
        setNotificationActionMessage('Сначала разрешите уведомления на этом устройстве.');
        return;
      }

      setNotificationActionMessage('Не удалось отправить тестовое уведомление.');
    } finally {
      setIsSendingTestNotification(false);
    }
  }, []);

  const handleCancelLocalNotifications = useCallback(async () => {
    setLocalError(null);
    setNotificationActionMessage(null);
    setIsCancellingLocalNotifications(true);

    try {
      const result = await cancelAllLocalNotifications();
      setNotificationActionMessage(
        result.ok
          ? 'Локальные уведомления отменены.'
          : 'Не удалось отменить локальные уведомления.',
      );
    } finally {
      setIsCancellingLocalNotifications(false);
    }
  }, []);

  if (loading && !user && !profile) {
    return (
      <>
        <Stack.Screen options={{ headerShown: false }} />
        <Screen contentContainerStyle={styles.content}>
          <SubHeader title="Уведомления" />
          <GlassCard>
            <View style={styles.stateCard}>
              <ActivityIndicator color={colors.orange} />
              <Text style={styles.stateTitle}>Загружаем профиль...</Text>
            </View>
          </GlassCard>
        </Screen>
      </>
    );
  }

  if (!user) {
    return (
      <>
        <Stack.Screen options={{ headerShown: false }} />
        <Screen contentContainerStyle={styles.content}>
          <SubHeader title="Уведомления" />
          <GlassCard>
            <View style={styles.stateCard}>
              <Text style={styles.stateTitle}>Нужен вход</Text>
              <Text style={styles.stateText}>Войдите в профиль, чтобы сохранять настройки уведомлений.</Text>
              {localError ? <Text style={styles.errorText}>{localError}</Text> : null}
              <PrimaryButton title="К профилю" onPress={handleGoProfile} />
            </View>
          </GlassCard>
        </Screen>
      </>
    );
  }

  if (loading && !profile) {
    return (
      <>
        <Stack.Screen options={{ headerShown: false }} />
        <Screen contentContainerStyle={styles.content}>
          <SubHeader title="Уведомления" />
          <GlassCard>
            <View style={styles.stateCard}>
              <ActivityIndicator color={colors.orange} />
              <Text style={styles.stateTitle}>Загружаем настройки...</Text>
            </View>
          </GlassCard>
        </Screen>
      </>
    );
  }

  if (!profile) {
    return (
      <>
        <Stack.Screen options={{ headerShown: false }} />
        <Screen contentContainerStyle={styles.content}>
          <SubHeader title="Уведомления" />
          <GlassCard>
            <View style={styles.stateCard}>
              <Text style={styles.stateTitle}>Профиль не загружен</Text>
              <Text style={styles.stateText}>Откройте профиль ещё раз, чтобы подтянуть настройки уведомлений.</Text>
              {localError ? <Text style={styles.errorText}>{localError}</Text> : null}
              <PrimaryButton title="К профилю" onPress={handleGoProfile} />
            </View>
          </GlassCard>
        </Screen>
      </>
    );
  }

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <Screen contentContainerStyle={styles.content}>
        <SubHeader title="Уведомления" subtitle="Настройте, что и когда вам напоминать" />

        <GlassCard>
          <Text style={styles.infoText}>
            Сейчас подключается локальный слой уведомлений на устройстве. Серверные push-уведомления будут подключены отдельным этапом через EAS development build/TestFlight.
          </Text>
        </GlassCard>

        <GlassCard>
          <View style={styles.permissionHeader}>
            <View style={styles.permissionTextBlock}>
              <Text style={styles.permissionTitle}>Статус уведомлений</Text>
              <Text style={styles.permissionSubtitle}>
                {permissionStatusLabel}
              </Text>
            </View>
            <View style={[styles.permissionPill, styles[`permissionPill_${permissionStatus}`]]}>
              <Text style={[styles.permissionPillText, styles[`permissionPillText_${permissionStatus}`]]}>
                {permissionStatusLabel}
              </Text>
            </View>
          </View>

          <View style={styles.permissionActions}>
            {permissionStatus !== 'granted' ? (
              <PrimaryButton
                disabled={isRequestingPermission || isPermissionStatusLoading}
                title={isRequestingPermission ? 'Запрашиваем...' : 'Разрешить уведомления'}
                textNumberOfLines={2}
                buttonStyle={styles.permissionButton}
                onPress={handleRequestPermission}
              />
            ) : null}
            <PrimaryButton
              disabled={isSendingTestNotification}
              title={isSendingTestNotification ? 'Отправляем...' : 'Отправить тестовое уведомление'}
              textNumberOfLines={2}
              buttonStyle={styles.permissionButton}
              onPress={handleSendTestNotification}
            />
            <PrimaryButton
              disabled={isCancellingLocalNotifications}
              title={isCancellingLocalNotifications ? 'Отменяем...' : 'Отменить локальные уведомления'}
              textNumberOfLines={2}
              buttonStyle={styles.permissionButton}
              onPress={handleCancelLocalNotifications}
            />
          </View>

          {notificationActionMessage ? (
            <Text style={styles.notificationActionText}>{notificationActionMessage}</Text>
          ) : null}
        </GlassCard>

        <GlassCard>
          <View style={styles.scheduleHeader}>
            <Text style={styles.scheduleTitle}>План уведомлений</Text>
            <Text style={styles.scheduleSummary}>
              {schedulePreview.enabledCategoryCount} из {notificationRows.length} включено
            </Text>
          </View>

          <View style={styles.scheduleList}>
            {notificationRows.map((row) => {
              const scheduleItems = schedulePreview.items.filter((item) => item.category === row.key);
              const scheduleItem = scheduleItems[0];
              const scheduleStatus = scheduleItem?.status ?? 'unsupported_in_this_pr';
              const candidateDetails = getScheduleCandidateDetails(scheduleItems);

              return (
                <View key={row.key} style={styles.scheduleRow}>
                  <View style={styles.scheduleCategoryBlock}>
                    <Text style={styles.scheduleCategory}>{row.label}</Text>
                    {candidateDetails.map((candidateDetail, index) => (
                      <Text
                        key={`${row.key}:candidate:${index}`}
                        numberOfLines={1}
                        style={styles.scheduleCandidateDetail}
                      >
                        {candidateDetail}
                      </Text>
                    ))}
                  </View>
                  <Text style={[styles.scheduleStatus, getScheduleStatusStyle(scheduleStatus)]}>
                    {scheduleStatusLabels[scheduleStatus]}
                  </Text>
                </View>
              );
            })}
          </View>
        </GlassCard>

        <IOSGroup>
          {notificationRows.map((item, index) => (
            <ToggleRow
              key={item.key}
              icon={item.icon}
              label={item.label}
              subtitle={item.subtitle}
              value={preferences[item.key]}
              onValueChange={(value) => handleToggle(item.key, value)}
              isLast={index === notificationRows.length - 1}
            />
          ))}
        </IOSGroup>

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Расширенные настройки</Text>
        </View>

        <IOSGroup>
          <ToggleRow
            icon="🌙"
            label="Тихие часы"
            subtitle={`${preferences.quietHoursStart ?? '22:00'}–${preferences.quietHoursEnd ?? '08:00'}, только пометка в плане`}
            value={preferences.quietHoursEnabled === true}
            onValueChange={(value) => handleAdvancedPreferenceChange('quietHoursEnabled', value)}
          />
          <AdvancedOptionRow
            label="Свечи"
            subtitle="За сколько минут напомнить"
            value={getNumericPreferenceValue(preferences, 'candlesReminderOffsetMinutes', 60)}
            valueSuffix="мин"
            options={candleOffsetOptions}
            onChange={(value) => handleAdvancedPreferenceChange('candlesReminderOffsetMinutes', value)}
          />
          <AdvancedOptionRow
            label="Мероприятия"
            subtitle="Основное напоминание за"
            value={getNumericPreferenceValue(preferences, 'eventsPrimaryReminderOffsetHours', 24)}
            valueSuffix="ч"
            options={eventPrimaryOffsetOptions}
            onChange={(value) => handleAdvancedPreferenceChange('eventsPrimaryReminderOffsetHours', value)}
          />
          <AdvancedOptionRow
            isLast
            label="Дни рождения"
            subtitle="В какой час напомнить"
            value={getNumericPreferenceValue(preferences, 'birthdaysReminderHour', 9)}
            valueSuffix="ч"
            options={birthdayHourOptions}
            onChange={(value) => handleAdvancedPreferenceChange('birthdaysReminderHour', value)}
          />
        </IOSGroup>

        <Text style={[styles.statusText, isDirty && styles.statusTextDirty, isSaved && styles.statusTextSaved]}>
          {isSaving
            ? 'Сохраняем...'
            : isDirty
              ? 'Есть несохранённые изменения'
              : isSaved
                ? 'Сохранено'
                : 'Все настройки сохранены'}
        </Text>

        {localError ? <Text style={styles.errorText}>{localError}</Text> : null}

        <PrimaryButton
          disabled={!isDirty || isSaving || loading}
          title={isSaving ? 'Сохраняем...' : 'Сохранить настройки'}
          buttonStyle={styles.saveButton}
          onPress={handleSave}
        />
      </Screen>
    </>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: 16,
  },
  stateCard: {
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
  },
  stateTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '800',
    lineHeight: 22,
    textAlign: 'center',
  },
  stateText: {
    color: colors.textDim,
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
  },
  infoText: {
    color: colors.textDim,
    fontSize: 13,
    lineHeight: 19,
  },
  permissionHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
  },
  permissionTextBlock: {
    flex: 1,
    minWidth: 0,
  },
  permissionTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '800',
    lineHeight: 22,
  },
  permissionSubtitle: {
    color: colors.textDim,
    fontSize: 13,
    lineHeight: 18,
    marginTop: 2,
  },
  permissionPill: {
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  permissionPill_granted: {
    backgroundColor: colors.accent.greenBg,
    borderColor: colors.accent.greenBorder,
  },
  permissionPill_denied: {
    backgroundColor: colors.accent.redBg,
    borderColor: colors.accent.redBorder,
  },
  permissionPill_undetermined: {
    backgroundColor: colors.accent.goldBg,
    borderColor: colors.accent.goldBorder,
  },
  permissionPill_unknown: {
    backgroundColor: colors.glass.w07,
    borderColor: colors.glass.w16,
  },
  permissionPillText: {
    fontSize: 12,
    fontWeight: '800',
    lineHeight: 16,
  },
  permissionPillText_granted: {
    color: colors.success,
  },
  permissionPillText_denied: {
    color: colors.danger,
  },
  permissionPillText_undetermined: {
    color: colors.warning,
  },
  permissionPillText_unknown: {
    color: colors.textMuted,
  },
  permissionActions: {
    gap: 10,
    marginTop: 16,
  },
  permissionButton: {
    minHeight: 44,
    borderRadius: 12,
  },
  notificationActionText: {
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 17,
    marginTop: 12,
    textAlign: 'center',
  },
  scheduleHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'space-between',
  },
  scheduleTitle: {
    color: colors.text,
    flex: 1,
    fontSize: 15,
    fontWeight: '800',
    lineHeight: 21,
    minWidth: 0,
  },
  scheduleSummary: {
    color: colors.textMuted,
    flexShrink: 1,
    fontSize: 12,
    fontWeight: '700',
    lineHeight: 17,
    textAlign: 'right',
  },
  scheduleList: {
    gap: 8,
    marginTop: 12,
  },
  scheduleRow: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: 10,
    justifyContent: 'space-between',
  },
  scheduleCategory: {
    color: colors.textDim,
    fontSize: 13,
    lineHeight: 18,
  },
  scheduleCategoryBlock: {
    flex: 1,
    minWidth: 0,
  },
  scheduleCandidateDetail: {
    color: colors.textMuted,
    fontSize: 11,
    lineHeight: 15,
    marginTop: 2,
  },
  scheduleStatus: {
    flexShrink: 1,
    fontSize: 12,
    fontWeight: '800',
    lineHeight: 17,
    maxWidth: 170,
    textAlign: 'right',
  },
  scheduleStatusDisabled: {
    color: colors.textMuted,
  },
  scheduleStatusEnabled: {
    color: colors.success,
  },
  scheduleStatusPending: {
    color: colors.warning,
  },
  sectionHeader: {
    marginBottom: -8,
    paddingHorizontal: 4,
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '800',
    lineHeight: 21,
  },
  advancedOptionRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    minHeight: 68,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  advancedDivider: {
    borderBottomColor: colors.separator,
    borderBottomWidth: 1,
  },
  advancedOptionTextBlock: {
    flex: 1,
    minWidth: 0,
  },
  advancedOptionLabel: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '500',
    includeFontPadding: false,
    lineHeight: 19,
  },
  advancedOptionSubtitle: {
    color: colors.textGhost,
    fontSize: 12,
    lineHeight: 16,
    marginTop: 3,
  },
  advancedOptionChips: {
    flexDirection: 'row',
    flexShrink: 0,
    gap: 6,
  },
  advancedOptionChip: {
    alignItems: 'center',
    backgroundColor: colors.glass.w07,
    borderColor: colors.glass.w16,
    borderRadius: 10,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 32,
    minWidth: 45,
    paddingHorizontal: 8,
  },
  advancedOptionChipSelected: {
    backgroundColor: colors.accent.orangeBg,
    borderColor: colors.accent.orangeBorder,
  },
  advancedOptionChipText: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '800',
    lineHeight: 16,
  },
  advancedOptionChipTextSelected: {
    color: colors.orange,
  },
  statusText: {
    color: colors.textGhost,
    fontSize: 12,
    fontWeight: '700',
    lineHeight: 17,
    textAlign: 'center',
  },
  statusTextDirty: {
    color: colors.warning,
  },
  statusTextSaved: {
    color: colors.success,
  },
  errorText: {
    color: colors.danger,
    fontSize: 12,
    lineHeight: 17,
    textAlign: 'center',
  },
  saveButton: {
    minHeight: 48,
    borderRadius: 14,
  },
});
