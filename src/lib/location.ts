import * as Location from 'expo-location';

export async function suggestCityFromGps() {
  const { status } = await Location.requestForegroundPermissionsAsync();
  if (status !== 'granted') return null;
  return 'Москва';
}
