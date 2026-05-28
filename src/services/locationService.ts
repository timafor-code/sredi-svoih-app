import * as Location from 'expo-location';

import { normalizeZmanimCityName } from '@/lib/zmanim';
import type { CustomZmanimLocation } from '@/lib/zmanim';

export type CurrentGpsCity = CustomZmanimLocation;

export type LocationServiceErrorCode =
  | 'location-unavailable'
  | 'permission-denied'
  | 'reverse-geocode-empty';

export class LocationServiceError extends Error {
  code: LocationServiceErrorCode;

  constructor(code: LocationServiceErrorCode, message: string) {
    super(message);
    this.code = code;
    Object.setPrototypeOf(this, LocationServiceError.prototype);
  }
}

function pickCity(address: Location.LocationGeocodedAddress) {
  return address.city ?? address.subregion ?? address.region ?? null;
}

export async function requestCurrentCityByGps(): Promise<CurrentGpsCity | null> {
  const permission = await Location.requestForegroundPermissionsAsync();

  if (permission.status !== Location.PermissionStatus.GRANTED) {
    throw new LocationServiceError(
      'permission-denied',
      'Нет доступа к геопозиции. Выберите город вручную.',
    );
  }

  const position = await Location.getCurrentPositionAsync({
    accuracy: Location.Accuracy.Balanced,
  });

  const { latitude, longitude } = position.coords;
  const addresses = await Location.reverseGeocodeAsync({ latitude, longitude });
  const address = addresses[0];
  const rawCity = address ? pickCity(address) : null;

  if (!rawCity) {
    throw new LocationServiceError(
      'reverse-geocode-empty',
      'Не удалось определить город по геопозиции. Выберите город вручную.',
    );
  }

  return {
    city: normalizeZmanimCityName(rawCity),
    latitude,
    longitude,
    timezone: address.timezone ?? undefined,
  };
}
