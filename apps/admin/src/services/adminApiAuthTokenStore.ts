import type { AdminApiAuthTokenResponse, AdminApiStoredAuthTokens } from "../types/api";

const ADMIN_API_AUTH_TOKEN_STORAGE_KEY = "sredi-svoih.adminApiAuthTokens.v1";
const memoryStorage = new Map<string, string>();

type AdminApiAuthTokenStorage = {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
};

function getBrowserStorage(kind: "localStorage" | "sessionStorage"): Storage | null {
  if (typeof globalThis === "undefined" || !(kind in globalThis)) {
    return null;
  }

  try {
    return globalThis[kind];
  } catch {
    return null;
  }
}

function getAvailableBrowserStorages(): Storage[] {
  return [
    getBrowserStorage("localStorage"),
    getBrowserStorage("sessionStorage"),
  ].filter((storage): storage is Storage => Boolean(storage));
}

const adminApiAuthTokenStorage: AdminApiAuthTokenStorage = {
  getItem(key) {
    for (const storage of getAvailableBrowserStorages()) {
      try {
        const value = storage.getItem(key);

        if (value) {
          return value;
        }
      } catch {
        // Ignore unavailable browser storage and continue to the next fallback.
      }
    }

    return memoryStorage.get(key) ?? null;
  },

  setItem(key, value) {
    for (const storage of getAvailableBrowserStorages()) {
      try {
        storage.setItem(key, value);
        memoryStorage.delete(key);
        return;
      } catch {
        // Temporary foundation only; a later auth-provider PR can harden storage.
      }
    }

    memoryStorage.set(key, value);
  },

  removeItem(key) {
    for (const storage of getAvailableBrowserStorages()) {
      try {
        storage.removeItem(key);
      } catch {
        // Ignore unavailable browser storage and still clear memory fallback.
      }
    }

    memoryStorage.delete(key);
  },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

function normalizeStoredTokens(value: unknown): AdminApiStoredAuthTokens | null {
  if (!isRecord(value)) {
    return null;
  }

  const accessToken = stringValue(value.access_token);
  const refreshToken = stringValue(value.refresh_token);

  if (!accessToken || !refreshToken) {
    return null;
  }

  return {
    access_token: accessToken,
    refresh_token: refreshToken,
    token_type: stringValue(value.token_type) ?? "bearer",
    expires_at: stringValue(value.expires_at),
  };
}

export function getAdminApiAuthTokens(): AdminApiStoredAuthTokens | null {
  const rawTokens = adminApiAuthTokenStorage.getItem(ADMIN_API_AUTH_TOKEN_STORAGE_KEY);

  if (!rawTokens) {
    return null;
  }

  try {
    return normalizeStoredTokens(JSON.parse(rawTokens));
  } catch {
    return null;
  }
}

export function getAdminApiAccessToken(): string | null {
  const tokens = getAdminApiAuthTokens();

  return tokens?.access_token ?? null;
}

export function setAdminApiAuthTokens(
  tokens: AdminApiStoredAuthTokens | AdminApiAuthTokenResponse,
): void {
  const storedTokens: AdminApiStoredAuthTokens = {
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    token_type: tokens.token_type,
    expires_at: tokens.expires_at ?? null,
  };

  adminApiAuthTokenStorage.setItem(
    ADMIN_API_AUTH_TOKEN_STORAGE_KEY,
    JSON.stringify(storedTokens),
  );
}

export function clearAdminApiAuthTokens(): void {
  adminApiAuthTokenStorage.removeItem(ADMIN_API_AUTH_TOKEN_STORAGE_KEY);
}
