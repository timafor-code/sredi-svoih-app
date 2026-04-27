import { Link } from 'expo-router';
import { Text, View } from 'react-native';
import { Screen } from '@/components/ui/Screen';
import { GlassCard } from '@/components/glass/GlassCard';
import { PrimaryButton } from '@/components/ui/PrimaryButton';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { mockContacts } from '@/data/mockContacts';

export default function HomeScreen() {
  return (
    <Screen>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Text style={{ color: '#fff', fontSize: 26, fontWeight: '700' }}>Среди Своих</Text>
        <Link href="/modals/omer" style={{ color: '#F6A400' }}>8-й день Омера</Link>
      </View>
      <Text style={{ color: '#fff', fontSize: 28, fontWeight: '700' }}>23 Нисана 5785</Text>
      <Text style={{ color: 'rgba(255,255,255,0.5)' }}>22 апреля 2026 · Москва (выбранный город)</Text>

      <GlassCard><Text style={{ color: '#fff', fontWeight: '700', marginBottom: 8 }}>Утреннее Шма до 09:48</Text><ProgressBar value={0.42} /><Text style={{ color: '#F6A400', marginTop: 6 }}>Осталось 1 ч 33 мин</Text></GlassCard>
      <GlassCard><Text style={{ color: '#fff', fontSize: 18, fontWeight: '700' }}>Встреча с Игорем Маричем</Text><Text style={{ color: 'rgba(255,255,255,0.55)', marginVertical: 6 }}>23 апреля, 19:00</Text><PrimaryButton title="Записаться" /></GlassCard>
      <GlassCard><Text style={{ color: '#fff', fontWeight: '700' }}>Сейчас · Шахарит до 09:48</Text><ProgressBar value={0.6} /></GlassCard>
      <GlassCard><Text style={{ color: '#fff', fontWeight: '700' }}>Недельная глава: Ахарей Мот</Text></GlassCard>
      <GlassCard><Text style={{ color: '#fff', fontWeight: '700' }}>Зажигание свечей: 19:52</Text></GlassCard>
      <GlassCard><Text style={{ color: '#F07A2A', fontWeight: '700' }}>Ближайший праздник: Шавуот (через 15 дней)</Text></GlassCard>
      <GlassCard>
        <Text style={{ color: '#fff', fontWeight: '700', marginBottom: 8 }}>Ближайшие дни рождения</Text>
        {mockContacts.map((c) => <Text key={c.id} style={{ color: 'rgba(255,255,255,0.7)', marginBottom: 4 }}>{c.name} · {c.nextBirthday}</Text>)}
      </GlassCard>
    </Screen>
  );
}
