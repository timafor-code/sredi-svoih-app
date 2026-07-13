import type {
  ApiAvatarConfirmRequest,
  ApiAvatarConfirmResponse,
  ApiAvatarDeleteResponse,
  ApiAvatarReadUrlResponse,
  ApiAvatarUploadUrlRequest,
  ApiAvatarUploadUrlResponse,
  ApiCurrentUserResponse,
} from '@/types/api';

import {
  getAvatarContentType,
  readLocalAvatarImage,
  type UploadProfileAvatarInput,
} from './avatarService';
import { apiClient } from './apiClient';

const AVATAR_READ_URL_REFRESH_SKEW_MS = 60_000;

type CachedAvatarReadUrl = {
  expiresAtMs: number;
  readUrl: string;
};

const avatarReadUrlCache = new Map<string, CachedAvatarReadUrl>();

function getCachedAvatarReadUrl(avatarId: string): string | null {
  const cached = avatarReadUrlCache.get(avatarId);

  if (!cached) {
    return null;
  }

  if (cached.expiresAtMs <= Date.now() + AVATAR_READ_URL_REFRESH_SKEW_MS) {
    avatarReadUrlCache.delete(avatarId);
    return null;
  }

  return cached.readUrl;
}

export function clearAvatarReadUrlCache(avatarId?: string | null): void {
  if (avatarId) {
    avatarReadUrlCache.delete(avatarId);
    return;
  }

  avatarReadUrlCache.clear();
}

export function primeAvatarReadUrlCache(
  avatarId: string,
  readUrl: string,
  expiresAt: string,
): void {
  const expiresAtMs = Date.parse(expiresAt);

  if (!Number.isFinite(expiresAtMs)) {
    avatarReadUrlCache.delete(avatarId);
    return;
  }

  avatarReadUrlCache.set(avatarId, {
    expiresAtMs,
    readUrl,
  });
}

async function uploadBytesToObjectStorage(
  uploadUrlResponse: ApiAvatarUploadUrlResponse,
  imageBody: ArrayBuffer,
): Promise<void> {
  const response = await fetch(uploadUrlResponse.upload_url, {
    body: imageBody,
    headers: uploadUrlResponse.headers,
    method: uploadUrlResponse.method,
  });

  if (!response.ok) {
    throw new Error('Avatar upload failed.');
  }
}

export async function uploadProfileAvatarToApi(
  input: UploadProfileAvatarInput,
): Promise<string> {
  const imageBody = await readLocalAvatarImage(input);
  const uploadUrlResponse = await apiClient.post<
    ApiAvatarUploadUrlResponse,
    ApiAvatarUploadUrlRequest
  >('/me/avatar/upload-url', {
    content_type: getAvatarContentType(input),
    size_bytes: imageBody.byteLength,
  });

  await uploadBytesToObjectStorage(uploadUrlResponse, imageBody);

  const confirmedAvatar = await apiClient.post<
    ApiAvatarConfirmResponse,
    ApiAvatarConfirmRequest
  >('/me/avatar/confirm', {
    avatar_id: uploadUrlResponse.avatar_id,
  });

  primeAvatarReadUrlCache(
    confirmedAvatar.avatar_id,
    confirmedAvatar.read_url,
    confirmedAvatar.read_url_expires_at,
  );

  return confirmedAvatar.read_url;
}

export async function resolveAuthorizedAvatarReadUrl(
  avatarId: string | null | undefined,
): Promise<string | null> {
  const normalizedAvatarId = avatarId?.trim();

  if (!normalizedAvatarId) {
    return null;
  }

  const cachedReadUrl = getCachedAvatarReadUrl(normalizedAvatarId);

  if (cachedReadUrl) {
    return cachedReadUrl;
  }

  const response = await apiClient.get<ApiAvatarReadUrlResponse>(
    `/avatars/${encodeURIComponent(normalizedAvatarId)}`,
  );

  primeAvatarReadUrlCache(response.avatar_id, response.read_url, response.expires_at);

  return response.read_url;
}

export async function resolveCurrentUserAvatarReadUrl(): Promise<string | null> {
  const currentUser = await apiClient.get<ApiCurrentUserResponse>('/auth/me');
  const avatarId = currentUser.profile?.avatar_id ?? null;

  return resolveAuthorizedAvatarReadUrl(avatarId);
}

export async function deleteCurrentUserAvatar(): Promise<ApiAvatarDeleteResponse> {
  const response = await apiClient.delete<ApiAvatarDeleteResponse>('/me/avatar');

  clearAvatarReadUrlCache(response.avatar_id);

  if (!response.avatar_id) {
    clearAvatarReadUrlCache();
  }

  return response;
}
