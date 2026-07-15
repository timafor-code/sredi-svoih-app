import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import {
  getAdminAuthConfigurationError,
  getCurrentAdminContext,
  isAdminAuthConfigured,
  signInWithPassword,
  signOut as signOutService,
} from "../services/adminAuthService";
import type { AdminAuthSession, AdminMembership, AdminProfile, AdminRole } from "../types/auth";

type AdminAuthState = {
  loading: boolean;
  configMissing: boolean;
  session: AdminAuthSession | null;
  profile: AdminProfile | null;
  membership: AdminMembership | null;
  role: AdminRole | null;
  isAuthenticated: boolean;
  isAdmin: boolean;
  isEventManager: boolean;
  canAccessAdmin: boolean;
  error: string | null;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
};

type AdminAuthDataState = Omit<AdminAuthState, "signIn" | "signOut" | "refresh">;

const AdminAuthContext = createContext<AdminAuthState | null>(null);

type AdminAuthProviderProps = {
  children: ReactNode;
};

const initialAuthState: AdminAuthDataState = {
  loading: true,
  configMissing: !isAdminAuthConfigured(),
  session: null,
  profile: null,
  membership: null,
  role: null,
  isAuthenticated: false,
  isAdmin: false,
  isEventManager: false,
  canAccessAdmin: false,
  error: getAdminAuthConfigurationError(),
};

function friendlyAuthError(error: unknown): string {
  const message = error instanceof Error ? error.message : "Не удалось выполнить действие.";

  if (message.includes("Invalid login credentials")) {
    return "Неверный email или пароль.";
  }

  if (message.includes("Email not confirmed")) {
    return "Email ещё не подтверждён.";
  }

  return message;
}

export function AdminAuthProvider({ children }: AdminAuthProviderProps) {
  const [state, setState] = useState<AdminAuthDataState>(initialAuthState);

  const refresh = useCallback(async () => {
    const configError = getAdminAuthConfigurationError();

    if (!isAdminAuthConfigured()) {
      setState((current) => ({
        ...current,
        loading: false,
        configMissing: true,
        error: configError,
      }));
      return;
    }

    setState((current) => ({
      ...current,
      loading: true,
      configMissing: false,
      error: null,
    }));

    try {
      const context = await getCurrentAdminContext();

      setState({
        loading: false,
        configMissing: false,
        session: context.session,
        profile: context.profile,
        membership: context.membership,
        role: context.role,
        isAuthenticated: context.isAuthenticated,
        isAdmin: context.isAdmin,
        isEventManager: context.isEventManager,
        canAccessAdmin: context.canAccessAdmin,
        error: null,
      });
    } catch (error) {
      setState((current) => ({
        ...current,
        loading: false,
        error: friendlyAuthError(error),
      }));
    }
  }, []);

  useEffect(() => {
    void refresh();

  }, [refresh]);

  const signIn = useCallback(
    async (email: string, password: string) => {
      const configError = getAdminAuthConfigurationError();

      if (!isAdminAuthConfigured()) {
        setState((current) => ({
          ...current,
          loading: false,
          configMissing: true,
          error: configError,
        }));
        throw new Error(configError ?? "Authentication is not configured.");
      }

      setState((current) => ({
        ...current,
        loading: true,
        error: null,
      }));

      try {
        await signInWithPassword(email, password);
        await refresh();
      } catch (error) {
        const message = friendlyAuthError(error);

        setState((current) => ({
          ...current,
          loading: false,
          error: message,
        }));
        throw new Error(message);
      }
    },
    [refresh],
  );

  const signOut = useCallback(async () => {
    setState((current) => ({
      ...current,
      loading: true,
      error: null,
    }));

    try {
      await signOutService();
      setState({
        ...initialAuthState,
        loading: false,
        configMissing: !isAdminAuthConfigured(),
        error: getAdminAuthConfigurationError(),
      });
    } catch (error) {
      setState((current) => ({
        ...current,
        loading: false,
        error: friendlyAuthError(error),
      }));
    }
  }, []);

  const value = useMemo<AdminAuthState>(
    () => ({
      ...state,
      signIn,
      signOut,
      refresh,
    }),
    [refresh, signIn, signOut, state],
  );

  return <AdminAuthContext.Provider value={value}>{children}</AdminAuthContext.Provider>;
}

export function useAdminAuth(): AdminAuthState {
  const context = useContext(AdminAuthContext);

  if (!context) {
    throw new Error("useAdminAuth must be used inside AdminAuthProvider.");
  }

  return context;
}
