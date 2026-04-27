import { Text, View } from 'react-native';
import { Screen } from '@/components/ui/Screen';
import { GlassCard } from '@/components/glass/GlassCard';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { mockZmanim } from '@/data/mockZmanim';

export default function PrayersScreen() {
  return (
    <Screen>
      <Text style={{ color: '#fff', fontSize: 28, fontWeight: '700' }}>Молитвы и зманим</Text>
      <Text style={{ color: 'rgba(255,255,255,0.55)' }}>Москва · по выбранному городу, не по GPS</Text>
      <GlassCard><Text style={{ color: '#fff', marginBottom: 8 }}>Шкала дня</Text><ProgressBar value={0.18} /></GlassCard>
      <GlassCard><Text style={{ color: '#fff' }}>Шахарит · 06:05–09:48 (завершена)</Text></GlassCard>
      <GlassCard><Text style={{ color: '#F07A2A', fontWeight: '700' }}>Минха · 13:20–19:52 (сейчас)</Text><ProgressBar value={0.18} /></GlassCard>
      <GlassCard><Text style={{ color: '#fff' }}>Маарив · 20:10–23:59</Text></GlassCard>
      <GlassCard>{mockZmanim.map((z) => <View key={z[0]} style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 }}><Text style={{ color: 'rgba(255,255,255,0.7)' }}>{z[0]}</Text><Text style={{ color: '#fff' }}>{z[1]}</Text></View>)}</GlassCard>
    </Screen>
  );
}
