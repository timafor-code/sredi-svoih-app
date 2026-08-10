import { apiClient } from "./apiClient";
import type { AdminApiEventPublicSlugCheckResponse } from "../types/api";
import type {
  AdminEventPublicSlugCheckResult,
  AdminEventWebRegistration,
  UpdateAdminEventWebRegistrationInput,
} from "../types/events";

type AdminEventWebRegistrationUpdatePayload = {
  web_visibility?: UpdateAdminEventWebRegistrationInput["webVisibility"];
  public_slug?: string;
};

type AdminEventPublicSlugCheckPayload = {
  public_slug: string;
};

const WEB_REGISTRATION_CONTRACT_ERROR =
  "Ответ API веб-регистрации несовместим с текущей версией web-admin. Пересоберите и перезапустите API.";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

function normalizeAdminEventWebRegistration(
  response: unknown,
): AdminEventWebRegistration {
  if (
    !isRecord(response)
    || !isNonEmptyString(response.event_id)
    || !isNonEmptyString(response.public_slug)
    || !isNonEmptyString(response.public_registration_url)
    || (
      response.web_visibility !== "disabled"
      && response.web_visibility !== "unlisted"
      && response.web_visibility !== "listed"
    )
  ) {
    throw new Error(WEB_REGISTRATION_CONTRACT_ERROR);
  }

  return {
    eventId: response.event_id,
    webVisibility: response.web_visibility,
    publicSlug: response.public_slug,
    publicRegistrationUrl: response.public_registration_url,
  };
}

export async function getAdminEventWebRegistration(
  eventId: string,
): Promise<AdminEventWebRegistration> {
  const response = await apiClient.get<unknown>(
    `/admin/events/${encodeURIComponent(eventId)}/web-registration`,
  );

  return normalizeAdminEventWebRegistration(response);
}

export async function updateAdminEventWebRegistration(
  eventId: string,
  input: UpdateAdminEventWebRegistrationInput,
): Promise<AdminEventWebRegistration> {
  const payload: AdminEventWebRegistrationUpdatePayload = {};
  if (input.webVisibility !== undefined) {
    payload.web_visibility = input.webVisibility;
  }
  if (input.publicSlug !== undefined) {
    payload.public_slug = input.publicSlug;
  }
  if (Object.keys(payload).length === 0) {
    throw new Error("At least one web-registration field is required.");
  }

  const response = await apiClient.patch<unknown, AdminEventWebRegistrationUpdatePayload>(
    `/admin/events/${encodeURIComponent(eventId)}/web-registration`,
    payload,
  );

  return normalizeAdminEventWebRegistration(response);
}

export async function checkAdminEventPublicSlug(
  eventId: string,
  publicSlug: string,
  signal?: AbortSignal,
): Promise<AdminEventPublicSlugCheckResult> {
  const response = await apiClient.post<
    AdminApiEventPublicSlugCheckResponse,
    AdminEventPublicSlugCheckPayload
  >(
    `/admin/events/${encodeURIComponent(eventId)}/web-registration/check-slug`,
    { public_slug: publicSlug },
    { signal },
  );

  return {
    normalizedSlug: response.normalized_slug,
    available: response.available,
    reason: response.reason,
  };
}
