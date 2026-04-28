import { useEffect } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

import { useAuthStore } from '@/store/useAuthStore';
import { colors } from '@/theme/colors';

export default function RootLayout() {
  const loadSession = useAuthStore((state) => state.loadSession);

  useEffect(() => {
    void loadSession().catch(() => undefined);
  }, [loadSession]);

  return (
    <>
      <StatusBar style="light" />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="contacts/[id]" options={{ presentation: 'card' }} />
        <Stack.Screen name="modals/omer" options={{ presentation: 'modal' }} />
        <Stack.Screen name="modals/event-registration" options={{ presentation: 'modal' }} />
        <Stack.Screen name="modals/city-picker" options={{ presentation: 'modal' }} />
      </Stack>
    </>
  );
}
