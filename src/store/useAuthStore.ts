import type { Session, User } from '@supabase/supabase-js';
import { create } from 'zustand';

import {
  getSession,
  loadProfile as loadProfileService,
  resendConfirmationEmail as resendConfirmationEmailService,
  resetPasswordForEmail as resetPasswordForEmailService,
  signIn as signInService,
  signOut as signOutService,
  signUpWithEmail as signUpWithEmailService,
  upsertProfile,
  type EmailSignUpResult,
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
  signUpWithEmail: (email: string, password: string) => Promise<EmailSignUpResult>;
  resendConfirmationEmail: (email: string) => Promise<void>;
  resetPasswordForEmail: (email: string) => Promise<void>;
  signOut: () => Promise<void>;
};

function includesAny(message: string, phrases: string[]): boolean {
  return phrases.some((phrase) => message.includes(phrase));
}

function friendlyAuthError(error: unknown): string {
  const message = error instanceof Error ? error.message : 'Не удалось выполнить действие.';
  const normalizedMessage = message.toLowerCase();

  if (message === 'Auth required') {
    return 'Чтобы продолжить, войдите в приложение.';
  }

  if (normalizedMessage.includes('invalid login credentials')) {
    return 'Не удалось войти. Проверьте email и пароль.';
  }

  if (
    includesAny(normalizedMessage, [
      'already registered',
      'already been registered',
      'user already exists',
    ])
  ) {
    return 'Этот email уже зарегистрирован. Войдите или восстановите пароль.';
  }

  if (
    normalizedMessage.includes('password') &&
    includesAny(normalizedMessage, ['weak', 'too short', 'at least', 'minimum'])
  ) {
    return 'Пароль слишком слабый. Используйте более длинный пароль.';
  }

  if (includesAny(normalizedMessage, ['email not confirmed', 'email is not confirmed'])) {
    return 'Email ещё не подтверждён. Проверьте почту и перейдите по ссылке из письма.';
  }

  if (
    includesAny(normalizedMessage, [
      'rate limit',
      'too many requests',
      'email send rate',
      'security purposes',
    ])
  ) {
    return 'Слишком много попыток. Попробуйте ещё раз немного позже.';
  }

  if (normalizedMessage.includes('invalid or expired invite code')) {
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

  signUpWithEmail: async (email: string, password: string) => {
    set({ loading: true, error: null });

    try {
      const result = await signUpWithEmailService(email, password);

      if (!result.session) {
        set({
          session: null,
          user: null,
          profile: null,
          membership: null,
          loading: false,
          error: null,
        });
        return result;
      }

      set({
        session: result.session,
        user: result.session.user,
        profile: result.profile,
        membership: null,
        loading: false,
        error: null,
      });

      return result;
    } catch (error) {
      const message = friendlyAuthError(error);

      set({ loading: false, error: message });
      throw new Error(message);
    }
  },

  resendConfirmationEmail: async (email: string) => {
    set({ loading: true, error: null });

    try {
      await resendConfirmationEmailService(email);

      set({ loading: false, error: null });
    } catch (error) {
      const message = friendlyAuthError(error);

      set({ loading: false, error: message });
      throw new Error(message);
    }
  },

  resetPasswordForEmail: async (email: string) => {
    set({ loading: true, error: null });

    try {
      await resetPasswordForEmailService(email);

      set({ loading: false, error: null });
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
