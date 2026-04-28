import { Ionicons } from '@expo/vector-icons';
import { Link } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { GlassCard } from '@/components/glass/GlassCard';
import { Avatar } from '@/components/ui/Avatar';
import { HeaderButton, Logo } from '@/components/ui/BrandHeader';
import { FormField } from '@/components/ui/FormField';
import { IOSGroup } from '@/components/ui/IOSGroup';
import { ListRow } from '@/components/ui/ListRow';
import { PrimaryButton } from '@/components/ui/PrimaryButton';
import { Screen } from '@/components/ui/Screen';
import { useAuthStore } from '@/store/useAuthStore';
import { colors } from '@/theme/colors';

const menuItems = [
  { href: '/profile/prayers-settings', icon: '📍', label: 'Настройки молитв и календаря', sub: 'Город, нусах, язык сидура, напоминания' },
  { href: '/profile/my-events', icon: '📅', label: 'Мои записи на мероприятия', sub: 'Ваши записи и билеты' },
  { href: '/profile/contacts-settings', icon: '👥', label: 'Контакты и дни рождения', sub: 'Синхронизация, еврейская дата, напоминания' },
  { href: '/profile/notifications', icon: '🔔', label: 'Уведомления', sub: 'Настройте, что и когда вам напоминать' },
  { href: '/profile/siddur', icon: '📖', label: 'Сидур', sub: 'Нусах, язык, шрифт и другие настройки' },
  { href: '/profile/support', icon: '❤️', label: 'Поддержать общину', sub: 'Ваш вклад в развитие общины' },
  { href: '/profile/about', icon: 'ℹ️', label: 'О приложении', sub: 'Версия, поддержка, политика конфиденциальности' },
] as const;

function getInitials(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('') || 'СС';
}

