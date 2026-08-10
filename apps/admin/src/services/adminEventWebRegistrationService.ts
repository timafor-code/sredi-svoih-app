import { apiClient } from "./apiClient";
import type {
  AdminApiEventPublicSlugCheckResponse,
  AdminApiEventWebRegistrationResponse,
} from "../types/api";
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

function normalizeAdminEventWebRegistration(
  response: AdminApiEventWebRegistrationResponse,
): AdminEventWebRegistration {
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
  const response = await apiClient.get<AdminApiEventWebRegistrationResponse>(
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

  const response = await apiClient.patch<
    AdminApiEventWebRegistrationResponse,
    AdminEventWebRegistrationUpdatePayload
  >(`/admin/events/${encodeURIComponent(eventId)}/web-registration`, payload);

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
