import { Stack, useLocalSearchParams } from 'expo-router';
import { Text, View } from 'react-native';
import { Screen } from '@/components/ui/Screen';
import { GlassCard } from '@/components/glass/GlassCard';
import { mockContacts } from '@/data/mockContacts';

export default function ContactDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const c = mockContacts.find((x) => x.id === id) ?? mockContacts[0];
  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: c.name, headerStyle: { backgroundColor: '#0D0D1A' }, headerTintColor: '#fff' }} />
      <Screen>
        <GlassCard>
          <Text style={{ color: '#fff', fontSize: 24, fontWeight: '700' }}>{c.name}</Text>
          <Text style={{ color: 'rgba(255,255,255,0.6)' }}>{c.hebrewName}</Text>
          <Text style={{ color: 'rgba(255,255,255,0.6)' }}>{c.role} · {c.city}</Text>
        </GlassCard>
        <GlassCard><Text style={{ color: '#fff' }}>Телефон: {c.phone}</Text><Text style={{ color: '#fff' }}>Email: {c.email}</Text></GlassCard>
        <GlassCard><Text style={{ color: '#fff' }}>Дата рождения: {c.dobGregorian}</Text><Text style={{ color: '#fff' }}>Еврейская: {c.dobHebrew}</Text><Text style={{ color: '#fff' }}>Происхождение: {c.tribe}</Text></GlassCard>
        <GlassCard><Text style={{ color: '#F6A400' }}>Следующий еврейский день рождения: {c.nextBirthday}</Text></GlassCard>
      </Screen>
    </>
  );
}
