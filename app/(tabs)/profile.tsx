import { Ionicons } from '@expo/vector-icons';
import { Link } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { GlassCard } from '@/components/glass/GlassCard';
import { Avatar } from '@/components/ui/Avatar';
import { HeaderButton, Logo } from '@/components/ui/BrandHeader';
import { IOSGroup } from '@/components/ui/IOSGroup';
import { ListRow } from '@/components/ui/ListRow';
import { PrimaryButton } from '@/components/ui/PrimaryButton';
import { Screen } from '@/components/ui/Screen';
import { colors } from '@/theme/colors';
import { useAuthStore } from '@/store/useAuthStore';

const menuItems = [
  { href: '/profile/prayers-settings', icon: '📍', label: 'Настройки молитв и календаря', sub: 'Город, нусах, язык сидура, напоминания' },
  { href: '/profile/my-events', icon: '📅', label: 'Мои записи на мероприятия', sub: 'Ваши записи и билеты' },
  { href: '/profile/contacts-settings', icon: '👥', label: 'Контакты и дни рождения', sub: 'Синхронизация, еврейская дата, напоминания' },
  { href: '/profile/notifications', icon: '🔔', label: 'Уведомления', sub: 'Настройте, что и когда вам напоминать' },
  { href: '/profile/siddur', icon: '📖', label: 'Сидур', sub: 'Нусах, язык, шрифт и другие настройки' },
  { href: '/profile/support', icon: '❤️', label: 'Поддержать общину', sub: 'Ваш вклад в развитие общины' },
  { href: '/profile/about', icon: 'ℹ️', label: 'О приложении', sub: 'Версия, поддержка, политика конфиденциальности' },
] as const;

export default function ProfileScreen() {
  const user = useAuthStore((state) => state.user);
  const signOut = useAuthStore((state) => state.signOut);

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
          <Pressable style={({ pressed }) => [pressed && styles.pressed]}>
            <View style={styles.userHeader}>
              <View style={styles.avatarWrap}>
                <Avatar initials={user?.initials ?? 'ДК'} size={64} />
                <View style={styles.cameraBadge}>
                  <Text style={styles.cameraText}>📷</Text>
                </View>
              </View>
              <View style={styles.flex}>
                <View style={styles.userTitleRow}>
                  <View style={styles.flex}>
                    <Text style={styles.userName}>{user?.name ?? 'Давид Коэн'}</Text>
                    <Text style={styles.hebrew}>{user?.hebrewName ?? 'דוד בן אברהם'}</Text>
                    <View style={styles.locationLine}>
                      <Ionicons name="location" size={11} color={colors.textDim} />
                      <Text style={styles.mutedSmall}>{user?.city ?? 'Москва'} · {user?.community ?? 'Среди Своих'}</Text>
                    </View>
                  </View>
                  <Ionicons name="chevron-forward" size={16} color="rgba(255,255,255,0.28)" />
                </View>
              </View>
            </View>
          </Pressable>
        </Link>

        <View style={styles.memberBadge}>
          <Text style={styles.memberBadgeText}>{user?.status ?? 'Участник общины'}</Text>
        </View>

        <Link href="/profile/edit" asChild>
          <PrimaryButton title="Редактировать профиль →" />
        </Link>
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

      <Pressable onPress={signOut} style={({ pressed }) => [styles.signOut, pressed && styles.signOutPressed]}>
        <Ionicons name="log-out-outline" size={16} color={colors.danger} />
        <Text style={styles.signOutText}>Выйти из аккаунта</Text>
      </Pressable>
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
    letterSpacing: -0.5,
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
  signOut: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 14,
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
