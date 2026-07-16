import {
  clearAvatarReadUrlCache,
  deleteCurrentUserAvatar as deleteCurrentUserAvatarViaApi,
  resolveAuthorizedAvatarReadUrl,
  resolveCurrentUserAvatarReadUrl,
  uploadProfileAvatarToApi,
} from './avatarApiService';

const IMAGE_CONTENT_TYPES: Record<string, string> = {
  heic: 'image/heic',
  heif: 'image/heif',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};
const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export type UploadProfileAvatarInput = {
  base64?: string | null;
  fileName?: string | null;
  mimeType?: string | null;
  uri: string;
};

export function isApiAvatarProviderEnabled(): boolean {
  return true;
}

export function getAvatarContentType(input: UploadProfileAvatarInput): string {
  const mimeType = input.mimeType?.toLowerCase();
  if (mimeType === 'image/jpg') return 'image/jpeg';
  if (mimeType && Object.values(IMAGE_CONTENT_TYPES).includes(mimeType)) return mimeType;

  const extension = (input.fileName ?? input.uri).split(/[?#]/)[0]
    .match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase() ?? 'jpg';
  return IMAGE_CONTENT_TYPES[extension] ?? 'image/jpeg';
}

function decodeBase64ToArrayBuffer(value: string): ArrayBuffer {
  const normalized = value.replace(/[\r\n\s]/g, '').replace(/-/g, '+').replace(/_/g, '/')
    .replace(/=+$/g, '');
  const bytes: number[] = [];
  let buffer = 0;
  let bits = 0;

  for (const char of normalized) {
    const index = BASE64_ALPHABET.indexOf(char);
    if (index < 0) throw new Error('Не удалось прочитать выбранное фото.');
    buffer = (buffer << 6) | index;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 0xff);
    }
  }

  return Uint8Array.from(bytes).buffer;
}

export async function readLocalAvatarImage(input: UploadProfileAvatarInput): Promise<ArrayBuffer> {
  if (input.base64) return decodeBase64ToArrayBuffer(input.base64);
  try {
    return await (await fetch(input.uri)).arrayBuffer();
  } catch {
    throw new Error('Не удалось прочитать выбранное фото.');
  }
}

export async function uploadProfileAvatar(input: UploadProfileAvatarInput): Promise<string> {
  return uploadProfileAvatarToApi(input);
}

export async function uploadAvatar(uri: string): Promise<string> {
  return uploadProfileAvatar({ uri });
}

export { resolveAuthorizedAvatarReadUrl, resolveCurrentUserAvatarReadUrl };

export async function deleteCurrentUserAvatar(): Promise<void> {
  await deleteCurrentUserAvatarViaApi();
}

export async function clearAvatarReadUrlMemoryCache(): Promise<void> {
  clearAvatarReadUrlCache();
}
