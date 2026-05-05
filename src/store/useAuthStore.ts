import type { Session, User } from '@supabase/supabase-js';
import { create } from 'zustand';

import {
  getSession,
  loadProfile as loadProfileService,
  signIn as signInService,
  signOut as signOutService,
  upsertProfile,
  type Profile,
  type ProfileUpsert,
} from '@/services/authService';
import {
  acceptInvite as acceptInviteService,
  loadMyMembership,
  type CommunityMembership,
} from '@/services/inviteService';

type AuthState = {
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  membership: CommunityMembership | null;
  loading: boolean;
  error: string | null;
  loadSession: () => Promise<void>;
  loadProfile: () => Promise<void>;
  updateProfile: (input: ProfileUpsert) => Promise<Profile>;
  loadMembership: () => Promise<void>;
  acceptInvite: (code: string) => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
};

function friendlyAuthError(error: unknown): string {
  const message = error instanceof Error ? error.message : 'Не удалось выполнить действие.';

  if (message === 'Auth required') {
    return 'Чтобы продолжить, войдите в приложение.';
  }

  if (message.includes('Invalid login credentials')) {
    return 'Не удалось войти. Проверьте email и пароль.';
  }

  if (message.includes('User already registered')) {
    return 'Этот email уже зарегистрирован с другим способом входа.';
  }

  if (message.includes('Invalid or expired invite code')) {
    return 'Код приглашения недействителен или истёк.';
  }

  return message;
}

async function loadProfileOrCreate(): Promise<Profile | null> {
  const profile = await loadProfileService();

  if (profile) {
    return profile;
  }

  return upsertProfile();
}

export const useAuthStore = create<AuthState>((set) => ({
  session: null,
  user: null,
  profile: null,
  membership: null,
  loading: false,
  error: null,

  loadSession: async () => {
    set({ loading: true, error: null });

    try {
      const session = await getSession();

      if (!session) {
        set({
          session: null,
          user: null,
          profile: null,
          membership: null,
          loading: false,
          error: null,
        });
        return;
      }

      const [profile, membership] = await Promise.all([
        loadProfileOrCreate(),
        loadMyMembership(),
      ]);

      set({
        session,
        user: session.user,
        profile,
        membership,
        loading: false,
        error: null,
      });
    } catch (error) {
      const message = friendlyAuthError(error);

      set({ loading: false, error: message });
      throw new Error(message);
    }
  },

  loadProfile: async () => {
    set({ loading: true, error: null });

    try {
      const profile = await loadProfileService();

      set({ profile, loading: false, error: null });
    } catch (error) {
      const message = friendlyAuthError(error);

      set({ loading: false, error: message });
      throw new Error(message);
    }
  },

  updateProfile: async (input: ProfileUpsert) => {
    set({ loading: true, error: null });

    try {
      const profile = await upsertProfile(input);

      set({ profile, loading: false, error: null });
      return profile;
    } catch (error) {
      const message = friendlyAuthError(error);

      set({ loading: false, error: message });
      throw new Error(message);
    }
  },

  loadMembership: async () => {
    set({ loading: true, error: null });

    try {
      const membership = await loadMyMembership();

      set({ membership, loading: false, error: null });
    } catch (error) {
      const message = friendlyAuthError(error);

      set({ loading: false, error: message });
      throw new Error(message);
    }
  },

  acceptInvite: async (code: string) => {
    set({ loading: true, error: null });

    try {
      await acceptInviteService(code);
      const membership = await loadMyMembership();

      set({ membership, loading: false, error: null });
    } catch (error) {
      const message = friendlyAuthError(error);

      set({ loading: false, error: message });
      throw new Error(message);
    }
  },

  signIn: async (email: string, password: string) => {
    set({ loading: true, error: null });

    try {
      const session = await signInService(email, password);
      const [profile, membership] = await Promise.all([
        loadProfileOrCreate(),
        loadMyMembership(),
      ]);

      set({
        session,
        user: session.user,
        profile,
        membership,
        loading: false,
        error: null,
      });
    } catch (error) {
      const message = friendlyAuthError(error);

      set({ loading: false, error: message });
      throw new Error(message);
    }
  },

  signOut: async () => {
    set({ loading: true, error: null });

    try {
      await signOutService();

      set({
        session: null,
        user: null,
        profile: null,
        membership: null,
        loading: false,
        error: null,
      });
    } catch (error) {
      const message = friendlyAuthError(error);

      set({ loading: false, error: message });
      throw new Error(message);
    }
  },
}));
