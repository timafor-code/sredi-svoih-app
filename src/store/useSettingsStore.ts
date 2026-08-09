import { Platform } from 'react-native';
import { create } from 'zustand';
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware';

import {
  isSupportedZmanimCity,
  normalizeZmanimCityName,
} from '@/lib/zmanim';
import type { CustomZmanimLocation } from '@/lib/zmanim';
import {
  createDefaultLocalPreferences,
  enqueueNativePreferencesClear,
  enqueueNativePreferencesStorageWrite,
  LEGACY_SETTINGS_STORAGE_KEY,
  loadNativePreferencesStorageValue,
  normalizePreferenceValue,
  type LastAccountSyncDecision,
  type LocalPreferences,
  type LocationPermissionStatus,
  type PrayerStorageMode,
  type ZmanimSource,
} from '@/local-data/preferencesRepository';
import type { BlessingTextDisplayMode } from '@/types/blessing';
import type {
  ProfileNotificationPreferences,
  ProfileNusach,
} from '@/types/profile';

type PersistedSettings = LocalPreferences;

type SettingsState = PersistedSettings & {
  hasHydrated: boolean;
  hydrateSettings: () => Promise<void>;
  resetToGpsCity: () => void;
  setBlessingDefaultDisplayMode: (mode: BlessingTextDisplayMode) => void;
  setCity: (city: string) => void;
  setCustomGpsLocation: (location: CustomZmanimLocation | null) => void;
  setGpsCity: (city: string) => void;
  setHasHydrated: (hasHydrated: boolean) => void;
  setLastAccountSyncDecision: (decision: LastAccountSyncDecision) => void;
  setLocationPermissionStatus: (status: LocationPermissionStatus) => void;
  setNotificationPreferences: (preferences: ProfileNotificationPreferences) => void;
  setNusach: (nusach: ProfileNusach) => void;
  setPrayerStorageMode: (mode: PrayerStorageMode) => void;
  useGpsCity: () => void;
};

const memoryStorage = new Map<string, string>();

function getWebStorage(): Storage | null {
  if (typeof globalThis === 'undefined') {
    return null;
  }

  return 'localStorage' in globalThis ? globalThis.localStorage : null;
}

const settingsStorage: StateStorage = {
  async getItem(key) {
    if (Platform.OS === 'web') {
      return getWebStorage()?.getItem(key) ?? memoryStorage.get(key) ?? null;
    }

    return key === LEGACY_SETTINGS_STORAGE_KEY
      ? loadNativePreferencesStorageValue()
      : null;
  },

  async setItem(key, value) {
    if (Platform.OS === 'web') {
      const webStorage = getWebStorage();

      if (webStorage) {
        webStorage.setItem(key, value);
      } else {
        memoryStorage.set(key, value);
      }
      return;
    }

    if (key === LEGACY_SETTINGS_STORAGE_KEY) {
      await enqueueNativePreferencesStorageWrite(value);
    }
  },

  async removeItem(key) {
    if (Platform.OS === 'web') {
      getWebStorage()?.removeItem(key);
      memoryStorage.delete(key);
      return;
    }

    if (key === LEGACY_SETTINGS_STORAGE_KEY) {
      await enqueueNativePreferencesClear();
    }
  },
};

function normalizePermissionStatus(value: unknown): LocationPermissionStatus {
  return normalizePreferenceValue('locationPermissionStatus', value);
}

function normalizeZmanimSource(value: unknown): ZmanimSource {
  return normalizePreferenceValue('zmanimSource', value);
}

function normalizePersistedCity(value: unknown) {
  return normalizePreferenceValue('city', value);
}

function normalizeCustomGpsLocation(value: unknown): CustomZmanimLocation | null {
  return normalizePreferenceValue('customGpsLocation', value);
}

function getPersistedCustomGpsLocation(settings: Partial<PersistedSettings> | undefined) {
  const legacySettings = settings as (Partial<PersistedSettings> & {
    gpsLocation?: unknown;
  }) | undefined;

  return normalizeCustomGpsLocation(
    settings?.customGpsLocation ?? legacySettings?.gpsLocation,
  );
}

