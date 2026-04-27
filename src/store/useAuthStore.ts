import { create } from 'zustand';
import { mockUser } from '@/data/mockUser';

export const useAuthStore = create<{ user: typeof mockUser | null; signOut: () => void }>((set) => ({
  user: mockUser,
  signOut: () => set({ user: null }),
}));
