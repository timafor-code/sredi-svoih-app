import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

export default function RootLayout() {
  return (
    <>
      <StatusBar style="light" />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: '#0D0D1A' } }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="contacts/[id]" options={{ presentation: 'card' }} />
        <Stack.Screen name="modals/omer" options={{ presentation: 'modal' }} />
      </Stack>
    </>
  );
}
