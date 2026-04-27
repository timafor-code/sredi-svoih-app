import { create } from 'zustand';

export const useAppStore = create<{ isOmerOpen: boolean; setOmerOpen: (v: boolean) => void }>((set) => ({
  isOmerOpen: false,
  setOmerOpen: (v) => set({ isOmerOpen: v }),
}));
