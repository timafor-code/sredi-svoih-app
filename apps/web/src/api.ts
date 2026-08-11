import type {
  AccountNextStep,
  ApiResponse,
  AuthCodeResult,
  OccurrenceSelectionMode,
  WebEventRegistrationFormResponse,
  WebRegistrationConfirmResult,
  WebRegistrationIntentCreated,
  WebRegistrationIntentRequest,
  WebRegistrationIntentStatus,
  WebRegistrationLegalDocument,
  WebRegistrationOccurrence,
  WebRegistrationParticipationOption,
  WebQuestionnaireField,
  WebRegistrationResendResult,
  WebRegistrationResult,
  WebRegistrationState,
} from "./types";
import {
  isCanonicalPublicPath,
  type EventRoute,
  UUID_PATTERN,
} from "./route";

const REGISTRATION_STATES = new Set<WebRegistrationState>([
  "open",
  "not_yet_open",
  "closed",
  "full",
  "unavailable",
]);

const OCCURRENCE_SELECTION_MODES = new Set<OccurrenceSelectionMode>([
  "none",
  "user_select",
  "nearest",
]);

export class RegistrationUnavailableError extends Error {}
export class PublicApiError extends Error {
  readonly code: string;
  readonly status: number | null;
  readonly retryAfterSeconds: number | null;

