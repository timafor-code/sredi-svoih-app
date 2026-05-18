import { Ionicons } from '@expo/vector-icons';
import { Link, useRouter } from 'expo-router';
import type { Href } from 'expo-router';
import type { ComponentProps } from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { AuthCard } from '@/components/auth/AuthCard';
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
const notificationsHref = '/profile/notifications' as Href;
const prayersSettingsHref = '/profile/prayers-settings' as Href;
const editProfileHref = '/profile/edit' as Href;
const onboardingHref = '/profile/onboarding' as Href;
const securityHref = '/profile/security' as Href;

type IoniconName = ComponentProps<typeof Ionicons>['name'];

type QuickActionItem = {
  href: Href;
  icon: IoniconName;
  lockedSubtitle: string;
  subtitle: string;
  title: string;
};

type MenuItem = {
  href: Href;
  icon: string;
  label: string;
  sub: string;
};

const quickActions: QuickActionItem[] = [
  {
    href: myRegistrationsHref,
    icon: 'calendar-outline',
    title: 'Мои записи',
    subtitle: 'Активные регистрации',
    lockedSubtitle: 'Войдите для доступа',
  },
  {
    href: prayerTrackerHref,
    icon: 'checkmark-done-outline',
    title: 'Молитвенный трекер',
    subtitle: 'Личная практика',
    lockedSubtitle: 'Войдите для истории',
  },
  {
    href: notificationsHref,
    icon: 'notifications-outline',
    title: 'Уведомления',
    subtitle: 'Напоминания и события',
    lockedSubtitle: 'Войдите для настроек',
  },
  {
    href: prayersSettingsHref,
    icon: 'sparkles-outline',
    title: 'Молитвы и календарь',
    subtitle: 'Город, нусах, язык',
    lockedSubtitle: 'Войдите для настроек',
  },
];

const menuSections: { title: string; items: MenuItem[] }[] = [
  {
    title: 'Личное',
    items: [
      {
        href: editProfileHref,
        icon: '👤',
        label: 'Редактировать профиль',
        sub: 'Имя, город, аватар и публичные данные',
      },
      {
        href: securityHref,
        icon: '🔐',
        label: 'Аккаунт и безопасность',
        sub: 'Email, сессия и будущие настройки входа',
      },
      {
        href: notificationsHref,
        icon: '🔔',
        label: 'Уведомления',
        sub: 'Настройте, что и когда вам напоминать',
      },
    ],
  },
  {
    title: 'Практика',
    items: [
      {
        href: prayersSettingsHref,
        icon: '📍',
        label: 'Молитвы и календарь',
        sub: 'Город, нусах, язык сидура, напоминания',
      },
      {
        href: prayerTrackerHref,
        icon: '🙏',
        label: 'Молитвенный трекер',
        sub: 'Личная история молитв, Шма и Омера',
      },
      {
        href: '/profile/siddur' as Href,
        icon: '📖',
        label: 'Сидур',
        sub: 'Нусах, язык, шрифт и другие настройки',
      },
    ],
  },
  {
    title: 'Община',
    items: [
      {
        href: myRegistrationsHref,
        icon: '📅',
        label: 'Мои записи',
        sub: 'Ваши регистрации на события',
      },
      {
        href: '/profile/support' as Href,
        icon: '❤️',
        label: 'Поддержать общину',
        sub: 'Ваш вклад в развитие общины',
      },
      {
        href: '/profile/about' as Href,
        icon: 'ℹ️',
        label: 'О приложении',
        sub: 'Версия, поддержка, политика конфиденциальности',
      },
    ],
  },
];

const roleTitles: Record<CommunityMembershipRole, string> = {
  member: 'Участник',
  event_manager: 'Менеджер событий',
  admin: 'Администратор',
  rabbi: 'Раввин',
};