function normalizePersistedSettings(
  settings: Partial<PersistedSettings> | undefined,
): PersistedSettings {
  const defaults = createDefaultLocalPreferences();
  const customGpsLocation = getPersistedCustomGpsLocation(settings);
  const gpsCity = typeof settings?.gpsCity === 'string' && settings.gpsCity.trim()
    ? normalizePreferenceValue('gpsCity', settings.gpsCity)
    : customGpsLocation?.city ?? null;

  return {
    blessingDefaultDisplayMode: normalizePreferenceValue(
      'blessingDefaultDisplayMode',
      settings?.blessingDefaultDisplayMode,
    ),
    city: normalizePersistedCity(settings?.city),
    customGpsLocation,
    gpsCity,
    lastAccountSyncDecision: normalizePreferenceValue(
      'lastAccountSyncDecision',
      settings?.lastAccountSyncDecision ?? defaults.lastAccountSyncDecision,
    ),
    locationPermissionStatus: normalizePermissionStatus(settings?.locationPermissionStatus),
    notificationPreferences: normalizePreferenceValue(
      'notificationPreferences',
      settings?.notificationPreferences ?? defaults.notificationPreferences,
    ),
    nusach: normalizePreferenceValue('nusach', settings?.nusach ?? defaults.nusach),
    prayerStorageMode: normalizePreferenceValue(
      'prayerStorageMode',
      settings?.prayerStorageMode ?? defaults.prayerStorageMode,
    ),
    zmanimSource: normalizeZmanimSource(settings?.zmanimSource),
  };
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set, get) => ({
      ...createDefaultLocalPreferences(),
      hasHydrated: false,

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
          blessingDefaultDisplayMode: normalizePreferenceValue(
            'blessingDefaultDisplayMode',
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
      setLastAccountSyncDecision: (lastAccountSyncDecision) => set({
        lastAccountSyncDecision: normalizePreferenceValue(
          'lastAccountSyncDecision',
          lastAccountSyncDecision,
        ),
      }),
      setLocationPermissionStatus: (locationPermissionStatus) => set({
        locationPermissionStatus: normalizePermissionStatus(locationPermissionStatus),
      }),
      setNotificationPreferences: (notificationPreferences) => set({
        notificationPreferences: normalizePreferenceValue(
          'notificationPreferences',
          notificationPreferences,
        ),
      }),
      setNusach: (nusach) => set({
        nusach: normalizePreferenceValue('nusach', nusach),
      }),
      setPrayerStorageMode: (prayerStorageMode) => set({
        prayerStorageMode: normalizePreferenceValue('prayerStorageMode', prayerStorageMode),
      }),
      useGpsCity: () => get().resetToGpsCity(),
    }),
    {
      name: LEGACY_SETTINGS_STORAGE_KEY,
      storage: createJSONStorage(() => settingsStorage),
      partialize: (state): PersistedSettings => ({
        blessingDefaultDisplayMode: state.blessingDefaultDisplayMode,
        city: state.city,
        customGpsLocation: state.customGpsLocation,
        gpsCity: state.gpsCity,
        lastAccountSyncDecision: state.lastAccountSyncDecision,
        locationPermissionStatus: state.locationPermissionStatus,
        notificationPreferences: state.notificationPreferences,
        nusach: state.nusach,
        prayerStorageMode: state.prayerStorageMode,
        zmanimSource: state.zmanimSource,
      }),
      migrate: (persisted): PersistedSettings => normalizePersistedSettings(
        persisted as Partial<PersistedSettings> | undefined,
      ),
      merge: (persisted, current) => {
        const settings = persisted as Partial<PersistedSettings> | undefined;

        return {
          ...current,
          ...normalizePersistedSettings(settings),
        };
      },
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true);
      },
      version: 4,
    },
  ),
);
