import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import type { ApiAuthTokenResponse, ApiStoredAuthTokens } from '@/types/api';

const API_AUTH_TOKEN_STORAGE_KEY = 'sredi-svoih.apiAuthTokens.v1';
const memoryStorage = new Map<string, string>();

type ApiAuthTokenStorage = {
  getItem: (key: string) => Promise<string | null> | string | null;
  setItem: (key: string, value: string) => Promise<void> | void;
  removeItem: (key: string) => Promise<void> | void;
};

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

const apiAuthTokenStorage: ApiAuthTokenStorage = {
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null;
}

function normalizeStoredTokens(value: unknown): ApiStoredAuthTokens | null {
  if (!isRecord(value)) {
    return null;
  }

  const accessToken = stringValue(value.access_token);
  const refreshToken = stringValue(value.refresh_token);
  const expiresAt = stringValue(value.expires_at);

  if (!accessToken || !refreshToken || !expiresAt) {
    return null;
  }

  return {
    access_token: accessToken,
    refresh_token: refreshToken,
    token_type: stringValue(value.token_type) ?? 'bearer',
    expires_at: expiresAt,
  };
}

export async function getApiAuthTokens(): Promise<ApiStoredAuthTokens | null> {
  const rawTokens = await apiAuthTokenStorage.getItem(API_AUTH_TOKEN_STORAGE_KEY);

  if (!rawTokens) {
    return null;
  }

  try {
    return normalizeStoredTokens(JSON.parse(rawTokens));
  } catch {
    return null;
  }
}

export async function getApiAccessToken(): Promise<string | null> {
  const tokens = await getApiAuthTokens();

  return tokens?.access_token ?? null;
}

export async function setApiAuthTokens(
  tokens: ApiStoredAuthTokens | ApiAuthTokenResponse,
): Promise<void> {
  const storedTokens: ApiStoredAuthTokens = {
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    token_type: tokens.token_type,
    expires_at: tokens.expires_at,
  };

  await apiAuthTokenStorage.setItem(
    API_AUTH_TOKEN_STORAGE_KEY,
    JSON.stringify(storedTokens),
  );
}

export async function clearApiAuthTokens(): Promise<void> {
  await apiAuthTokenStorage.removeItem(API_AUTH_TOKEN_STORAGE_KEY);
}
