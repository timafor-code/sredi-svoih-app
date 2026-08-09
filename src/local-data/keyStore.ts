import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';

import type { LocalDatabaseKeyState } from './types';

const DATABASE_KEY_BYTE_LENGTH = 32;
const DATABASE_KEY_HEX_LENGTH = DATABASE_KEY_BYTE_LENGTH * 2;
const DATABASE_KEY_PATTERN = /^[0-9a-f]{64}$/i;
const LOCAL_DATABASE_KEY_STORAGE_NAME = 'sredi-svoih.localDatabaseKey.v1';

const SECURE_STORE_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  requireAuthentication: false,
};

export type ValidatedDatabaseKey = string & {
  readonly __validatedDatabaseKey: unique symbol;
};

export type StoredDatabaseKeyResult =
  | { status: 'valid'; key: ValidatedDatabaseKey }
  | { status: Exclude<LocalDatabaseKeyState, 'valid'> };

export type GeneratedDatabaseKeyResult =
  | { status: 'stored'; key: ValidatedDatabaseKey }
  | { status: 'secure_store_unavailable' | 'key_generation_failed' };

export function normalizeDatabaseKey(value: unknown): ValidatedDatabaseKey | null {
  if (
    typeof value !== 'string'
    || value.length !== DATABASE_KEY_HEX_LENGTH
    || !DATABASE_KEY_PATTERN.test(value)
  ) {
    return null;
  }

  return value.toLowerCase() as ValidatedDatabaseKey;
}

export function createSqlCipherKeyPragma(value: unknown): string {
  const key = normalizeDatabaseKey(value);

  if (!key) {
    throw new Error('Invalid local database key material');
  }

  return `PRAGMA key = "x'${key}'"`;
}

export async function readStoredDatabaseKey(): Promise<StoredDatabaseKeyResult> {
  try {
    if (!(await SecureStore.isAvailableAsync())) {
      return { status: 'unavailable' };
    }

    const storedValue = await SecureStore.getItemAsync(
      LOCAL_DATABASE_KEY_STORAGE_NAME,
      SECURE_STORE_OPTIONS,
    );

    if (storedValue === null) {
      return { status: 'missing' };
    }

    const key = normalizeDatabaseKey(storedValue);

    return key ? { status: 'valid', key } : { status: 'invalid' };
  } catch {
    return { status: 'unavailable' };
  }
}

export async function generateAndStoreDatabaseKey(): Promise<GeneratedDatabaseKeyResult> {
  try {
    if (!(await SecureStore.isAvailableAsync())) {
      return { status: 'secure_store_unavailable' };
    }
  } catch {
    return { status: 'secure_store_unavailable' };
  }

  let randomBytes: Uint8Array;

  try {
    randomBytes = await Crypto.getRandomBytesAsync(DATABASE_KEY_BYTE_LENGTH);
  } catch {
    return { status: 'key_generation_failed' };
  }

  if (randomBytes.length !== DATABASE_KEY_BYTE_LENGTH) {
    return { status: 'key_generation_failed' };
  }

  const key = normalizeDatabaseKey(bytesToHex(randomBytes));

  if (!key) {
    return { status: 'key_generation_failed' };
  }

  try {
    await SecureStore.setItemAsync(
      LOCAL_DATABASE_KEY_STORAGE_NAME,
      key,
      SECURE_STORE_OPTIONS,
    );
  } catch {
    return { status: 'secure_store_unavailable' };
  }

  return { status: 'stored', key };
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}
