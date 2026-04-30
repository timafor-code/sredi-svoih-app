import { Stack, useRouter } from 'expo-router';
import type { Href } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, View } from 'react-native';

import { GlassCard } from '@/components/glass/GlassCard';
import { IOSGroup } from '@/components/ui/IOSGroup';
import { PrimaryButton } from '@/components/ui/PrimaryButton';
import { Screen } from '@/components/ui/Screen';
import { SubHeader } from '@/components/ui/SubHeader';
import { ToggleRow } from '@/components/ui/ToggleRow';
import { useAuthStore } from '@/store/useAuthStore';
import { colors } from '@/theme/colors';
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  type ProfileNotificationPreferences,
} from '@/types/profile';

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

type NotificationPreferenceKey = (typeof notificationPreferenceKeys)[number];

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

function normalizeNotificationPreferences(
  input: ProfileNotificationPreferences | null | undefined,
): ProfileNotificationPreferences {
  const source: Partial<ProfileNotificationPreferences> = input ?? {};

  return {
    ...DEFAULT_NOTIFICATION_PREFERENCES,
    ...source,
    prayers: typeof source.prayers === 'boolean' ? source.prayers : DEFAULT_NOTIFICATION_PREFERENCES.prayers,
    shabbat: typeof source.shabbat === 'boolean' ? source.shabbat : DEFAULT_NOTIFICATION_PREFERENCES.shabbat,
    holidays: typeof source.holidays === 'boolean' ? source.holidays : DEFAULT_NOTIFICATION_PREFERENCES.holidays,
    candles: typeof source.candles === 'boolean' ? source.candles : DEFAULT_NOTIFICATION_PREFERENCES.candles,
    events: typeof source.events === 'boolean' ? source.events : DEFAULT_NOTIFICATION_PREFERENCES.events,
    birthdays: typeof source.birthdays === 'boolean' ? source.birthdays : DEFAULT_NOTIFICATION_PREFERENCES.birthdays,
    weekly: typeof source.weekly === 'boolean' ? source.weekly : DEFAULT_NOTIFICATION_PREFERENCES.weekly,
    news: typeof source.news === 'boolean' ? source.news : DEFAULT_NOTIFICATION_PREFERENCES.news,
  };
}

function areNotificationPreferencesEqual(
  left: ProfileNotificationPreferences,
  right: ProfileNotificationPreferences,
): boolean {
  return notificationPreferenceKeys.every((key) => left[key] === right[key]);
}

export default function NotificationsScreen() {
  const router = useRouter();
  const user = useAuthStore((state) => state.user);
  const profile = useAuthStore((state) => state.profile);
  const loading = useAuthStore((state) => state.loading);
  const loadSession = useAuthStore((state) => state.loadSession);
  const updateProfile = useAuthStore((state) => state.updateProfile);

  const [preferences, setPreferences] = useState<ProfileNotificationPreferences>(DEFAULT_NOTIFICATION_PREFERENCES);
  const [sessionRequested, setSessionRequested] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isSaved, setIsSaved] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const savedPreferences = useMemo(
    () => normalizeNotificationPreferences(profile?.notification_preferences),
    [profile?.notification_preferences],
  );
  const isDirty = useMemo(
    () => !areNotificationPreferencesEqual(preferences, savedPreferences),
    [preferences, savedPreferences],
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

  const handleGoProfile = useCallback(() => {
    router.replace(profileHref);
  }, [router]);

  const handleToggle = useCallback((key: NotificationPreferenceKey, value: boolean) => {
    setIsSaved(false);
    setLocalError(null);
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

    const nextPreferences = normalizeNotificationPreferences(preferences);

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
            Эти настройки пока сохраняют ваши предпочтения. Реальные push-уведомления будут подключены отдельным этапом.
          </Text>
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
