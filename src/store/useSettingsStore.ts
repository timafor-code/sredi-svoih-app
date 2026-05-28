import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { create } from 'zustand';
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware';

import { normalizeBlessingTextDisplayMode } from '@/lib/blessingTextDisplayMode';
import {
  FALLBACK_ZMANIM_CITY,
  isSupportedZmanimCity,
  normalizeZmanimCityName,
} from '@/lib/zmanim';
import type { CustomZmanimLocation } from '@/lib/zmanim';
import type { BlessingTextDisplayMode } from '@/types/blessing';

type ZmanimSource = 'gps' | 'manual';
type LocationPermissionStatus = 'unknown' | 'granted' | 'denied';

type PersistedSettings = {
  blessingDefaultDisplayMode: BlessingTextDisplayMode;
  city: string;
  customGpsLocation: CustomZmanimLocation | null;
  gpsCity: string | null;
  locationPermissionStatus: LocationPermissionStatus;
  zmanimSource: ZmanimSource;
};

type SettingsState = PersistedSettings & {
  hasHydrated: boolean;
  hydrateSettings: () => Promise<void>;
  resetToGpsCity: () => void;
  setBlessingDefaultDisplayMode: (mode: BlessingTextDisplayMode) => void;
  setCity: (city: string) => void;
  setCustomGpsLocation: (location: CustomZmanimLocation | null) => void;
  setGpsCity: (city: string) => void;
  setHasHydrated: (hasHydrated: boolean) => void;
  setLocationPermissionStatus: (status: LocationPermissionStatus) => void;
  useGpsCity: () => void;
};

const SETTINGS_STORAGE_KEY = 'sredi-svoih.settings.v1';
const memoryStorage = new Map<string, string>();

function getWebStorage(): Storage | null {
  if (typeof globalThis === 'undefined') {
    return null;
  }

  return 'localStorage' in globalThis ? globalThis.localStorage : null;
}

async function isSecureStoreAvailable(): Promise<boolean> {
  try {
    return await SecureStore.isAvailableAsync();
  } catch {
    return false;
  }
}

const settingsStorage: StateStorage = {
  async getItem(key) {
    const webStorage = Platform.OS === 'web' ? getWebStorage() : null;

    if (webStorage) {
      return webStorage.getItem(key);
    }

    if (await isSecureStoreAvailable()) {
      return SecureStore.getItemAsync(key);
    }

    return memoryStorage.get(key) ?? null;
  },

  async setItem(key, value) {
    const webStorage = Platform.OS === 'web' ? getWebStorage() : null;

    if (webStorage) {
      webStorage.setItem(key, value);
      return;
    }

    if (await isSecureStoreAvailable()) {
      await SecureStore.setItemAsync(key, value);
      return;
    }

    memoryStorage.set(key, value);
  },

  async removeItem(key) {
    const webStorage = Platform.OS === 'web' ? getWebStorage() : null;

    if (webStorage) {
      webStorage.removeItem(key);
      return;
    }

    if (await isSecureStoreAvailable()) {
      await SecureStore.deleteItemAsync(key);
      return;
    }

    memoryStorage.delete(key);
  },
};

function normalizePermissionStatus(value: unknown): LocationPermissionStatus {
  return value === 'granted' || value === 'denied' ? value : 'unknown';
}

function normalizeZmanimSource(value: unknown): ZmanimSource {
  return value === 'manual' ? 'manual' : 'gps';
}

function normalizePersistedCity(value: unknown) {
  return typeof value === 'string' && value.trim()
    ? normalizeZmanimCityName(value)
    : FALLBACK_ZMANIM_CITY;
}

function numberFromUnknown(value: unknown) {
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && value.trim()) return Number(value);

  return NaN;
}

function normalizeCustomGpsLocation(value: unknown): CustomZmanimLocation | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const location = value as Partial<CustomZmanimLocation>;
  const city = typeof location.city === 'string' && location.city.trim()
    ? normalizeZmanimCityName(location.city)
    : null;
  const latitude = numberFromUnknown(location.latitude);
  const longitude = numberFromUnknown(location.longitude);

  if (
    !city
    || !Number.isFinite(latitude)
    || latitude < -90
    || latitude > 90
    || !Number.isFinite(longitude)
    || longitude < -180
    || longitude > 180
  ) {
    return null;
  }

  const timezone = typeof location.timezone === 'string' && location.timezone.trim()
    ? location.timezone.trim()
    : undefined;

  return {
    city,
    latitude,
    longitude,
    ...(timezone ? { timezone } : {}),
  };
}

