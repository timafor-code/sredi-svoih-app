import * as Notifications from 'expo-notifications';

export async function requestNotificationPermission() {
  const { status } = await Notifications.requestPermissionsAsync();
  return status === 'granted';
}

export async function scheduleMockPrayerReminder() {
  return Notifications.scheduleNotificationAsync({
    content: { title: 'Среди Своих', body: 'Скоро время молитвы' },
    trigger: null,
  });
}
