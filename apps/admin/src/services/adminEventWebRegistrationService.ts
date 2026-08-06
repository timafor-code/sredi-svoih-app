import { apiClient } from "./apiClient";
import type { AdminApiEventWebRegistrationResponse } from "../types/api";
import type {
  AdminEventWebRegistration,
  UpdateAdminEventWebRegistrationInput,
} from "../types/events";

type AdminEventWebRegistrationUpdatePayload = {
  web_visibility: UpdateAdminEventWebRegistrationInput["webVisibility"];
};

function normalizeAdminEventWebRegistration(
  response: AdminApiEventWebRegistrationResponse,
): AdminEventWebRegistration {
  return {
    eventId: response.event_id,
    webVisibility: response.web_visibility,
    publicRegistrationUrl: response.public_registration_url,
    occurrenceUrls: response.occurrence_urls.map((occurrence) => ({
      occurrenceId: occurrence.occurrence_id,
      startsAt: occurrence.starts_at,
      url: occurrence.url,
    })),
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
  const response = await apiClient.patch<
    AdminApiEventWebRegistrationResponse,
    AdminEventWebRegistrationUpdatePayload
  >(`/admin/events/${encodeURIComponent(eventId)}/web-registration`, {
    web_visibility: input.webVisibility,
  });

  return normalizeAdminEventWebRegistration(response);
}
