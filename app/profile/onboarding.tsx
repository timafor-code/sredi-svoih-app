import { Ionicons } from '@expo/vector-icons';
import { Stack, useRouter } from 'expo-router';
import type { Href } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { GlassCard } from '@/components/glass/GlassCard';
import { FormField } from '@/components/ui/FormField';
import { IOSGroup } from '@/components/ui/IOSGroup';
import { ListRow } from '@/components/ui/ListRow';
import { PrimaryButton } from '@/components/ui/PrimaryButton';
import { Screen } from '@/components/ui/Screen';
import { SectionTitle } from '@/components/ui/SectionTitle';
import { SubHeader } from '@/components/ui/SubHeader';
import { useAuthStore } from '@/store/useAuthStore';
import { colors } from '@/theme/colors';
import {
  PROFILE_NUSACH_OPTIONS,
  normalizeProfileNusach,
  type ProfileNusach,
} from '@/types/profile';

const profileHref = '/profile' as Href;

function trimOrNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function buildFullName(firstName: string, lastName: string): string | null {
  return [firstName, lastName]
    .map((part) => part.trim())
    .filter(Boolean)
    .join(' ') || null;
}

export default function ProfileOnboardingScreen() {
  const router = useRouter();
  const user = useAuthStore((state) => state.user);
  const profile = useAuthStore((state) => state.profile);
  const loading = useAuthStore((state) => state.loading);
  const loadSession = useAuthStore((state) => state.loadSession);
  const updateProfile = useAuthStore((state) => state.updateProfile);

  const [displayName, setDisplayName] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [city, setCity] = useState('');
  const [nusach, setNusach] = useState<ProfileNusach>('common');
  const [localError, setLocalError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const profileDisplayName = useMemo(() => {
    const firstLastName = [profile?.first_name, profile?.last_name].filter(Boolean).join(' ');

    return profile?.display_name
      ?? (firstLastName || null)
      ?? profile?.full_name
      ?? user?.email?.split('@')[0]
      ?? '';
  }, [profile?.display_name, profile?.first_name, profile?.full_name, profile?.last_name, user?.email]);

  useEffect(() => {
    if (user && profile) {
      return;
    }

    void loadSession().catch((error) => {
      setLocalError(error instanceof Error ? error.message : 'Не удалось загрузить профиль.');
    });
  }, [loadSession, profile, user]);

  useEffect(() => {
    setDisplayName(profileDisplayName);
    setFirstName(profile?.first_name ?? '');
    setLastName(profile?.last_name ?? '');
    setCity(profile?.city ?? '');
    setNusach(normalizeProfileNusach(profile?.nusach));
  }, [
    profile?.city,
    profile?.first_name,
    profile?.last_name,
    profile?.nusach,
    profileDisplayName,
  ]);

  const handleReloadProfile = useCallback(() => {
    setLocalError(null);
    void loadSession().catch((error) => {
      setLocalError(error instanceof Error ? error.message : 'Не удалось загрузить профиль.');
    });
  }, [loadSession]);

  const handleReturnProfile = useCallback(() => {
    router.replace(profileHref);
  }, [router]);

  const handleSave = useCallback(async () => {
    setLocalError(null);

    if (!user || !profile) {
      setLocalError('Профиль не загружен.');
      return;
    }

    const missingFields = [
      !displayName.trim() ? 'имя для отображения' : null,
      !firstName.trim() ? 'имя' : null,
      !lastName.trim() ? 'фамилию' : null,
      !city.trim() ? 'город' : null,
    ].filter(Boolean);

    if (missingFields.length > 0) {
      setLocalError(`Заполните: ${missingFields.join(', ')}.`);
      return;
    }

    const nextFullName = buildFullName(firstName, lastName);

    setIsSaving(true);

    try {
      await updateProfile({
        city: trimOrNull(city),
        display_name: trimOrNull(displayName),
        first_name: trimOrNull(firstName),
        full_name: nextFullName,
        last_name: trimOrNull(lastName),
        nusach,
        onboarding_completed: true,
      });

      router.replace(profileHref);
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : 'Не удалось сохранить профиль.');
    } finally {
      setIsSaving(false);
    }
  }, [city, displayName, firstName, lastName, nusach, profile, router, updateProfile, user]);

  if (!user || !profile) {
    const title = loading ? 'Загружаем профиль' : user ? 'Профиль не загружен' : 'Нужен вход';
    const text = user
      ? 'Не удалось получить данные профиля. Попробуйте загрузить их ещё раз.'
      : 'Войдите в приложение, чтобы завершить базовый профиль.';

    return (
      <>
        <Stack.Screen options={{ headerShown: false }} />
        <Screen contentContainerStyle={styles.content}>
          <SubHeader title="Завершить профиль" />
          <GlassCard>
            <View style={styles.stateCard}>
              <Text style={styles.cardTitle}>{title}</Text>
              <Text style={styles.cardText}>{text}</Text>
              {localError ? <Text style={styles.errorText}>{localError}</Text> : null}
              {user ? (
                <PrimaryButton
                  disabled={loading}
                  onPress={handleReloadProfile}
                  title={loading ? 'Загружаем...' : 'Загрузить профиль'}
                />
              ) : (
                <PrimaryButton onPress={handleReturnProfile} title="К профилю" />
              )}
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
        <SubHeader
          title="Завершить профиль"
          subtitle="Основные данные можно будет изменить позже."
        />

        <GlassCard style={styles.heroCard}>
          <View style={styles.heroRow}>
            <View style={styles.heroIcon}>
              <Ionicons name="person-circle-outline" size={24} color={colors.orange} />
            </View>
            <View style={styles.flex}>
              <Text style={styles.cardTitle}>Базовый профиль</Text>
              <Text style={styles.cardText}>
                Заполните имя, город и нусах, чтобы приложение точнее показывало личные сценарии.
              </Text>
            </View>
          </View>
        </GlassCard>

        <View style={styles.section}>
          <SectionTitle title="ОСНОВНОЕ" />
          <FormField
            label="Имя для отображения"
            value={displayName}
            onChangeText={setDisplayName}
            placeholder="Как показывать вас в приложении"
          />
          <FormField label="Имя" value={firstName} onChangeText={setFirstName} />
          <FormField label="Фамилия" value={lastName} onChangeText={setLastName} />
          <FormField label="Город" value={city} onChangeText={setCity} placeholder="Москва" />
        </View>

        <View style={styles.section}>
          <SectionTitle title="НУСАХ" />
          <IOSGroup>
            {PROFILE_NUSACH_OPTIONS.map((option, index) => (
              <ListRow
                key={option.value}
                title={option.label}
                subtitle={option.value === 'common' ? 'Можно выбрать позже' : undefined}
                rightText={nusach === option.value ? '✓' : undefined}
                onPress={() => setNusach(option.value)}
                isLast={index === PROFILE_NUSACH_OPTIONS.length - 1}
              />
            ))}
          </IOSGroup>
        </View>

        {localError ? <Text style={styles.errorText}>{localError}</Text> : null}

        <PrimaryButton
          disabled={isSaving}
          title={isSaving ? 'Сохраняем...' : 'Сохранить профиль'}
          buttonStyle={styles.saveButton}
          onPress={handleSave}
        />

        <Pressable
          disabled={isSaving}
          onPress={handleReturnProfile}
          style={({ pressed }) => [styles.secondaryButton, pressed && !isSaving && styles.pressed]}
        >
          <Text style={styles.secondaryText}>Вернуться в профиль</Text>
        </Pressable>
      </Screen>
    </>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: 18,
  },
  heroCard: {
    borderColor: colors.accent.orangeBorder,
  },
  heroRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  heroIcon: {
    width: 42,
    height: 42,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.accent.orangeBorder,
    backgroundColor: colors.accent.orangeBg,
  },
  flex: {
    flex: 1,
    minWidth: 0,
  },
  cardTitle: {
    color: colors.text,
    fontSize: 17,
    fontWeight: '800',
  },
  cardText: {
    color: colors.textDim,
    fontSize: 13,
    lineHeight: 18,
    marginTop: 4,
  },
  section: {
    gap: 10,
  },
  stateCard: {
    gap: 12,
  },
  errorText: {
    color: colors.danger,
    fontSize: 12,
    lineHeight: 17,
  },
  saveButton: {
    minHeight: 48,
    borderRadius: 14,
  },
  secondaryButton: {
    minHeight: 42,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryText: {
    color: colors.textGhost,
    fontSize: 13,
    fontWeight: '700',
  },
  pressed: {
    opacity: 0.72,
  },
});