export default function ProfileScreen() {
  const [email, setEmail] = useState('');
  const [inviteCode, setInviteCode] = useState('');

  const authUser = useAuthStore((state) => state.user);
  const profile = useAuthStore((state) => state.profile);
  const membership = useAuthStore((state) => state.membership);
  const loading = useAuthStore((state) => state.loading);
  const error = useAuthStore((state) => state.error);
  const loadSession = useAuthStore((state) => state.loadSession);
  const signIn = useAuthStore((state) => state.signIn);
  const signOut = useAuthStore((state) => state.signOut);
  const acceptInvite = useAuthStore((state) => state.acceptInvite);

  useEffect(() => {
    void loadSession().catch(() => undefined);
  }, [loadSession]);

  useEffect(() => {
    if (authUser?.email) {
      setEmail(authUser.email);
    }
  }, [authUser?.email]);

  const displayName = useMemo(() => {
    return profile?.display_name
      ?? profile?.full_name
      ?? authUser?.email?.split('@')[0]
      ?? 'Гость';
  }, [authUser?.email, profile?.display_name, profile?.full_name]);

  const memberStatus = membership?.status === 'active'
    ? 'Участник общины'
    : authUser
      ? 'Приглашение не принято'
      : 'Нужен вход';

  const handleSignIn = useCallback(async () => {
    try {
      await signIn(email);
      Alert.alert('Вход выполнен', 'Теперь можно принять приглашение или записаться на событие.');
    } catch (error) {
      Alert.alert('Не удалось войти', error instanceof Error ? error.message : 'Попробуйте ещё раз.');
    }
  }, [email, signIn]);

  const handleAcceptInvite = useCallback(async () => {
    try {
      await acceptInvite(inviteCode);
      setInviteCode('');
      Alert.alert('Приглашение принято', 'Теперь вы участник общины.');
    } catch (error) {
      Alert.alert('Не удалось принять приглашение', error instanceof Error ? error.message : 'Проверьте код и попробуйте ещё раз.');
    }
  }, [acceptInvite, inviteCode]);

  const handleSignOut = useCallback(async () => {
    try {
      await signOut();
      setInviteCode('');
    } catch (error) {
      Alert.alert('Не удалось выйти', error instanceof Error ? error.message : 'Попробуйте ещё раз.');
    }
  }, [signOut]);

  return (
    <Screen>
      <View style={styles.header}>
        <Logo />
        <HeaderButton icon="settings-outline" />
      </View>

      <View>
        <Text style={styles.title}>Профиль</Text>
        <Text style={styles.subtitle}>Личные настройки и община</Text>
      </View>

      <GlassCard>
        <Link href="/profile/edit" asChild>
          <Pressable disabled={!authUser} style={({ pressed }) => [pressed && styles.pressed]}>
            <View style={styles.userHeader}>
              <View style={styles.avatarWrap}>
                <Avatar initials={getInitials(displayName)} size={64} />
                <View style={styles.cameraBadge}>
                  <Text style={styles.cameraText}>📷</Text>
                </View>
              </View>
              <View style={styles.flex}>
                <View style={styles.userTitleRow}>
                  <View style={styles.flex}>
                    <Text style={styles.userName}>{displayName}</Text>
                    {profile?.hebrew_name ? <Text style={styles.hebrew}>{profile.hebrew_name}</Text> : null}
                    <View style={styles.locationLine}>
                      <Ionicons name="location" size={11} color={colors.textDim} />
                      <Text style={styles.mutedSmall}>{profile?.city ?? 'Москва'} · Среди Своих</Text>
                    </View>
                  </View>
                  <Ionicons name="chevron-forward" size={16} color="rgba(255,255,255,0.28)" />
                </View>
              </View>
            </View>
          </Pressable>
        </Link>

        <View style={styles.memberBadge}>
          <Text style={styles.memberBadgeText}>{memberStatus}</Text>
        </View>

        <Link href="/profile/edit" asChild>
          <PrimaryButton title="Редактировать профиль →" disabled={!authUser} />
        </Link>
      </GlassCard>

      <GlassCard style={styles.authCard}>
        <View style={styles.authHeader}>
          <Text style={styles.authTitle}>Вход и приглашение</Text>
          {authUser?.email ? <Text style={styles.authEmail}>{authUser.email}</Text> : null}
        </View>

        {!authUser ? (
          <View style={styles.authForm}>
            <FormField
              label="Email"
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              placeholder="name@example.com"
            />
            <PrimaryButton title={loading ? 'Входим…' : 'Войти'} disabled={loading} onPress={handleSignIn} />
            <Text style={styles.helperText}>Для локального MVP используется временный вход. Apple Sign-In будет позже.</Text>
          </View>
        ) : !membership ? (
          <View style={styles.authForm}>
            <FormField
              label="Код приглашения"
              value={inviteCode}
              onChangeText={setInviteCode}
              placeholder="DEV-SREDI-2026"
            />
            <PrimaryButton title={loading ? 'Проверяем…' : 'Принять приглашение'} disabled={loading} onPress={handleAcceptInvite} />
            <Text style={styles.helperText}>Тестовый код для локальной проверки: DEV-SREDI-2026</Text>
            <Pressable onPress={handleSignOut} style={({ pressed }) => [styles.inlineSignOut, pressed && styles.signOutPressed]}>
              <Ionicons name="log-out-outline" size={15} color={colors.danger} />
              <Text style={styles.signOutText}>Выйти</Text>
            </Pressable>
          </View>
        ) : (
          <View style={styles.authForm}>
            <View style={styles.statusLine}>
              <Ionicons name="checkmark-circle" size={18} color={colors.success} />
              <Text style={styles.statusText}>Вы участник общины</Text>
            </View>
            <Text style={styles.roleText}>Роль: {membership.role}</Text>
            <PrimaryButton title={loading ? 'Выходим…' : 'Выйти'} disabled={loading} onPress={handleSignOut} />
          </View>
        )}

        {error ? <Text style={styles.errorText}>{error}</Text> : null}
      </GlassCard>

      <GlassCard style={styles.bookingCard}>
        <View style={styles.bookingHeader}>
          <Text style={styles.bookingHeaderText}>Мои ближайшие записи</Text>
          <Ionicons name="chevron-forward" size={16} color="rgba(255,255,255,0.3)" />
        </View>
        <View style={styles.bookingBody}>
          <View style={styles.bookingIcon}>
            <Text style={styles.bookingEmoji}>📅</Text>
          </View>
          <View style={styles.flex}>
            <Text style={styles.bookingTitle}>Встреча с Игорем Маричем</Text>
            <View style={styles.locationLine}>
              <Ionicons name="calendar-outline" size={10} color={colors.textDim} />
              <Text style={styles.mutedSmall}>23 апреля, 19:00</Text>
            </View>
            <View style={styles.locationLine}>
              <Ionicons name="checkmark" size={10} color={colors.success} />
              <Text style={styles.successText}>Вы записаны</Text>
            </View>
          </View>
          <PrimaryButton title="Открыть →" buttonStyle={styles.openButton} textStyle={styles.openButtonText} />
        </View>
      </GlassCard>

      <IOSGroup>
        {menuItems.map((item, index) => (
          <Link key={item.href} href={item.href} asChild>
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
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
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
    marginTop: 2,
  },
  userHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginBottom: 14,
  },
  avatarWrap: {
    position: 'relative',
  },
  cameraBadge: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: colors.glass.w16,
    backgroundColor: 'rgba(30,30,50,0.95)',
  },
  cameraText: {
    fontSize: 11,
  },
  flex: {
    flex: 1,
    minWidth: 0,
  },
  userTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  userName: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '700',
  },
  hebrew: {
    color: colors.textGhost,
    fontSize: 13,
    fontStyle: 'italic',
    marginTop: 2,
  },
  locationLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 4,
  },
  mutedSmall: {
    color: colors.textDim,
    fontSize: 12,
  },
  memberBadge: {
    alignSelf: 'flex-start',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.accent.orangeBorder,
    backgroundColor: colors.accent.orangeBg,
    paddingHorizontal: 10,
    paddingVertical: 4,
    marginBottom: 14,
  },
  memberBadgeText: {
    color: colors.orange,
    fontSize: 12,
    fontWeight: '700',
  },
  authCard: {
    borderColor: colors.glass.w16,
  },
  authHeader: {
    gap: 3,
    marginBottom: 14,
  },
  authTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '700',
  },
  authEmail: {
    color: colors.textDim,
    fontSize: 12,
  },
  authForm: {
    gap: 12,
  },
  helperText: {
    color: colors.textGhost,
    fontSize: 12,
    lineHeight: 17,
  },
  statusLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  statusText: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '700',
  },
  roleText: {
    color: colors.textDim,
    fontSize: 13,
  },
  errorText: {
    color: colors.red,
    fontSize: 12,
    lineHeight: 17,
    marginTop: 12,
  },
  inlineSignOut: {
    minHeight: 36,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderRadius: 12,
  },
  bookingCard: {
    borderColor: 'rgba(240,122,42,0.20)',
    backgroundColor: 'rgba(240,122,42,0.06)',
  },
  bookingHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  bookingHeaderText: {
    color: colors.textMuted,
    fontSize: 13,
    fontWeight: '700',
  },
  bookingBody: {
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
  bookingEmoji: {
    fontSize: 18,
  },
  bookingTitle: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '700',
  },
  successText: {
    color: colors.success,
    fontSize: 11,
  },
  openButton: {
    minHeight: 34,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  openButtonText: {
    fontSize: 13,
  },
  signOutPressed: {
    backgroundColor: 'rgba(255,60,60,0.06)',
  },
  signOutText: {
    color: colors.danger,
    fontSize: 15,
    fontWeight: '600',
  },
  pressed: {
    opacity: 0.78,
  },
});
