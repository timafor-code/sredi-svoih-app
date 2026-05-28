import { useEffect, useRef, useState } from 'react';

import { isSupportedZmanimCity, normalizeZmanimCityName } from '@/lib/zmanim';
import { LocationServiceError, requestCurrentCityByGps } from '@/services/locationService';
import { useSettingsStore } from '@/store/useSettingsStore';

const GPS_PERMISSION_DENIED_MESSAGE = 'Нет доступа к геопозиции. Выберите город вручную.';
const GPS_CITY_UNAVAILABLE_MESSAGE = 'Не удалось определить город по геопозиции. Выберите город вручную.';

type UseAutoDetectZmanimCityOptions = {
  showMessages?: boolean;
};

export function useAutoDetectZmanimCity(options: UseAutoDetectZmanimCityOptions = {}) {
  const { showMessages = false } = options;
  const hasHydratedSettings = useSettingsStore((state) => state.hasHydrated);
  const locationPermissionStatus = useSettingsStore((state) => state.locationPermissionStatus);
  const setGpsCity = useSettingsStore((state) => state.setGpsCity);
  const setLocationPermissionStatus = useSettingsStore((state) => state.setLocationPermissionStatus);
  const zmanimSource = useSettingsStore((state) => state.zmanimSource);
  const requestedAutoGpsRef = useRef(false);
  const [isDetecting, setIsDetecting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!showMessages || locationPermissionStatus !== 'denied') {
      return;
    }

    setMessage(GPS_PERMISSION_DENIED_MESSAGE);
  }, [locationPermissionStatus, showMessages]);

  useEffect(() => {
    if (
      !hasHydratedSettings
      || requestedAutoGpsRef.current
      || zmanimSource === 'manual'
      || locationPermissionStatus === 'denied'
    ) {
      return;
    }

    requestedAutoGpsRef.current = true;
    setIsDetecting(true);

    if (showMessages) {
      setMessage(null);
    }

    void requestCurrentCityByGps()
      .then((result) => {
        if (!result) {
          if (showMessages) {
            setMessage(GPS_CITY_UNAVAILABLE_MESSAGE);
          }
          return;
        }

        setLocationPermissionStatus('granted');

        if (!isSupportedZmanimCity(result.city)) {
          setGpsCity(result.city);

          if (showMessages) {
            setMessage(
              `Город определён: ${result.city}. Пока он не поддерживается для зманим. Выберите город из списка.`,
            );
          }
          return;
        }

        setGpsCity(normalizeZmanimCityName(result.city));

        if (showMessages) {
          setMessage(null);
        }
      })
      .catch((error) => {
        if (error instanceof LocationServiceError && error.code === 'permission-denied') {
          setLocationPermissionStatus('denied');

          if (showMessages) {
            setMessage(GPS_PERMISSION_DENIED_MESSAGE);
          }
          return;
        }

        if (showMessages) {
          setMessage(GPS_CITY_UNAVAILABLE_MESSAGE);
        }
      })
      .finally(() => {
        setIsDetecting(false);
      });
  }, [
    hasHydratedSettings,
    locationPermissionStatus,
    setGpsCity,
    setLocationPermissionStatus,
    showMessages,
    zmanimSource,
  ]);

  return {
    isDetecting,
    message,
  };
}
