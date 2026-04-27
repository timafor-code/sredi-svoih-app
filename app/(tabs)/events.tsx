import { useMemo, useState } from 'react';
import { Text } from 'react-native';
import { Screen } from '@/components/ui/Screen';
import { SegmentControl } from '@/components/ui/SegmentControl';
import { GlassCard } from '@/components/glass/GlassCard';
import { PrimaryButton } from '@/components/ui/PrimaryButton';
import { mockEvents } from '@/data/mockEvents';

export default function EventsScreen() {
  const [filter, setFilter] = useState('Все');
  const items = useMemo(() => filter === 'Все' ? mockEvents : mockEvents.filter((x) => x.category === filter), [filter]);
  return (
    <Screen>
      <Text style={{ color: '#fff', fontSize: 28, fontWeight: '700' }}>События</Text>
      <Text style={{ color: 'rgba(255,255,255,0.55)' }}>Афиша мероприятий общины</Text>
      <SegmentControl items={['Все', 'Курсы', 'Праздники']} value={filter} onChange={setFilter} />
      {items.map((e) => <GlassCard key={e.id}><Text style={{ color: '#fff', fontWeight: '700' }}>{e.title}</Text><Text style={{ color: 'rgba(255,255,255,0.55)', marginVertical: 6 }}>{e.date} · {e.category}</Text><PrimaryButton title="Хочу пойти" /></GlassCard>)}
    </Screen>
  );
}
