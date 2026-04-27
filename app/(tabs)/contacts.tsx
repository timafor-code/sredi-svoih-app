import { Link } from 'expo-router';
import { useMemo, useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import { Screen } from '@/components/ui/Screen';
import { SegmentControl } from '@/components/ui/SegmentControl';
import { GlassCard } from '@/components/glass/GlassCard';
import { mockContacts } from '@/data/mockContacts';

export default function ContactsScreen() {
  const [tab, setTab] = useState('Община');
  const [q, setQ] = useState('');
  const filtered = useMemo(() => mockContacts.filter((c) => c.name.toLowerCase().includes(q.toLowerCase())), [q]);
  return (
    <Screen>
      <Text style={{ color: '#fff', fontSize: 28, fontWeight: '700' }}>Контакты</Text>
      <SegmentControl items={['Община', 'Мои контакты']} value={tab} onChange={setTab} />
      <TextInput value={q} onChangeText={setQ} placeholder="Поиск" placeholderTextColor="rgba(255,255,255,0.35)" style={{ borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', borderRadius: 12, padding: 12, color: '#fff' }} />
      <GlassCard><Text style={{ color: '#fff', fontWeight: '700' }}>Ближайшие дни рождения</Text><Text style={{ color: 'rgba(255,255,255,0.6)' }}>Сегодня: Давид Коэн</Text></GlassCard>
      <GlassCard><Text style={{ color: '#fff', fontWeight: '700' }}>Синхронизация iPhone-контактов</Text><Text style={{ color: 'rgba(255,255,255,0.6)' }}>Только локально, без авто-отправки на сервер</Text></GlassCard>
      {filtered.map((c) => <Link key={c.id} href={`/contacts/${c.id}` as const} style={{ color: '#fff', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.08)' }}>{c.name} · {c.hebrewName}</Link>)}
    </Screen>
  );
}
