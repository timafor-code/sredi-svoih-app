import { Stack } from 'expo-router';
import { Text, View } from 'react-native';
import { GlassCard } from '@/components/glass/GlassCard';
import { PrimaryButton } from '@/components/ui/PrimaryButton';
import { Screen } from '@/components/ui/Screen';
import { SectionTitle } from '@/components/ui/SectionTitle';

const upcoming = [
  { id: 'u1', title: 'Встреча с Игорем Маричем', date: '23 апреля, 19:00', status: 'Вы записаны', color: '#4CAF50' },
  { id: 'u2', title: 'Курс по недельной главе', date: 'Каждый вторник, 20:00', status: 'Активный курс', color: '#6B7FD4' },
];

const history = [
  { id: 'h1', title: 'Шахматный клуб', date: '15 апреля, 18:00', status: 'Завершено' },
  { id: 'h2', title: 'Воскресная школа', date: '7 апреля, 11:00', status: 'Завершено' },
];

export default function MyEventsScreen() {
  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: 'Мои записи', headerStyle: { backgroundColor: '#0D0D1A' }, headerTintColor: '#fff' }} />
      <Screen>
        <SectionTitle title="ПРЕДСТОЯЩИЕ" />
        {upcoming.map((item) => (
          <GlassCard key={item.id}>
            <Text style={{ color: '#fff', fontSize: 16, fontWeight: '700' }}>{item.title}</Text>
            <Text style={{ color: 'rgba(255,255,255,0.55)', marginVertical: 5 }}>{item.date}</Text>
            <Text style={{ color: item.color, marginBottom: 10 }}>{item.status}</Text>
            <PrimaryButton title="Открыть" />
          </GlassCard>
        ))}

        <SectionTitle title="ИСТОРИЯ" />
        {history.map((item) => (
          <GlassCard key={item.id}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: '#fff', fontSize: 16 }}>{item.title}</Text>
                <Text style={{ color: 'rgba(255,255,255,0.5)' }}>{item.date}</Text>
                <Text style={{ color: 'rgba(255,255,255,0.4)' }}>{item.status}</Text>
              </View>
              <PrimaryButton title="Открыть" />
            </View>
          </GlassCard>
        ))}
      </Screen>
    </>
  );
}
