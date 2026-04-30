import { Ionicons } from '@expo/vector-icons';
import { Link, useRouter } from 'expo-router';
import type { Href } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { GlassCard } from '@/components/glass/GlassCard';
import { Avatar } from '@/components/ui/Avatar';
import { HeaderButton, Logo } from '@/components/ui/BrandHeader';
import { FormField } from '@/components/ui/FormField';
import { IOSGroup } from '@/components/ui/IOSGroup';
import { ListRow } from '@/components/ui/ListRow';
import { PrimaryButton } from '@/components/ui/PrimaryButton';
import { Screen } from '@/components/ui/Screen';
import type { CommunityMembershipRole } from '@/services/inviteService';
import { useAuthStore } from '@/store/useAuthStore';
import { isActiveEventRegistration, useEventsStore } from '@/store/useEventsStore';
import { colors } from '@/theme/colors';

const myRegistrationsHref = '/profile/my-registrations' as Href;
const prayerTrackerHref = '/profile/prayer-tracker' as Href;
const editProfileHref = '/profile/edit' as Href;

const menuItems = [
  { href: '/profile/prayers-settings', icon: '📍', label: 'Настройки молитв и календаря', sub: 'Город, нусах, язык сидура, напоминания' },
  { href: prayerTrackerHref, icon: '🙏', label: 'Молитвенный трекер', sub: 'Личная история молитв, Шма и Омера' },
  { href: myRegistrationsHref, icon: '📅', label: 'Мои записи', sub: 'Ваши регистрации на события' },
  { href: '/profile/contacts-settings', icon: '👥', label: 'Контакты и дни рождения', sub: 'Синхронизация, еврейская дата, напоминания' },
  { href: '/profile/notifications', icon: '🔔', label: 'Уведомления', sub: 'Настройте, что и когда вам напоминать' },
  { href: '/profile/siddur', icon: '📖', label: 'Сидур', sub: 'Нусах, язык, шрифт и другие настройки' },
  { href: '/profile/support', icon: '❤️', label: 'Поддержать общину', sub: 'Ваш вклад в развитие общины' },
  { href: '/profile/about', icon: 'ℹ️', label: 'О приложении', sub: 'Версия, поддержка, политика конфиденциальности' },
] as const;

const roleTitles: Record<CommunityMembershipRole, string> = {
  member: 'Участник',
  event_manager: 'Менеджер событий',
  admin: 'Администратор',
};

type PendingAction = 'signIn' | 'invite' | 'signOut' | null;

function getInitials(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('') || 'СС';
}

