import { create } from 'zustand';

type SettingsState = {
  city: string;
  zmanimSource: 'manual' | 'gps';
  setCity: (city: string) => void;
};

export const useSettingsStore = create<SettingsState>((set) => ({
  city: 'Москва',
  zmanimSource: 'manual',
  setCity: (city) => set({ city, zmanimSource: 'manual' }),
}));