  constructor(code = "invalid_response", status: number | null = null, retryAfterSeconds: number | null = null) {
    super("Public API request failed");
    this.name = "PublicApiError";
    this.code = code;
    this.status = status;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

const LOCAL_HTTP_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function isSafePublicUrl(value: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }

  if (!parsed.hostname || parsed.username || parsed.password) return false;
  if (parsed.protocol === "https:") return true;
  return parsed.protocol === "http:" && LOCAL_HTTP_HOSTNAMES.has(parsed.hostname.toLowerCase());
}

export function isRecord(value: unknown): value is Record<string, unknown> {
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

const ZONED_DATE_TIME_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

function isNullableZonedDateTime(value: unknown): value is string | null {
  return value === null
    || (typeof value === "string"
      && ZONED_DATE_TIME_PATTERN.test(value)
      && Number.isFinite(Date.parse(value)));
}

function isState(value: unknown): value is WebRegistrationState {
  return typeof value === "string" && REGISTRATION_STATES.has(value as WebRegistrationState);
}

function isOccurrenceSelectionMode(value: unknown): value is OccurrenceSelectionMode {
  return typeof value === "string"
    && OCCURRENCE_SELECTION_MODES.has(value as OccurrenceSelectionMode);
}

const ACCOUNT_NEXT_STEPS = new Set<AccountNextStep>([
  "none",
  "set_password",
  "sign_in",
  "request_set_password",
]);

function isAccountNextStep(value: unknown): value is AccountNextStep {
  return typeof value === "string" && ACCOUNT_NEXT_STEPS.has(value as AccountNextStep);
}

function isOpaqueCredential(value: unknown): value is string {
  return typeof value === "string" && value.length >= 8 && value.length <= 2048;
}

function isRegistrationResult(value: unknown): value is WebRegistrationResult {
  if (!isRecord(value)) return false;
  return isUuid(value.id)
    && isUuid(value.event_id)
    && (value.occurrence_id === null || isUuid(value.occurrence_id))
    && ["confirmed", "pending", "waitlisted", "attended"].includes(String(value.status))
    && Number.isInteger(value.seats_count)
    && typeof value.seats_count === "number"
    && value.seats_count >= 1;
}

function isIntentCreated(value: unknown): value is WebRegistrationIntentCreated {
  if (!isRecord(value)) return false;
  return isOpaqueCredential(value.flow_id)
    && (value.next_step === "confirm_email" || value.next_step === "completed")
    && isDateTime(value.expires_at);
}

function isResendResult(value: unknown): value is WebRegistrationResendResult {
  return isRecord(value)
    && value.next_step === "confirm_email"
    && isDateTime(value.expires_at);
}

function isConfirmResult(value: unknown): value is WebRegistrationConfirmResult {
  if (!isRecord(value)
    || value.intent_status !== "confirmed"
    || !isRegistrationResult(value.registration)
    || !isAccountNextStep(value.account_next_step)
    || !isNullableDateTime(value.set_password_expires_at)) return false;
  if (value.account_next_step === "set_password") {
    return isOpaqueCredential(value.set_password_code) && isDateTime(value.set_password_expires_at);
  }
  return value.set_password_code === null;
}

function isIntentStatus(value: unknown): value is WebRegistrationIntentStatus {
  if (!isRecord(value)
    || !["email_verification_required", "confirmed", "not_available"].includes(String(value.state))
    || !isNullableDateTime(value.expires_at)
    || !(value.registration === null || isRegistrationResult(value.registration))
    || !(value.account_next_step === null || isAccountNextStep(value.account_next_step))) return false;
  if (value.state === "confirmed") {
    return isRegistrationResult(value.registration) && isAccountNextStep(value.account_next_step);
  }
  return value.registration === null && value.account_next_step === null;
}

function isAuthCodeResult(value: unknown): value is AuthCodeResult {
  return isRecord(value) && value.ok === true;
}

function isErrorEnvelope(value: unknown): value is { error: { code: string } } {
  return isRecord(value)
    && value.data === null
    && isRecord(value.error)
    && typeof value.error.code === "string"
    && typeof value.error.message === "string"
    && isRecord(value.meta);
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

function hasValidOccurrenceSelectionContract(
  value: Record<string, unknown>,
): boolean {
  if (!isOccurrenceSelectionMode(value.occurrence_selection_mode)
    || !(value.default_occurrence_id === null || isUuid(value.default_occurrence_id))
    || !isNullableZonedDateTime(value.next_registration_state_check_at)
    || !Array.isArray(value.occurrences)
    || !value.occurrences.every(isOccurrence)) return false;

  const occurrenceIds = value.occurrences.map((occurrence) => occurrence.id.toLowerCase());
  const defaultOccurrenceId = value.default_occurrence_id?.toLowerCase() ?? null;
  if (defaultOccurrenceId !== null && !occurrenceIds.includes(defaultOccurrenceId)) return false;

  switch (value.occurrence_selection_mode) {
    case "none":
      return occurrenceIds.length === 0
        ? defaultOccurrenceId === null
        : occurrenceIds.length === 1 && defaultOccurrenceId === occurrenceIds[0];
    case "user_select":
      return occurrenceIds.length > 1 && defaultOccurrenceId === null;
    case "nearest":
      return occurrenceIds.length > 0;
  }
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
    && isSafePublicUrl(value.published_url)
    && isDateTime(value.effective_at);
}

const QUESTIONNAIRE_FIELD_TYPES = new Set([
  "short_text",
  "long_text",
  "single_select",
  "multi_select",
  "boolean",
]);
const FIELD_KEY_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;
const OPTION_VALUE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;

function hasExactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  const actual = Object.keys(value).sort();
  return actual.length === keys.length
    && keys.slice().sort().every((key, index) => key === actual[index]);
}

function isBoundedInteger(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === "number"
    && Number.isInteger(value)
    && value >= minimum
    && value <= maximum;
}

function isQuestionnaireField(value: unknown): value is WebQuestionnaireField {
  if (!isRecord(value) || !hasExactKeys(value, [
    "id",
    "field_key",
    "field_type",
    "label",
    "required",
    "purpose",
    "retention_days",
    "options",
    "validation",
    "sort_order",
  ])) return false;
  if (!isUuid(value.id)
    || typeof value.field_key !== "string"
    || !FIELD_KEY_PATTERN.test(value.field_key)
    || typeof value.field_type !== "string"
    || !QUESTIONNAIRE_FIELD_TYPES.has(value.field_type)
    || typeof value.label !== "string"
    || value.label.length === 0
    || typeof value.required !== "boolean"
    || typeof value.purpose !== "string"
    || value.purpose.length === 0
    || !isBoundedInteger(value.retention_days, 1, 36500)
    || !isBoundedInteger(value.sort_order, 0, 100000)
    || !Array.isArray(value.options)
    || !isRecord(value.validation)) return false;

  const options = value.options;
  if (!options.every((option) => isRecord(option)
    && hasExactKeys(option, ["value", "label"])
    && typeof option.value === "string"
    && OPTION_VALUE_PATTERN.test(option.value)
    && typeof option.label === "string"
    && option.label.length > 0)) return false;
  const optionValues = options.map((option) => String((option as Record<string, unknown>).value));
  if (new Set(optionValues).size !== optionValues.length) return false;

  const validation = value.validation;
  const validationKeys = Object.keys(validation);
  const isText = value.field_type === "short_text" || value.field_type === "long_text";
  const isMulti = value.field_type === "multi_select";
  const allowedKeys = isText
    ? new Set(["min_length", "max_length"])
    : isMulti
      ? new Set(["min_selections", "max_selections"])
      : new Set<string>();
  if (validationKeys.some((key) => !allowedKeys.has(key))) return false;
  if (validationKeys.some((key) => !isBoundedInteger(validation[key], 0, 10000))) return false;
  const lower = isText ? validation.min_length : validation.min_selections;
  const upper = isText ? validation.max_length : validation.max_selections;
  if (typeof lower === "number" && typeof upper === "number" && upper < lower) return false;
  if (isMulti && (
    (typeof lower === "number" && lower > options.length)
    || (typeof upper === "number" && upper > options.length)
  )) return false;
  const isSelect = value.field_type === "single_select" || isMulti;
  return isSelect ? options.length > 0 : options.length === 0;
}

export function isWebEventRegistrationFormResponse(
  value: unknown,
): value is WebEventRegistrationFormResponse {
  if (!isRecord(value) || !isRecord(value.event)) return false;
  const event = value.event;
  return isCanonicalPublicPath(value.canonical_public_path)
    && typeof value.resolved_from_alias === "boolean"
    && isUuid(event.id)
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
    && hasValidOccurrenceSelectionContract(value)
    && Array.isArray(value.occurrences)
    && value.occurrences.every(isOccurrence)
    && Array.isArray(value.participation_options)
    && value.participation_options.every(isOption)
    && Array.isArray(value.legal_documents)
    && value.legal_documents.every(isLegalDocument)
    && (value.questionnaire_form_id === null || isUuid(value.questionnaire_form_id))
    && Array.isArray(value.questions)
    && value.questions.every(isQuestionnaireField)
    && (value.questionnaire_form_id === null ? value.questions.length === 0 : value.questions.length > 0)
    && new Set(value.questions.map((question) => question.id.toLowerCase())).size === value.questions.length
    && new Set(value.questions.map((question) => question.field_key)).size === value.questions.length
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
  reference: Pick<EventRoute, "kind" | "value">,
  signal?: AbortSignal,
): Promise<WebEventRegistrationFormResponse> {
  const path = reference.kind === "uuid"
    ? `/events/${encodeURIComponent(reference.value)}/registration-form?channel=web`
    : `/web/events/${encodeURIComponent(reference.value)}/registration-form`;
  const response = await fetch(
    `${normalizedBaseUrl()}${path}`,
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
    || (reference.kind === "uuid"
      && body.data.event.id.toLowerCase() !== reference.value.toLowerCase())
  ) {
    throw new PublicApiError();
  }

  const data = (body as ApiResponse<WebEventRegistrationFormResponse>).data;
  return {
    ...data,
    event: {
      ...data.event,
      image_url: data.event.image_url && isSafePublicUrl(data.event.image_url)
        ? data.event.image_url
        : null,
    },
  };
}

function retryAfterSeconds(response: Response): number | null {
  const value = response.headers.get("Retry-After");
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds);
  const date = Date.parse(value);
  if (!Number.isFinite(date)) return null;
  return Math.max(0, Math.ceil((date - Date.now()) / 1000));
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new PublicApiError("invalid_response", response.status);
  }
}