export default function ProfileScreen() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const [localError, setLocalError] = useState<string | null>(null);

  const authUser = useAuthStore((state) => state.user);
  const profile = useAuthStore((state) => state.profile);
  const membership = useAuthStore((state) => state.membership);
  const loading = useAuthStore((state) => state.loading);
  const error = useAuthStore((state) => state.error);
  const loadSession = useAuthStore((state) => state.loadSession);
  const signIn = useAuthStore((state) => state.signIn);
  const signOut = useAuthStore((state) => state.signOut);
  const acceptInvite = useAuthStore((state) => state.acceptInvite);
  const loadEvents = useEventsStore((state) => state.loadEvents);
  const loadMyRegistrations = useEventsStore((state) => state.loadMyRegistrations);
  const myRegistrations = useEventsStore((state) => state.myRegistrations);
  const resetEventPrivateState = useEventsStore((state) => state.resetPrivateState);

  useEffect(() => {
    void loadSession().catch(() => undefined);
  }, [loadSession]);

  useEffect(() => {
    if (authUser?.email) {
      setEmail(authUser.email);
    }
  }, [authUser?.email]);

  useEffect(() => {
    if (!authUser) {
      return;
    }

    void loadMyRegistrations().catch(() => undefined);
  }, [authUser, loadMyRegistrations]);

  const profileName = useMemo(() => {
    const firstLastName = [profile?.first_name, profile?.last_name].filter(Boolean).join(' ');

    return profile?.display_name
      ?? (firstLastName || null)
      ?? profile?.full_name
      ?? null;
  }, [profile?.display_name, profile?.first_name, profile?.full_name, profile?.last_name]);

  const accountEmail = profile?.email ?? authUser?.email ?? '';
  const displayName = profileName ?? accountEmail.split('@')[0] ?? 'Гость';
  const isActiveMember = membership?.status === 'active';
  const isSigningIn = pendingAction === 'signIn' || (!authUser && loading);
  const isAcceptingInvite = pendingAction === 'invite';
  const isSigningOut = pendingAction === 'signOut';
  const visibleError = localError ?? error;
  const signInError = !authUser ? visibleError : null;
  const inviteError = localError?.startsWith('Не удалось принять приглашение') ? localError : null;
  const signOutError = localError?.startsWith('Не удалось выйти') ? localError : null;
  const activeRegistrationsCount = useMemo(
    () => myRegistrations.filter(isActiveEventRegistration).length,
    [myRegistrations],
  );

  const syncSignedInState = useCallback(async () => {
    await Promise.allSettled([
      loadEvents(),
      loadMyRegistrations(),
    ]);
  }, [loadEvents, loadMyRegistrations]);

  const handleSignIn = useCallback(async () => {
    setLocalError(null);
    setPendingAction('signIn');

    try {
      await signIn(email);
      await syncSignedInState();
    } catch {
      setLocalError('Не удалось войти. Проверьте email и попробуйте ещё раз.');
    } finally {
      setPendingAction(null);
    }
  }, [email, signIn, syncSignedInState]);

  const handleAcceptInvite = useCallback(async () => {
    setLocalError(null);
    setPendingAction('invite');

    try {
      await acceptInvite(inviteCode);
      await syncSignedInState();
      setInviteCode('');
    } catch {
      setLocalError('Не удалось принять приглашение. Проверьте код и попробуйте ещё раз.');
    } finally {
      setPendingAction(null);
    }
  }, [acceptInvite, inviteCode, syncSignedInState]);

  const handleSignOut = useCallback(async () => {
    setLocalError(null);
    setPendingAction('signOut');

    try {
      await signOut();
      resetEventPrivateState();
      await loadEvents();
      setInviteCode('');
    } catch {
      setLocalError('Не удалось выйти. Попробуйте ещё раз.');
    } finally {
      setPendingAction(null);
    }
  }, [loadEvents, resetEventPrivateState, signOut]);

  const handleOpenMyRegistrations = useCallback(() => {
    if (!authUser) {
      return;
    }

    router.push(myRegistrationsHref);
  }, [authUser, router]);

  const handleOpenEditProfile = useCallback(() => {
    if (!authUser) {
      return;
    }

    router.push(editProfileHref);
  }, [authUser, router]);

  return (
    <Screen contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <Logo />
        <HeaderButton icon="settings-outline" />
      </View>

      <View style={styles.titleBlock}>
        <Text style={styles.title}>Профиль</Text>
        <Text style={styles.subtitle}>Ваш доступ к событиям, записям и функциям общины.</Text>
      </View>

      {!authUser ? (
        <GlassCard>
          <View style={styles.cardHeader}>
            <Text style={styles.cardTitle}>Вход</Text>
            <Text style={styles.cardText}>Для локального MVP используется временный вход. Apple Sign-In будет позже.</Text>
          </View>

          <View style={styles.form}>
            <FormField
              label="Email"
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              placeholder="name@example.com"
            />
            <PrimaryButton title={isSigningIn ? 'Входим...' : 'Войти'} disabled={isSigningIn} onPress={handleSignIn} />
            {signInError ? <Text style={styles.errorText}>{signInError}</Text> : null}
          </View>
        </GlassCard>
      ) : (
        <GlassCard>
          <View style={styles.accountHeader}>
            <Avatar initials={getInitials(displayName)} size={58} />
            <View style={styles.flex}>
              <Text style={styles.cardTitle}>Аккаунт</Text>
              <Text style={styles.accountName}>{profileName ?? accountEmail}</Text>
              {profileName && accountEmail ? <Text style={styles.accountEmail}>{accountEmail}</Text> : null}
            </View>
          </View>

          {profile?.city ? (
            <View style={styles.infoRow}>
              <Ionicons name="location-outline" size={15} color={colors.textDim} />
              <Text style={styles.infoText}>{profile.city}</Text>
            </View>
          ) : null}

          <Pressable
            onPress={handleOpenEditProfile}
            style={({ pressed }) => [styles.editProfileButton, pressed && styles.pressed]}
          >
            <Ionicons name="create-outline" size={17} color={colors.orange} />
            <Text style={styles.editProfileText}>Редактировать профиль</Text>
          </Pressable>

          <Pressable
            disabled={isSigningOut}
            onPress={handleSignOut}
            style={({ pressed }) => [
              styles.signOutButton,
              isSigningOut && styles.buttonDisabled,
              pressed && !isSigningOut && styles.signOutPressed,
            ]}
          >
            <Ionicons name="log-out-outline" size={17} color={colors.danger} />
            <Text style={styles.signOutText}>{isSigningOut ? 'Выходим...' : 'Выйти'}</Text>
          </Pressable>

          {signOutError ? <Text style={styles.errorText}>{signOutError}</Text> : null}
        </GlassCard>
      )}

      {authUser ? (
        <GlassCard style={isActiveMember ? styles.memberCardActive : undefined}>
          <View style={styles.cardHeader}>
            <View style={styles.cardTitleRow}>
              <Text style={styles.cardTitle}>Община</Text>
              {isActiveMember ? (
                <View style={styles.activeBadge}>
                  <Text style={styles.activeBadgeText}>active</Text>
                </View>
              ) : null}
            </View>
          </View>

          {!isActiveMember ? (
            <View style={styles.form}>
              <View style={styles.statusLine}>
                <Ionicons name="lock-closed-outline" size={18} color={colors.orange} />
                <Text style={styles.statusText}>Доступ к общине не активирован</Text>
              </View>
              <Text style={styles.cardText}>Введите invite-код, чтобы открыть события и функции для участников.</Text>
              <FormField
                label="Invite-код"
                value={inviteCode}
                onChangeText={setInviteCode}
                placeholder="DEV-SREDI-2026"
              />
              <PrimaryButton
                title={isAcceptingInvite ? 'Проверяем...' : 'Принять приглашение'}
                disabled={isAcceptingInvite}
                onPress={handleAcceptInvite}
              />
              <Text style={styles.helperText}>Тестовый код: DEV-SREDI-2026</Text>
              {inviteError ? <Text style={styles.errorText}>{inviteError}</Text> : null}
            </View>
          ) : (
            <View style={styles.memberInfo}>
              <View style={styles.statusLine}>
                <Ionicons name="checkmark-circle" size={18} color={colors.success} />
                <Text style={styles.statusText}>Вы участник общины</Text>
              </View>
              <View style={styles.infoRow}>
                <Ionicons name="people-outline" size={15} color={colors.textDim} />
                <Text style={styles.infoText}>Среди Своих</Text>
              </View>
              <View style={styles.infoRow}>
                <Ionicons name="shield-checkmark-outline" size={15} color={colors.textDim} />
                <Text style={styles.infoText}>Роль: {roleTitles[membership.role]}</Text>
              </View>
            </View>
          )}
        </GlassCard>
      ) : null}

      <GlassCard style={[styles.bookingCard, !authUser && styles.bookingCardDisabled]}>
        <Pressable
          disabled={!authUser}
          onPress={handleOpenMyRegistrations}
          style={({ pressed }) => [styles.bookingPressable, pressed && styles.pressed]}
        >
          <View style={styles.bookingIcon}>
            <Ionicons name="calendar-outline" size={20} color={authUser ? colors.orange : colors.textDim} />
          </View>
          <View style={styles.flex}>
            <Text style={styles.bookingTitle}>Мои записи</Text>
            <Text style={styles.bookingSubtitle}>
              {authUser
                ? `Активных записей: ${activeRegistrationsCount}`
                : 'Войдите, чтобы увидеть свои записи'}
            </Text>
          </View>
          {authUser ? (
            <Ionicons name="chevron-forward" size={18} color="rgba(255,255,255,0.3)" />
          ) : (
            <Ionicons name="lock-closed-outline" size={18} color={colors.textDim} />
          )}
        </Pressable>
      </GlassCard>

      <IOSGroup>
        {menuItems.map((item, index) => (
          <Link key={item.label} href={item.href} asChild>
            <ListRow
              icon={item.icon}
              title={item.label}
              subtitle={item.sub}
              isLast={index === menuItems.length - 1}
              onPress={() => undefined}
            />
          </Link>
        ))}
      </IOSGroup>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: 16,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  titleBlock: {
    gap: 4,
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
    lineHeight: 18,
  },
  cardHeader: {
    gap: 6,
    marginBottom: 14,
  },
  cardTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  cardTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '700',
  },
  cardText: {
    color: colors.textDim,
    fontSize: 13,
    lineHeight: 18,
  },
  form: {
    gap: 12,
  },
  accountHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginBottom: 14,
  },
  accountName: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '700',
    lineHeight: 23,
    marginTop: 3,
  },
  accountEmail: {
    color: colors.textDim,
    fontSize: 13,
    lineHeight: 18,
    marginTop: 2,
  },
  flex: {
    flex: 1,
    minWidth: 0,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  infoText: {
    flex: 1,
    color: colors.textDim,
    fontSize: 13,
    lineHeight: 18,
  },
  editProfileButton: {
    minHeight: 42,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(240,122,42,0.25)',
    backgroundColor: 'rgba(240,122,42,0.10)',
    marginTop: 16,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  editProfileText: {
    color: colors.orange,
    fontSize: 14,
    fontWeight: '700',
  },
  signOutButton: {
    minHeight: 42,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.accent.redBorder,
    backgroundColor: colors.accent.redBg,
    marginTop: 16,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  signOutPressed: {
    opacity: 0.78,
  },
  buttonDisabled: {
    opacity: 0.55,
  },
  signOutText: {
    color: colors.danger,
    fontSize: 14,
    fontWeight: '700',
  },
  memberCardActive: {
    borderColor: colors.accent.greenBorder,
  },
  activeBadge: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.accent.greenBorder,
    backgroundColor: colors.accent.greenBg,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  activeBadgeText: {
    color: colors.success,
    fontSize: 11,
    fontWeight: '700',
    includeFontPadding: false,
  },
  statusLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  statusText: {
    flex: 1,
    color: colors.text,
    fontSize: 15,
    fontWeight: '700',
    lineHeight: 20,
  },
  memberInfo: {
    gap: 11,
  },
  helperText: {
    color: colors.textGhost,
    fontSize: 12,
    lineHeight: 17,
  },
  errorText: {
    color: colors.danger,
    fontSize: 12,
    lineHeight: 17,
  },
  bookingCard: {
    borderColor: 'rgba(240,122,42,0.20)',
    backgroundColor: 'rgba(240,122,42,0.06)',
  },
  bookingCardDisabled: {
    opacity: 0.72,
  },
  bookingPressable: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  bookingIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(240,122,42,0.25)',
    backgroundColor: 'rgba(240,122,42,0.15)',
  },
  bookingTitle: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '700',
  },
  bookingSubtitle: {
    color: colors.textDim,
    fontSize: 12,
    lineHeight: 17,
    marginTop: 3,
  },
  pressed: {
    opacity: 0.78,
  },
});
