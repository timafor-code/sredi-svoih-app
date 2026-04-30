import { supabase } from './supabaseClient';

const AVATARS_BUCKET = 'avatars';
const AVATAR_FILE_NAME = 'avatar.jpg';
const IMAGE_CONTENT_TYPES: Record<string, string> = {
  heic: 'image/heic',
  heif: 'image/heif',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

type UploadProfileAvatarInput = {
  base64?: string | null;
  fileName?: string | null;
  mimeType?: string | null;
  uri: string;
};

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function getSafeImageExtension(value: string | null | undefined): string {
  const cleanValue = value?.split(/[?#]/)[0] ?? '';
  const extension = cleanValue.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase();

  if (!extension) {
    return 'jpg';
  }

  return IMAGE_CONTENT_TYPES[extension] ? extension : 'jpg';
}

function getContentType(input: UploadProfileAvatarInput): string {
  const normalizedMimeType = input.mimeType?.toLowerCase();

  if (normalizedMimeType === 'image/jpg') {
    return 'image/jpeg';
  }

  if (normalizedMimeType && Object.values(IMAGE_CONTENT_TYPES).includes(normalizedMimeType)) {
    return normalizedMimeType;
  }

  return IMAGE_CONTENT_TYPES[getSafeImageExtension(input.fileName ?? input.uri)] ?? 'image/jpeg';
}

function decodeBase64ToArrayBuffer(value: string): ArrayBuffer {
  const normalized = value
    .replace(/[\r\n\s]/g, '')
    .replace(/-/g, '+')
    .replace(/_/g, '/')
    .replace(/=+$/g, '');
  const bytes: number[] = [];
  let buffer = 0;
  let bits = 0;

  for (const char of normalized) {
    const index = BASE64_ALPHABET.indexOf(char);

    if (index < 0) {
      throw new Error('Не удалось прочитать выбранное фото.');
    }

    buffer = (buffer << 6) | index;
    bits += 6;

    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 0xff);
    }
  }

  return Uint8Array.from(bytes).buffer;
}

async function readLocalImage(input: UploadProfileAvatarInput): Promise<ArrayBuffer> {
  if (input.base64) {
    return decodeBase64ToArrayBuffer(input.base64);
  }

  try {
    const response = await fetch(input.uri);

    return response.arrayBuffer();
  } catch {
    throw new Error('Не удалось прочитать выбранное фото.');
  }
}

export async function uploadProfileAvatar(input: UploadProfileAvatarInput): Promise<string> {
  const { data, error } = await supabase.auth.getSession();

  if (error) {
    throw new Error(error.message);
  }

  const user = data.session?.user;

  if (!user) {
    throw new Error('Auth required');
  }

  const filePath = `${user.id}/${AVATAR_FILE_NAME}`;
  const imageBody = await readLocalImage(input);
  const { error: uploadError } = await supabase.storage
    .from(AVATARS_BUCKET)
    .upload(filePath, imageBody, {
      cacheControl: '3600',
      contentType: getContentType(input),
      upsert: true,
    });

  if (uploadError) {
    throw new Error(uploadError.message);
  }

  const { data: publicUrlData } = supabase.storage
    .from(AVATARS_BUCKET)
    .getPublicUrl(filePath);

  return publicUrlData.publicUrl;
}

export async function uploadAvatar(uri: string): Promise<string> {
  return uploadProfileAvatar({ uri });
}
