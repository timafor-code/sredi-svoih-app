import { useEffect } from 'react';
import * as Notifications from 'expo-notifications';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

import { useAuthStore } from '@/store/useAuthStore';
import { colors } from '@/theme/colors';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

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
        <Stack.Screen name="contacts/community/[id]" options={{ presentation: 'card' }} />
        <Stack.Screen name="contacts/iphone/[id]" options={{ presentation: 'card' }} />
        <Stack.Screen name="events/[id]" options={{ presentation: 'card' }} />
        <Stack.Screen name="modals/omer" options={{ presentation: 'modal' }} />
        <Stack.Screen name="modals/event-registration" options={{ presentation: 'modal' }} />
        <Stack.Screen name="modals/city-picker" options={{ presentation: 'modal' }} />
      </Stack>
    </>
  );
}
