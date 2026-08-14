import { ApiClientError, apiClient, DEFAULT_API_TIMEOUT_MS } from "./apiClient";
import { normalizeAdminEventRow } from "./adminEventsService";
import type { AdminApiEventResponse } from "../types/api";
import type { AdminEvent } from "../types/events";

const EVENT_IMAGE_UPLOAD_TIMEOUT_MS = Math.max(DEFAULT_API_TIMEOUT_MS * 4, 60000);

export type AdminEventImageRequestOptions = {
  signal?: AbortSignal;
  timeoutMs?: number;
};

export async function uploadAdminEventImage(
  eventId: string,
  file: File,
  options: AdminEventImageRequestOptions = {},
): Promise<AdminEvent> {
  const formData = new FormData();
  formData.append("file", file);

  const event = await apiClient.put<AdminApiEventResponse, FormData>(
    `/admin/events/${encodeURIComponent(eventId)}/image`,
    formData,
    {
      signal: options.signal,
      timeoutMs: options.timeoutMs ?? EVENT_IMAGE_UPLOAD_TIMEOUT_MS,
    },
  );

  const normalizedEvent = normalizeAdminEventRow(event);
  if (!normalizedEvent.imageUrl) {
    throw new ApiClientError({
      error: {
        code: "invalid_event_image_response",
        message: "The event image response did not include an active image URL.",
      },
      status: 502,
    });
  }

  return normalizedEvent;
}

export async function removeAdminEventImage(
  eventId: string,
  options: AdminEventImageRequestOptions = {},
): Promise<AdminEvent> {
  const event = await apiClient.delete<AdminApiEventResponse>(
    `/admin/events/${encodeURIComponent(eventId)}/image`,
    {
      signal: options.signal,
      timeoutMs: options.timeoutMs,
    },
  );

  const normalizedEvent = normalizeAdminEventRow(event);
  if (normalizedEvent.imageUrl !== null) {
    throw new ApiClientError({
      error: {
        code: "invalid_event_image_response",
        message: "The event image removal response still included an image URL.",
      },
      status: 502,
    });
  }

  return normalizedEvent;
}

export function getAdminEventImageErrorMessage(error: unknown): string {
  if (!(error instanceof ApiClientError)) {
    return "Не удалось изменить изображение. Текущая картинка не изменена.";
  }

  if (error.code === "unsupported_event_image_type") {
    return "Выберите файл JPG, PNG или WebP.";
  }

  if (error.code === "event_image_too_large") {
    return "Файл больше 12 МБ. Выберите изображение меньшего размера.";
  }

  if (error.code === "invalid_event_image") {
    return "Не удалось прочитать изображение. Выберите другой файл.";
  }

  if (error.code === "event_image_storage_unavailable") {
    return "Хранилище изображений временно недоступно. Текущая картинка не изменена.";
  }

  if (error.code === "request_timeout" || error.code === "network_error") {
    return "Не удалось загрузить изображение. Текущая картинка не изменена.";
  }

  if (error.code === "not_found") {
    return "Событие не найдено или недоступно для текущей роли.";
  }

  if (
    error.code === "unauthenticated"
    || error.code === "forbidden"
    || error.status === 401
    || error.status === 403
  ) {
    return "Нет доступа к событию для текущей сессии. Проверьте вход и роль.";
  }

  return "Не удалось изменить изображение. Текущая картинка не изменена.";
}

export { EVENT_IMAGE_UPLOAD_TIMEOUT_MS };
