import { Stack } from 'expo-router';
import { Text } from 'react-native';
import { Screen } from '@/components/ui/Screen';
import { GlassCard } from '@/components/glass/GlassCard';

export default function Page() {
  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: 'edit', headerStyle: { backgroundColor: '#0D0D1A' }, headerTintColor: '#fff' }} />
      <Screen>
        <GlassCard><Text style={{ color: '#fff', fontSize: 20, fontWeight: '700' }}>Экран: edit</Text><Text style={{ color: 'rgba(255,255,255,0.6)' }}>Перенесено из HTML прототипа как отдельный route.</Text></GlassCard>
      </Screen>
    </>
  );
}
