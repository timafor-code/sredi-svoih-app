import type { User } from '@supabase/supabase-js';
import { Ionicons } from '@expo/vector-icons';
import { Stack, useRouter } from 'expo-router';
import type { Href } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { GlassCard } from '@/components/glass/GlassCard';
import { Avatar } from '@/components/ui/Avatar';
import { IOSGroup } from '@/components/ui/IOSGroup';
import { ListRow } from '@/components/ui/ListRow';
import { PrimaryButton } from '@/components/ui/PrimaryButton';
import { Screen } from '@/components/ui/Screen';
import { SubHeader } from '@/components/ui/SubHeader';
import type {
  CommunityMembershipRole,
  CommunityMembershipStatus,
} from '@/services/inviteService';
import { getAuthErrorMessage } from '@/services/authErrorMessages';
import { useAuthStore } from '@/store/useAuthStore';
import { useEventsStore } from '@/store/useEventsStore';
import { colors } from '@/theme/colors';

const profileHref = '/profile' as Href;

type AuthProvider = 'email' | 'google' | 'apple' | 'unknown';

const providerLabels: Record<AuthProvider, string> = {
  email: 'Email и пароль',
  google: 'Google',
  apple: 'Apple ID',
  unknown: 'Неизвестный способ входа',
};

const roleTitles: Record<CommunityMembershipRole, string> = {
  member: 'Участник',
  event_manager: 'Менеджер событий',
  admin: 'Администратор',
};

const membershipStatusTitles: Record<CommunityMembershipStatus, string> = {
  pending: 'На проверке',
  active: 'Активен',
  suspended: 'Приостановлен',
  left: 'Вышел из общины',
};

function getInitials(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('') || 'СС';
}

function compactUserId(userId: string): string {
  return userId.length > 8 ? `${userId.slice(0, 8)}...` : userId;
}

function normalizeAuthProvider(provider: unknown): AuthProvider {
  const normalizedProvider = typeof provider === 'string' ? provider.trim().toLowerCase() : '';

  if (normalizedProvider === 'email' || normalizedProvider === 'google' || normalizedProvider === 'apple') {
    return normalizedProvider;
  }

  return 'unknown';
}

function getAuthProvider(user: User | null): AuthProvider {
  const appMetadataProvider = normalizeAuthProvider(user?.app_metadata?.provider);

  if (appMetadataProvider !== 'unknown') {
    return appMetadataProvider;
  }

  const identityProvider = user?.identities
    ?.map((identity) => normalizeAuthProvider(identity.provider))
    .find((provider) => provider !== 'unknown');

  return identityProvider ?? 'unknown';
}

function getEmailConfirmationLabel(
  user: User | null,
  provider: AuthProvider,
  accountEmail: string,
): string | null {
  if (!accountEmail) {
    return null;
  }

  const userWithConfirmation = user as (User & {
    confirmed_at?: string | null;
    email_confirmed_at?: string | null;
  }) | null;
  const confirmedAt = userWithConfirmation?.email_confirmed_at ?? userWithConfirmation?.confirmed_at ?? null;
  const canDetermineConfirmation = Boolean(
    userWithConfirmation &&
    ('email_confirmed_at' in userWithConfirmation || 'confirmed_at' in userWithConfirmation),
  );

  if (confirmedAt) {
    return 'Email подтверждён';
  }

  return provider === 'email' && canDetermineConfirmation ? 'Email не подтверждён' : null;
}

function getPasswordRowSubtitle(provider: AuthProvider, hasEmail: boolean): string {
  if (provider === 'email') {
    return hasEmail
      ? 'Отправим письмо для смены пароля'
      : 'Email не указан, отправить письмо нельзя';
  }

  if (provider === 'google' || provider === 'apple') {
    return `Пароль управляется через ${providerLabels[provider]}`;
  }

  return 'Смена пароля доступна только для email и пароля';
}

