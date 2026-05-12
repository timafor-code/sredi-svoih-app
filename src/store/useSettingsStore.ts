import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { create } from 'zustand';
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware';

import {
  FALLBACK_ZMANIM_CITY,
  isSupportedZmanimCity,
  normalizeZmanimCityName,
} from '@/lib/zmanim';

type ZmanimSource = 'gps' | 'manual';
type LocationPermissionStatus = 'unknown' | 'granted' | 'denied';

type PersistedSettings = {
  city: string;
  gpsCity: string | null;
  locationPermissionStatus: LocationPermissionStatus;
  zmanimSource: ZmanimSource;
};

type SettingsState = PersistedSettings & {
  hasHydrated: boolean;
  hydrateSettings: () => Promise<void>;
  resetToGpsCity: () => void;
  setCity: (city: string) => void;
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

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set, get) => ({
      city: FALLBACK_ZMANIM_CITY,
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
        const gpsCity = get().gpsCity;
        if (!gpsCity || !isSupportedZmanimCity(gpsCity)) {
          return;
        }

        set({
          city: normalizeZmanimCityName(gpsCity),
          zmanimSource: 'gps',
        });
      },

      setCity: (city) => {
        set({
          city: normalizeZmanimCityName(city),
          zmanimSource: 'manual',
        });
      },

      setGpsCity: (city) => {
        const gpsCity = normalizeZmanimCityName(city);

        set((state) => {
          if (state.zmanimSource === 'manual' || !isSupportedZmanimCity(gpsCity)) {
            return { gpsCity };
          }

          return {
            city: gpsCity,
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
        city: state.city,
        gpsCity: state.gpsCity,
        locationPermissionStatus: state.locationPermissionStatus,
        zmanimSource: state.zmanimSource,
      }),
      merge: (persisted, current) => {
        const settings = persisted as Partial<PersistedSettings> | undefined;
        const city = normalizePersistedCity(settings?.city);
        const gpsCity = typeof settings?.gpsCity === 'string' && settings.gpsCity.trim()
          ? normalizeZmanimCityName(settings.gpsCity)
          : null;

        return {
          ...current,
          city,
          gpsCity,
          locationPermissionStatus: normalizePermissionStatus(settings?.locationPermissionStatus),
          zmanimSource: normalizeZmanimSource(settings?.zmanimSource),
        };
      },
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true);
      },
      version: 1,
    },
  ),
);