function getPersistedCustomGpsLocation(settings: Partial<PersistedSettings> | undefined) {
  const legacySettings = settings as (Partial<PersistedSettings> & {
    gpsLocation?: unknown;
  }) | undefined;

  return normalizeCustomGpsLocation(
    settings?.customGpsLocation ?? legacySettings?.gpsLocation,
  );
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set, get) => ({
      blessingDefaultDisplayMode: 'ru',
      city: FALLBACK_ZMANIM_CITY,
      customGpsLocation: null,
      gpsCity: null,
      hasHydrated: false,
      locationPermissionStatus: 'unknown',
      zmanimSource: 'gps',

      hydrateSettings: async () => {
        useSettingsStore.setState({ hasHydrated: false });
        await useSettingsStore.persist.rehydrate();
        useSettingsStore.setState({ hasHydrated: true });
      },

      resetToGpsCity: () => {
        const { customGpsLocation, gpsCity } = get();

        if (customGpsLocation) {
          set({
            customGpsLocation,
            gpsCity: customGpsLocation.city,
            zmanimSource: 'gps',
          });
          return;
        }

        if (!gpsCity || !isSupportedZmanimCity(gpsCity)) {
          return;
        }

        set({
          city: normalizeZmanimCityName(gpsCity),
          zmanimSource: 'gps',
        });
      },

      setBlessingDefaultDisplayMode: (blessingDefaultDisplayMode) => {
        set({
          blessingDefaultDisplayMode: normalizeBlessingTextDisplayMode(
            blessingDefaultDisplayMode,
          ),
        });
      },

      setCity: (city) => {
        set({
          city: normalizeZmanimCityName(city),
          zmanimSource: 'manual',
        });
      },

      setCustomGpsLocation: (location) => {
        const customGpsLocation = normalizeCustomGpsLocation(location);

        if (!customGpsLocation) {
          set({ customGpsLocation: null });
          return;
        }

        set(() => {
          if (isSupportedZmanimCity(customGpsLocation.city)) {
            const gpsCity = normalizeZmanimCityName(customGpsLocation.city);

            return {
              city: gpsCity,
              customGpsLocation: null,
              gpsCity,
              zmanimSource: 'gps',
            };
          }

          return {
            customGpsLocation,
            gpsCity: customGpsLocation.city,
            zmanimSource: 'gps',
          };
        });
      },

      setGpsCity: (city) => {
        const gpsCity = normalizeZmanimCityName(city);

        set((state) => {
          if (state.zmanimSource === 'manual' || !isSupportedZmanimCity(gpsCity)) {
            return { customGpsLocation: null, gpsCity };
          }

          return {
            city: gpsCity,
            customGpsLocation: null,
            gpsCity,
            zmanimSource: 'gps',
          };
        });
      },

      setHasHydrated: (hasHydrated) => set({ hasHydrated }),
      setLocationPermissionStatus: (locationPermissionStatus) => set({ locationPermissionStatus }),
      useGpsCity: () => get().resetToGpsCity(),
    }),
    {
      name: SETTINGS_STORAGE_KEY,
      storage: createJSONStorage(() => settingsStorage),
      partialize: (state): PersistedSettings => ({
        blessingDefaultDisplayMode: state.blessingDefaultDisplayMode,
        city: state.city,
        customGpsLocation: state.customGpsLocation,
        gpsCity: state.gpsCity,
        locationPermissionStatus: state.locationPermissionStatus,
        zmanimSource: state.zmanimSource,
      }),
      migrate: (persisted): PersistedSettings => {
        const settings = persisted as Partial<PersistedSettings> | undefined;
        const customGpsLocation = getPersistedCustomGpsLocation(settings);
        const gpsCity = typeof settings?.gpsCity === 'string' && settings.gpsCity.trim()
          ? normalizeZmanimCityName(settings.gpsCity)
          : customGpsLocation?.city ?? null;

        return {
          blessingDefaultDisplayMode: normalizeBlessingTextDisplayMode(
            settings?.blessingDefaultDisplayMode,
          ),
          city: normalizePersistedCity(settings?.city),
          customGpsLocation,
          gpsCity,
          locationPermissionStatus: normalizePermissionStatus(settings?.locationPermissionStatus),
          zmanimSource: normalizeZmanimSource(settings?.zmanimSource),
        };
      },
      merge: (persisted, current) => {
        const settings = persisted as Partial<PersistedSettings> | undefined;
        const city = normalizePersistedCity(settings?.city);
        const customGpsLocation = getPersistedCustomGpsLocation(settings);
        const gpsCity = typeof settings?.gpsCity === 'string' && settings.gpsCity.trim()
          ? normalizeZmanimCityName(settings.gpsCity)
          : customGpsLocation?.city ?? null;

        return {
          ...current,
          blessingDefaultDisplayMode: normalizeBlessingTextDisplayMode(
            settings?.blessingDefaultDisplayMode,
          ),
          city,
          customGpsLocation,
          gpsCity,
          locationPermissionStatus: normalizePermissionStatus(settings?.locationPermissionStatus),
          zmanimSource: normalizeZmanimSource(settings?.zmanimSource),
        };
      },
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true);
      },
      version: 3,
    },
  ),
);
