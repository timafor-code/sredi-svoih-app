import { Link } from 'expo-router';
import { Text } from 'react-native';
import { Screen } from '@/components/ui/Screen';
import { GlassCard } from '@/components/glass/GlassCard';
import { ListRow } from '@/components/ui/ListRow';
import { useAuthStore } from '@/store/useAuthStore';

const items = [
  ['profile/edit', 'Редактировать профиль'],
  ['profile/prayers-settings', 'Настройки молитв и календаря'],
  ['profile/my-events', 'Мои записи на мероприятия'],
  ['profile/contacts-settings', 'Контакты и дни рождения'],
  ['profile/notifications', 'Уведомления'],
  ['profile/siddur', 'Сидур'],
  ['profile/support', 'Поддержать общину'],
  ['profile/about', 'О приложении'],
] as const;

export default function ProfileScreen() {
  const user = useAuthStore((s) => s.user);
  const signOut = useAuthStore((s) => s.signOut);
  return (
    <Screen>
      <GlassCard>
        <Text style={{ color: '#fff', fontSize: 24, fontWeight: '700' }}>{user?.name}</Text>
        <Text style={{ color: 'rgba(255,255,255,0.6)' }}>{user?.hebrewName}</Text>
        <Text style={{ color: 'rgba(255,255,255,0.6)' }}>{user?.city} · {user?.status}</Text>
      </GlassCard>
      <GlassCard>
        <Text style={{ color: '#fff', fontWeight: '700' }}>Ближайшая запись</Text>
        <Text style={{ color: 'rgba(255,255,255,0.6)' }}>Встреча с Игорем Маричем · 23 апреля</Text>
      </GlassCard>
      <GlassCard>
        {items.map(([href, label]) => <Link key={href} href={`/${href}` as never}><ListRow title={label} /></Link>)}
      </GlassCard>
      <Text onPress={signOut} style={{ color: '#ff5555', textAlign: 'center', fontWeight: '600' }}>Выйти</Text>
    </Screen>
  );
}
