import { useEffect } from 'react';
import * as Notifications from 'expo-notifications';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

import { appCapabilities } from '@/config/appCapabilities';
import { GUEST_BLOCKED_ROUTE_NAMES } from '@/navigation/guestRouteGuard';
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
  const enterGuestMode = useAuthStore((state) => state.enterGuestMode);
  const loadSession = useAuthStore((state) => state.loadSession);

  useEffect(() => {
    if (appCapabilities.isGuestOnly) {
      void enterGuestMode().catch(() => undefined);
      return;
    }

    if (appCapabilities.isAccountMode) {
      void loadSession().catch(() => undefined);
    }
  }, [enterGuestMode, loadSession]);

  return (
    <>
      <StatusBar style="light" />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Protected guard={appCapabilities.isAccountMode}>
          {GUEST_BLOCKED_ROUTE_NAMES.map((routeName) => (
            <Stack.Screen
              key={routeName}
              name={routeName}
              options={routeName.startsWith('contacts/') ? { presentation: 'card' } : undefined}
            />
          ))}
        </Stack.Protected>
        <Stack.Screen name="contacts/iphone/[id]" options={{ presentation: 'card' }} />
        <Stack.Screen name="events/[id]" options={{ presentation: 'card' }} />
        <Stack.Screen name="modals/omer" options={{ presentation: 'modal' }} />
        <Stack.Screen name="modals/event-registration" options={{ presentation: 'modal' }} />
        <Stack.Screen name="modals/city-picker" options={{ presentation: 'modal' }} />
      </Stack>
    </>
  );
}