type PendingAction = 'invite' | 'signOut' | null;

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
  const [inviteCode, setInviteCode] = useState('');
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const [localError, setLocalError] = useState<string | null>(null);

  const authUser = useAuthStore((state) => state.user);
  const profile = useAuthStore((state) => state.profile);
  const membership = useAuthStore((state) => state.membership);
  const loadSession = useAuthStore((state) => state.loadSession);
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
  const displayName = profileName ?? (accountEmail ? accountEmail.split('@')[0] : 'Гость');
  const isActiveMember = membership?.status === 'active';
  const membershipStatusLabel = isActiveMember ? 'Участник общины' : 'Доступ не активирован';
  const membershipRoleLabel = isActiveMember ? roleTitles[membership.role] : null;
  const isAcceptingInvite = pendingAction === 'invite';
  const isSigningOut = pendingAction === 'signOut';
  const needsProfileOnboarding = Boolean(authUser && profile && profile.onboarding_completed !== true);
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

  const handleOpenEditProfile = useCallback(() => {
    if (!authUser) {
      return;
    }

    router.push(editProfileHref);
  }, [authUser, router]);

  const handleOpenProfileOnboarding = useCallback(() => {
    if (!authUser || !profile) {
      return;
    }

    router.push(onboardingHref);
  }, [authUser, profile, router]);

  const handleOpenSecurity = useCallback(() => {
    router.push(securityHref);
  }, [router]);

  const handleOpenQuickAction = useCallback((href: Href) => {
    if (!authUser) {
      return;
    }

    router.push(href);
  }, [authUser, router]);

  return (
    <Screen contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <Logo />
        <HeaderButton
          accessibilityLabel="Аккаунт и безопасность"
          icon="settings-outline"
          onPress={handleOpenSecurity}
        />
      </View>

      <View style={styles.titleBlock}>
        <Text style={styles.title}>Профиль</Text>
        <Text style={styles.subtitle}>
          Личный кабинет для профиля, записей, молитвенной практики и настроек общины.
        </Text>
      </View>

      {!authUser ? (
        <AuthCard onSignedIn={syncSignedInState} />
      ) : (
        <GlassCard style={styles.heroCard}>
          <View style={styles.accountHeader}>
            <Avatar initials={getInitials(displayName)} size={64} uri={profile?.avatar_url} />
            <View style={styles.flex}>
              <Text numberOfLines={1} style={styles.accountName}>{displayName}</Text>
              <Text numberOfLines={1} style={styles.accountEmail}>
                {accountEmail || 'Email не указан'}
              </Text>
              {profile?.city ? (
                <View style={styles.accountMetaLine}>
                  <Ionicons name="location-outline" size={14} color={colors.textDim} />
                  <Text numberOfLines={1} style={styles.accountMetaText}>{profile.city}</Text>
                </View>
              ) : null}
            </View>
            <Pressable
              accessibilityLabel="Аккаунт и безопасность"
              onPress={handleOpenSecurity}
              style={({ pressed }) => [styles.securityIconButton, pressed && styles.pressed]}
            >
              <Ionicons name="settings-outline" size={18} color={colors.textSecondary} />
            </Pressable>
          </View>

          <View style={styles.heroStatusRow}>
            <View style={[styles.statusPill, isActiveMember ? styles.statusPillActive : styles.statusPillLocked]}>
              <Ionicons
                name={isActiveMember ? 'checkmark-circle' : 'lock-closed-outline'}
                size={13}
                color={isActiveMember ? colors.success : colors.orange}
              />
              <Text style={[styles.statusPillText, isActiveMember ? styles.statusPillTextActive : styles.statusPillTextLocked]}>
                {membershipStatusLabel}
              </Text>
            </View>
            {membershipRoleLabel ? (
              <View style={styles.rolePill}>
                <Ionicons name="shield-checkmark-outline" size={13} color={colors.textMuted} />
                <Text style={styles.rolePillText}>{membershipRoleLabel}</Text>
              </View>
            ) : null}
          </View>

          <View style={styles.heroActions}>
            <Pressable
              onPress={handleOpenEditProfile}
              style={({ pressed }) => [styles.editProfileButton, pressed && styles.pressed]}
            >
              <Ionicons name="create-outline" size={17} color={colors.orange} />
              <Text style={styles.editProfileText}>Редактировать</Text>
            </Pressable>
            <Pressable
              disabled={isSigningOut}
              onPress={handleSignOut}
              style={({ pressed }) => [
                styles.signOutLink,
                isSigningOut && styles.buttonDisabled,
                pressed && !isSigningOut && styles.pressed,
              ]}
            >
              <Ionicons name="log-out-outline" size={16} color={colors.textGhost} />
              <Text style={styles.signOutLinkText}>{isSigningOut ? 'Выходим...' : 'Выйти'}</Text>
            </Pressable>
          </View>

          {signOutError ? <Text style={styles.errorText}>{signOutError}</Text> : null}
        </GlassCard>
      )}

      {needsProfileOnboarding ? (
        <GlassCard style={styles.onboardingCard}>
          <View style={styles.onboardingHeader}>
            <View style={styles.onboardingIcon}>
              <Ionicons name="person-circle-outline" size={22} color={colors.orange} />
            </View>
            <View style={styles.flex}>
              <Text style={styles.cardTitle}>Завершите профиль</Text>
              <Text style={styles.cardText}>
                Заполните имя, город и нусах, чтобы приложение точнее показывало настройки и личные сценарии.
              </Text>
            </View>
          </View>
          <PrimaryButton
            title="Завершить профиль"
            buttonStyle={styles.onboardingButton}
            onPress={handleOpenProfileOnboarding}
          />
        </GlassCard>
      ) : null}

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Быстрые действия</Text>
        <View style={styles.quickActionsGrid}>
          {quickActions.map((item) => {
            const disabled = !authUser;
            const isRegistrations = item.href === myRegistrationsHref;
            const subtitle = disabled
              ? item.lockedSubtitle
              : isRegistrations
                ? `Активных записей: ${activeRegistrationsCount}`
                : item.subtitle;

            return (
              <Pressable
                key={item.title}
                disabled={disabled}
                onPress={() => handleOpenQuickAction(item.href)}
                style={({ pressed }) => [
                  styles.quickActionCard,
                  disabled && styles.quickActionCardDisabled,
                  pressed && !disabled && styles.quickActionCardPressed,
                ]}
              >
                <View style={[styles.quickActionIcon, disabled && styles.quickActionIconDisabled]}>
                  <Ionicons name={disabled ? 'lock-closed-outline' : item.icon} size={20} color={disabled ? colors.textDim : colors.orange} />
                </View>
                <Text numberOfLines={2} style={styles.quickActionTitle}>{item.title}</Text>
                <Text numberOfLines={2} style={styles.quickActionSubtitle}>{subtitle}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      {authUser ? (
        <GlassCard style={isActiveMember ? styles.memberCardActive : undefined}>
          {!isActiveMember ? (
            <View style={styles.form}>
              <View style={styles.communityHeader}>
                <View style={styles.communityIconLocked}>
                  <Ionicons name="people-outline" size={20} color={colors.orange} />
                </View>
                <View style={styles.flex}>
                  <Text style={styles.cardTitle}>Присоединиться к общине</Text>
                  <Text style={styles.cardText}>
                    Введите invite-код, чтобы открыть события и функции для участников.
                  </Text>
                </View>
              </View>
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
              <View style={styles.communityHeader}>
                <View style={styles.communityIconActive}>
                  <Ionicons name="checkmark-circle" size={20} color={colors.success} />
                </View>
                <View style={styles.flex}>
                  <Text style={styles.cardTitle}>Община Среди Своих</Text>
                  <Text style={styles.cardText}>Ваш доступ активирован.</Text>
                </View>
              </View>
              <View style={styles.communityDetails}>
                <View style={styles.infoRow}>
                  <Ionicons name="people-outline" size={15} color={colors.textDim} />
                  <Text style={styles.infoText}>Статус: Участник общины</Text>
                </View>
                <View style={styles.infoRow}>
                  <Ionicons name="shield-checkmark-outline" size={15} color={colors.textDim} />
                  <Text style={styles.infoText}>Роль: {roleTitles[membership.role]}</Text>
                </View>
              </View>
            </View>
          )}
        </GlassCard>
      ) : null}

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Все разделы</Text>
        {menuSections.map((section) => (
          <View key={section.title} style={styles.menuSection}>
            <Text style={styles.menuSectionTitle}>{section.title}</Text>
            <IOSGroup>
              {section.items.map((item, index) => (
                <Link key={item.label} href={item.href} asChild>
                  <ListRow
                    icon={item.icon}
                    title={item.label}
                    subtitle={item.sub}
                    isLast={index === section.items.length - 1}
                    onPress={() => undefined}
                  />
                </Link>
              ))}
            </IOSGroup>
          </View>
        ))}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: 18,
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
  heroCard: {
    borderColor: colors.borderStrong,
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
    marginTop: 4,
  },
  form: {
    gap: 12,
  },
  onboardingCard: {
    borderColor: colors.accent.orangeBorder,
  },
  onboardingHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    marginBottom: 14,
  },
  onboardingIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.accent.orangeBorder,
    backgroundColor: colors.accent.orangeBg,
  },
  onboardingButton: {
    minHeight: 44,
  },
  accountHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 13,
  },
  accountName: {
    color: colors.text,
    fontSize: 19,
    fontWeight: '800',
    lineHeight: 24,
  },
  accountEmail: {
    color: colors.textDim,
    fontSize: 13,
    lineHeight: 18,
    marginTop: 2,
  },
  accountMetaLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 5,
  },
  accountMetaText: {
    flex: 1,
    color: colors.textDim,
    fontSize: 12,
    lineHeight: 16,
  },
  securityIconButton: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.glass.w10,
    backgroundColor: colors.glass.w07,
  },
  flex: {
    flex: 1,
    minWidth: 0,
  },
  heroStatusRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 16,
  },
  statusPill: {
    minHeight: 28,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 9,
  },
  statusPillActive: {
    borderColor: colors.accent.greenBorder,
    backgroundColor: colors.accent.greenBg,
  },
  statusPillLocked: {
    borderColor: colors.accent.orangeBorder,
    backgroundColor: colors.accent.orangeBg,
  },
  statusPillText: {
    fontSize: 12,
    fontWeight: '800',
    includeFontPadding: false,
  },
  statusPillTextActive: {
    color: colors.success,
  },
  statusPillTextLocked: {
    color: colors.orange,
  },
  rolePill: {
    minHeight: 28,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.glass.w10,
    backgroundColor: colors.glass.w06,
    paddingHorizontal: 9,
  },
  rolePillText: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '700',
    includeFontPadding: false,
  },
  heroActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 16,
  },
  editProfileButton: {
    minHeight: 40,
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.accent.orangeBorder,
    backgroundColor: colors.accent.orangeBg,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  editProfileText: {
    color: colors.orange,
    fontSize: 14,
    fontWeight: '800',
  },
  signOutLink: {
    minHeight: 40,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.glass.w08,
    backgroundColor: colors.glass.w04,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  signOutLinkText: {
    color: colors.textGhost,
    fontSize: 13,
    fontWeight: '700',
  },
  buttonDisabled: {
    opacity: 0.55,
  },
  section: {
    gap: 10,
  },
  sectionTitle: {
    color: colors.textGhost,
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0,
    marginLeft: 4,
    textTransform: 'uppercase',
  },
  quickActionsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  quickActionCard: {
    width: '48%',
    minHeight: 128,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.glass.w06,
    padding: 13,
  },
  quickActionCardPressed: {
    opacity: 0.82,
    transform: [{ scale: 0.98 }],
  },
  quickActionCardDisabled: {
    opacity: 0.64,
  },
  quickActionIcon: {
    width: 36,
    height: 36,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.accent.orangeBorder,
    backgroundColor: colors.accent.orangeBg,
    marginBottom: 12,
  },
  quickActionIconDisabled: {
    borderColor: colors.glass.w10,
    backgroundColor: colors.glass.w06,
  },
  quickActionTitle: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '800',
    lineHeight: 18,
  },
  quickActionSubtitle: {
    color: colors.textDim,
    fontSize: 12,
    lineHeight: 16,
    marginTop: 5,
  },
  communityHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  communityIconLocked: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.accent.orangeBorder,
    backgroundColor: colors.accent.orangeBg,
  },
  communityIconActive: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.accent.greenBorder,
    backgroundColor: colors.accent.greenBg,
  },
  memberCardActive: {
    borderColor: colors.accent.greenBorder,
  },
  memberInfo: {
    gap: 14,
  },
  communityDetails: {
    gap: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.glass.w08,
    backgroundColor: colors.glass.w04,
    padding: 12,
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
  menuSection: {
    gap: 8,
  },
  menuSectionTitle: {
    color: colors.textMuted,
    fontSize: 13,
    fontWeight: '800',
    marginLeft: 4,
  },
  pressed: {
    opacity: 0.78,
  },
});
