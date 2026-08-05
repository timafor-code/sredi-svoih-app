import type {
  ApiResponse,
  WebEventRegistrationFormResponse,
  WebRegistrationLegalDocument,
  WebRegistrationOccurrence,
  WebRegistrationParticipationOption,
  WebRegistrationState,
} from "./types";
import { UUID_PATTERN } from "./route";

const REGISTRATION_STATES = new Set<WebRegistrationState>([
  "open",
  "not_yet_open",
  "closed",
  "full",
  "unavailable",
]);

export class RegistrationUnavailableError extends Error {}
export class PublicApiError extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNullableString(value: unknown): value is string | null {
  return typeof value === "string" || value === null;
}

function isNullableNumber(value: unknown): value is number | null {
  return typeof value === "number" || value === null;
}

function isNullableBoolean(value: unknown): value is boolean | null {
  return typeof value === "boolean" || value === null;
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function isDateTime(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function isNullableDateTime(value: unknown): value is string | null {
  return value === null || isDateTime(value);
}

function isState(value: unknown): value is WebRegistrationState {
  return typeof value === "string" && REGISTRATION_STATES.has(value as WebRegistrationState);
}

function isOccurrence(value: unknown): value is WebRegistrationOccurrence {
  if (!isRecord(value)) return false;
  return isUuid(value.id)
    && isUuid(value.event_id)
    && isNullableString(value.title)
    && isDateTime(value.starts_at)
    && isNullableDateTime(value.ends_at)
    && typeof value.timezone === "string"
    && isNullableDateTime(value.registration_opens_at)
    && isNullableDateTime(value.registration_closes_at)
    && isNullableNumber(value.capacity)
    && isNullableBoolean(value.waitlist_enabled)
    && isNullableBoolean(value.requires_approval)
    && isState(value.registration_state);
}

function isOption(value: unknown): value is WebRegistrationParticipationOption {
  if (!isRecord(value)) return false;
  return isUuid(value.id)
    && isUuid(value.event_id)
    && typeof value.title === "string"
    && isNullableString(value.description)
    && typeof value.price_amount === "number"
    && typeof value.price_currency === "string"
    && typeof value.option_type === "string"
    && isNullableNumber(value.seat_limit)
    && typeof value.allow_quantity === "boolean"
    && typeof value.min_quantity === "number"
    && typeof value.max_quantity === "number"
    && Number.isInteger(value.min_quantity)
    && Number.isInteger(value.max_quantity)
    && value.min_quantity >= 1
    && value.max_quantity >= value.min_quantity
    && typeof value.counts_toward_capacity === "boolean"
    && isNullableString(value.group_key)
    && Number.isInteger(value.sort_order);
}

function isLegalDocument(value: unknown): value is WebRegistrationLegalDocument {
  if (!isRecord(value)) return false;
  return isUuid(value.id)
    && (value.document_type === "event_registration_consent" || value.document_type === "privacy_policy")
    && typeof value.version === "string"
    && typeof value.title === "string"
    && typeof value.content_hash === "string"
    && typeof value.published_url === "string"
    && isDateTime(value.effective_at);
}

export function isWebEventRegistrationFormResponse(
  value: unknown,
): value is WebEventRegistrationFormResponse {
  if (!isRecord(value) || !isRecord(value.event)) return false;
  const event = value.event;
  return isUuid(event.id)
    && typeof event.title === "string"
    && isNullableString(event.subtitle)
    && isNullableString(event.description)
    && isNullableString(event.short_description)
    && isDateTime(event.starts_at)
    && isNullableDateTime(event.ends_at)
    && isNullableString(event.timezone)
    && isNullableString(event.location_name)
    && isNullableString(event.address)
    && isNullableString(event.image_url)
    && typeof event.category === "string"
    && isNullableNumber(event.capacity)
    && typeof event.waitlist_enabled === "boolean"
    && typeof event.requires_approval === "boolean"
    && isState(value.registration_state)
    && Array.isArray(value.occurrences)
    && value.occurrences.every(isOccurrence)
    && Array.isArray(value.participation_options)
    && value.participation_options.every(isOption)
    && Array.isArray(value.legal_documents)
    && value.legal_documents.every(isLegalDocument)
    && value.legal_documents.filter(
      (document) => isRecord(document) && document.document_type === "event_registration_consent",
    ).length === 1
    && value.legal_documents.filter(
      (document) => isRecord(document) && document.document_type === "privacy_policy",
    ).length <= 1
    && value.occurrences.every(
      (occurrence) => occurrence.event_id.toLowerCase() === String(event.id).toLowerCase(),
    )
    && value.participation_options.every(
      (option) => option.event_id.toLowerCase() === String(event.id).toLowerCase(),
    );
}

function normalizedBaseUrl(): string {
  return (import.meta.env.VITE_WEB_API_BASE_URL || "/api").replace(/\/+$/, "");
}

export async function getWebEventRegistrationForm(
  eventId: string,
  signal?: AbortSignal,
): Promise<WebEventRegistrationFormResponse> {
  const response = await fetch(
    `${normalizedBaseUrl()}/events/${encodeURIComponent(eventId)}/registration-form?channel=web`,
    {
      method: "GET",
      headers: { Accept: "application/json" },
      credentials: "omit",
      signal,
    },
  );

  if (response.status === 404) {
    throw new RegistrationUnavailableError();
  }
  if (!response.ok) {
    throw new PublicApiError();
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new PublicApiError();
  }

  if (
    !isRecord(body)
    || body.error !== null
    || !isRecord(body.meta)
    || !isWebEventRegistrationFormResponse(body.data)
    || body.data.event.id.toLowerCase() !== eventId.toLowerCase()
  ) {
    throw new PublicApiError();
  }

  return (body as ApiResponse<WebEventRegistrationFormResponse>).data;
}
