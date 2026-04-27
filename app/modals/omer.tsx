import { Stack } from 'expo-router';
import { Text } from 'react-native';
import { Screen } from '@/components/ui/Screen';
import { GlassCard } from '@/components/glass/GlassCard';
import { mockOmer } from '@/data/mockOmer';

export default function OmerModal() {
  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: `Омер · день ${mockOmer.day}`, presentation: 'modal', headerStyle: { backgroundColor: '#0D0D1A' }, headerTintColor: '#fff' }} />
      <Screen>
        <GlassCard><Text style={{ color: '#fff', fontSize: 22, fontWeight: '700' }}>{mockOmer.fullName}</Text><Text style={{ color: 'rgba(255,255,255,0.6)' }}>{mockOmer.fullNameHeb}</Text><Text style={{ color: '#F6A400' }}>{mockOmer.meaning}</Text></GlassCard>
        <GlassCard><Text style={{ color: '#fff' }}>{mockOmer.description}</Text></GlassCard>
        <GlassCard><Text style={{ color: '#fff' }}>{mockOmer.countingHeb}</Text><Text style={{ color: 'rgba(255,255,255,0.6)' }}>{mockOmer.countingRu}</Text></GlassCard>
      </Screen>
    </>
  );
}
