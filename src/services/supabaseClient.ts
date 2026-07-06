import { createClient } from '@supabase/supabase-js';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

type SupabaseStorage = {
  getItem: (key: string) => Promise<string | null> | string | null;
  setItem: (key: string, value: string) => Promise<void> | void;
  removeItem: (key: string) => Promise<void> | void;
};

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

const expoStorage: SupabaseStorage = {
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

if (!supabaseUrl) {
  throw new Error('Missing EXPO_PUBLIC_SUPABASE_URL');
}

if (!supabaseAnonKey) {
  throw new Error('Missing EXPO_PUBLIC_SUPABASE_ANON_KEY');
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: expoStorage,
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
    flowType: 'pkce',
  },
});

export async function getCurrentSupabaseAccessToken(): Promise<string | null> {
  const { data, error } = await supabase.auth.getSession();

  if (error) {
    return null;
  }

  return data.session?.access_token ?? null;
}