async function publicJsonRequest<T>(
  path: string,
  init: RequestInit,
  validator: (value: unknown) => value is T,
): Promise<T> {
  const response = await fetch(`${normalizedBaseUrl()}${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      ...(init.body === undefined ? {} : { "Content-Type": "application/json" }),
      ...init.headers,
    },
    credentials: "omit",
  });
  const body = await readJson(response);
  if (!response.ok) {
    if (!isErrorEnvelope(body)) throw new PublicApiError("invalid_response", response.status);
    throw new PublicApiError(body.error.code, response.status, retryAfterSeconds(response));
  }
  if (!isRecord(body) || body.error !== null || !isRecord(body.meta) || !validator(body.data)) {
    throw new PublicApiError("invalid_response", response.status);
  }
  return body.data;
}

async function authCodeRequest(path: string, body: Record<string, string>): Promise<AuthCodeResult> {
  const response = await fetch(`${normalizedBaseUrl()}${path}`, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    credentials: "omit",
    body: JSON.stringify(body),
  });
  const responseBody = await readJson(response);
  if (!response.ok) {
    if (!isErrorEnvelope(responseBody)) throw new PublicApiError("invalid_response", response.status);
    throw new PublicApiError(responseBody.error.code, response.status, retryAfterSeconds(response));
  }
  if (!isAuthCodeResult(responseBody)) throw new PublicApiError("invalid_response", response.status);
  return responseBody;
}

export function createWebRegistrationIntent(
  payload: WebRegistrationIntentRequest,
): Promise<WebRegistrationIntentCreated> {
  return publicJsonRequest(
    "/web/registration-intents",
    { method: "POST", body: JSON.stringify(payload) },
    isIntentCreated,
  );
}

export function getWebRegistrationIntentStatus(
  flowId: string,
): Promise<WebRegistrationIntentStatus> {
  return publicJsonRequest(
    `/web/registration-intents/${encodeURIComponent(flowId)}/status`,
    { method: "GET" },
    isIntentStatus,
  );
}

export function resendWebRegistrationCode(
  flowId: string,
): Promise<WebRegistrationResendResult> {
  return publicJsonRequest(
    `/web/registration-intents/${encodeURIComponent(flowId)}/resend-code`,
    { method: "POST" },
    isResendResult,
  );
}

export function confirmWebRegistrationEmail(
  flowId: string,
  code: string,
): Promise<WebRegistrationConfirmResult> {
  return publicJsonRequest(
    `/web/registration-intents/${encodeURIComponent(flowId)}/confirm-email`,
    { method: "POST", body: JSON.stringify({ code }) },
    isConfirmResult,
  );
}

export function requestSetPassword(email: string): Promise<AuthCodeResult> {
  return authCodeRequest("/auth/request-set-password", { email });
}

export function confirmSetPassword(code: string, newPassword: string): Promise<AuthCodeResult> {
  return authCodeRequest("/auth/confirm-set-password", {
    code,
    new_password: newPassword,
  });
}