export default function ProfileSecurityScreen() {
  const router = useRouter();
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [isPasswordResetSending, setIsPasswordResetSending] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [passwordResetStatus, setPasswordResetStatus] = useState<string | null>(null);

  const user = useAuthStore((state) => state.user);
  const profile = useAuthStore((state) => state.profile);
  const membership = useAuthStore((state) => state.membership);
  const loading = useAuthStore((state) => state.loading);
  const loadSession = useAuthStore((state) => state.loadSession);
  const resetPasswordForEmail = useAuthStore((state) => state.resetPasswordForEmail);
  const signOut = useAuthStore((state) => state.signOut);
  const loadEvents = useEventsStore((state) => state.loadEvents);
  const resetEventPrivateState = useEventsStore((state) => state.resetPrivateState);

  useEffect(() => {
    if (user || loading || isSigningOut) {
      return;
    }

    void loadSession().catch(() => undefined);
  }, [isSigningOut, loadSession, loading, user]);

  const profileName = useMemo(() => {
    const firstLastName = [profile?.first_name, profile?.last_name].filter(Boolean).join(' ');

    return profile?.display_name
      ?? (firstLastName || null)
      ?? profile?.full_name
      ?? null;
  }, [profile?.display_name, profile?.first_name, profile?.full_name, profile?.last_name]);

  const accountEmail = profile?.email || user?.email || '';
  const displayName = profileName || (accountEmail ? accountEmail.split('@')[0] : 'Аккаунт');
  const authProvider = getAuthProvider(user);
  const authProviderLabel = providerLabels[authProvider];
  const emailConfirmationLabel = getEmailConfirmationLabel(user, authProvider, accountEmail);
  const canRequestPasswordReset = authProvider === 'email' && Boolean(accountEmail);
  const membershipLabel = membership
    ? `${roleTitles[membership.role]} · ${membershipStatusTitles[membership.status]}`
    : null;

  const handleGoProfile = useCallback(() => {
    router.replace(profileHref);
  }, [router]);

  const handleChangePassword = useCallback(async () => {
    if (!canRequestPasswordReset) {
      return;
    }

    setLocalError(null);
    setPasswordResetStatus(null);
    setIsPasswordResetSending(true);

    try {
      await resetPasswordForEmail(accountEmail);
      setPasswordResetStatus('Письмо для смены пароля отправлено, если этот email зарегистрирован.');
    } catch (error) {
      setLocalError(getAuthErrorMessage(
        error,
        'Не удалось отправить письмо для смены пароля. Попробуйте позже.',
      ));
    } finally {
      setIsPasswordResetSending(false);
    }
  }, [accountEmail, canRequestPasswordReset, resetPasswordForEmail]);

  const handleSignOutEverywhere = useCallback(() => {
    Alert.alert('Выйти со всех устройств', 'Будет добавлено позже.');
  }, []);

  const handleDeleteAccount = useCallback(() => {
    Alert.alert(
      'Удалить аккаунт',
      'Удаление аккаунта будет добавлено позже через безопасную серверную функцию.',
    );
  }, []);

  const handleSignOut = useCallback(async () => {
    setLocalError(null);
    setPasswordResetStatus(null);
    setIsSigningOut(true);

    try {
      await signOut();
      resetEventPrivateState();
      await loadEvents();
      router.replace(profileHref);
    } catch {
      setLocalError('Не удалось выйти. Попробуйте ещё раз.');
    } finally {
      setIsSigningOut(false);
    }
  }, [loadEvents, resetEventPrivateState, router, signOut]);

  if (loading && !user && !profile) {
    return (
      <>
        <Stack.Screen options={{ headerShown: false }} />
        <Screen contentContainerStyle={styles.content}>
          <SubHeader title="Аккаунт и безопасность" />
          <GlassCard>
            <View style={styles.stateCard}>
              <ActivityIndicator color={colors.orange} />
              <Text style={styles.stateTitle}>Загружаем аккаунт...</Text>
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
          <SubHeader title="Аккаунт и безопасность" />
          <GlassCard>
            <View style={styles.stateCard}>
              <Ionicons name="lock-closed-outline" size={24} color={colors.textDim} />
              <Text style={styles.stateTitle}>Нужен вход</Text>
              <Text style={styles.stateText}>Войдите в профиль, чтобы открыть настройки аккаунта.</Text>
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
          <SubHeader title="Аккаунт и безопасность" />
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

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <Screen contentContainerStyle={styles.content}>
        <SubHeader title="Аккаунт и безопасность" subtitle="Сессия, email и настройки входа" />

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Аккаунт</Text>
          <GlassCard>
            <View style={styles.accountHeader}>
              <Avatar initials={getInitials(displayName)} size={68} uri={profile?.avatar_url} />
              <View style={styles.flex}>
                <Text numberOfLines={1} style={styles.accountName}>{displayName}</Text>
                <Text numberOfLines={1} style={styles.accountEmail}>
                  {accountEmail || 'Email не указан'}
                </Text>
                <View style={styles.statusRow}>
                  <View style={styles.statusPill}>
                    <Ionicons name="checkmark-circle" size={13} color={colors.success} />
                    <Text style={styles.statusPillText}>Выполнен вход</Text>
                  </View>
                </View>
              </View>
            </View>

            {membershipLabel ? (
              <View style={styles.membershipBox}>
                <Ionicons name="shield-checkmark-outline" size={16} color={colors.textDim} />
                <Text style={styles.membershipText}>{membershipLabel}</Text>
              </View>
            ) : null}
          </GlassCard>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Безопасность</Text>
          <IOSGroup>
            <ListRow
              icon="🧭"
              title="Способ входа"
              rightText={authProviderLabel}
            />
            <ListRow icon="✉️" title="Email аккаунта" rightText={accountEmail || 'Не указан'} />
            {emailConfirmationLabel ? (
              <ListRow
                icon="✅"
                title="Подтверждение email"
                rightText={emailConfirmationLabel}
              />
            ) : null}
            <ListRow
              icon="🔑"
              title="Сменить пароль"
              subtitle={getPasswordRowSubtitle(authProvider, Boolean(accountEmail))}
              rightText={canRequestPasswordReset
                ? (isPasswordResetSending ? 'Отправляем' : 'Отправить')
                : 'Недоступно'}
              onPress={canRequestPasswordReset && !isPasswordResetSending ? handleChangePassword : undefined}
            />
            <ListRow
              icon="📵"
              title="Выйти со всех устройств"
              subtitle="Будет добавлено позже"
              rightText="Позже"
              onPress={handleSignOutEverywhere}
            />
            <ListRow
              danger
              icon="🗑️"
              title="Удалить аккаунт"
              subtitle="Только через безопасную серверную функцию"
              rightText="Позже"
              isLast
              onPress={handleDeleteAccount}
            />
          </IOSGroup>
          {passwordResetStatus ? <Text style={styles.infoText}>{passwordResetStatus}</Text> : null}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Текущая сессия</Text>
          <IOSGroup>
            <ListRow icon="🪪" title="ID пользователя" rightText={compactUserId(user.id)} />
            <ListRow
              icon="📱"
              title="Статус сессии"
              rightText="Активна"
              isLast
            />
          </IOSGroup>
        </View>

        {localError ? <Text style={styles.errorText}>{localError}</Text> : null}

        <Pressable
          disabled={isSigningOut}
          onPress={handleSignOut}
          style={({ pressed }) => [
            styles.signOutButton,
            isSigningOut && styles.signOutButtonDisabled,
            pressed && !isSigningOut && styles.signOutButtonPressed,
          ]}
        >
          <Ionicons name="log-out-outline" size={18} color={colors.danger} />
          <Text style={styles.signOutText}>{isSigningOut ? 'Выходим...' : 'Выйти'}</Text>
        </Pressable>
      </Screen>
    </>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: 18,
  },
  section: {
    gap: 9,
  },
  sectionTitle: {
    color: colors.textGhost,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0,
    marginLeft: 4,
    textTransform: 'uppercase',
  },
  accountHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  flex: {
    flex: 1,
    minWidth: 0,
  },
  accountName: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '800',
    lineHeight: 23,
  },
  accountEmail: {
    color: colors.textDim,
    fontSize: 13,
    lineHeight: 18,
    marginTop: 2,
  },
  statusRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 9,
  },
  statusPill: {
    minHeight: 26,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.accent.greenBorder,
    backgroundColor: colors.accent.greenBg,
    paddingHorizontal: 8,
  },
  statusPillText: {
    color: colors.success,
    fontSize: 12,
    fontWeight: '700',
    includeFontPadding: false,
  },
  membershipBox: {
    minHeight: 38,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.glass.w08,
    backgroundColor: colors.glass.w05,
    marginTop: 14,
    paddingHorizontal: 12,
  },
  membershipText: {
    flex: 1,
    color: colors.textMuted,
    fontSize: 13,
    fontWeight: '600',
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
  signOutButton: {
    minHeight: 46,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.accent.redBorder,
    backgroundColor: colors.accent.redBg,
    paddingHorizontal: 16,
    paddingVertical: 11,
  },
  signOutButtonPressed: {
    opacity: 0.78,
  },
  signOutButtonDisabled: {
    opacity: 0.55,
  },
  signOutText: {
    color: colors.danger,
    fontSize: 14,
    fontWeight: '800',
  },
  errorText: {
    color: colors.danger,
    fontSize: 13,
    lineHeight: 18,
    textAlign: 'center',
  },
  infoText: {
    color: colors.textDim,
    fontSize: 12,
    lineHeight: 17,
    textAlign: 'center',
  },
});
