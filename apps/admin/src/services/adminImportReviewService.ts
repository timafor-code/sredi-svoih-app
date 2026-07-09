import { ApiClientError, apiClient } from "./apiClient";
import { formatImportApiError } from "./adminWebsiteImportService";
import { normalizeAdminEventRow } from "./adminEventsService";
import type {
  AdminApiImportItemResponse,
  AdminApiImportPublishResponse,
  AdminImportAdminReview,
  AdminImportImageMirrorMetadata,
  AdminPublishImportItemPayload,
  AdminPublishImportItemResult,
  AdminImportReview,
  AdminImportReviewItem,
  JsonObject,
  JsonValue,
} from "../types/importReview";

const ADMIN_IMPORT_ITEMS_PATH = "/admin/import-items";
const DEFAULT_REVIEW_LIMIT = 50;
const MAX_REVIEW_LIMIT = 100;

type AdminImportItemApiPublishPayload = {
  event_kind?: string;
  title?: string;
  subtitle?: string | null;
  description?: string | null;
  short_description?: string | null;
  starts_at?: string | null;
  ends_at?: string | null;
  is_permanent?: boolean;
  timezone?: string;
  location_name?: string | null;
  address?: string | null;
  image_url?: string | null;
  category?: string;
  audience?: string | null;
  visibility?: string;
  status?: string;
  source_url?: string | null;
  registration_mode?: string;
  registration_url?: string | null;
  capacity?: number | null;
  waitlist_enabled?: boolean;
  requires_approval?: boolean;
  price_amount?: number | null;
  price_currency?: string;
};

function isJsonObject(value: JsonValue | null | undefined): value is JsonObject {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function nullableString(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  return typeof value === "string" ? value : String(value);
}

function nullableNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function nullableBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();

    if (["true", "1", "yes"].includes(normalized)) {
      return true;
    }

    if (["false", "0", "no"].includes(normalized)) {
      return false;
    }
  }

  return null;
}

function normalizeImageMirror(value: JsonValue | undefined): AdminImportImageMirrorMetadata | null {
  if (!isJsonObject(value)) {
    return null;
  }

  const status = nullableString(value.status);

  if (!status || !["stored", "missing", "failed", "skipped"].includes(status)) {
    return null;
  }

  return {
    ...value,
    status,
    originalUrl: nullableString(value.originalUrl),
    storageBucket: nullableString(value.storageBucket),
    storagePath: nullableString(value.storagePath),
    publicUrl: nullableString(value.publicUrl),
    contentType: nullableString(value.contentType),
    byteSize: nullableNumber(value.byteSize),
    sha256: nullableString(value.sha256),
    checkedAt: nullableString(value.checkedAt),
    error: nullableString(value.error),
  };
}

function normalizeLimit(limit?: number): number {
  if (typeof limit !== "number" || !Number.isFinite(limit)) {
    return DEFAULT_REVIEW_LIMIT;
  }

  return Math.min(Math.max(Math.trunc(limit), 1), MAX_REVIEW_LIMIT);
}

function normalizeImportReview(rawPayload: JsonValue): AdminImportReview | null {
  if (!isJsonObject(rawPayload)) {
    return null;
  }

  const review = rawPayload.importReview;

  if (!isJsonObject(review)) {
    return null;
  }

  return {
    ...review,
    dateConfidence: nullableString(review.dateConfidence),
    dateStatus: nullableString(review.dateStatus),
    reason: nullableString(review.reason),
    notes: nullableString(review.notes),
    rawDateText: nullableString(review.rawDateText),
    rawTimeText: nullableString(review.rawTimeText),
    inferred: nullableBoolean(review.inferred),
    assumedYear: nullableNumber(review.assumedYear),
    suggestedStartsAt: nullableString(review.suggestedStartsAt),
    parserVersion: nullableString(review.parserVersion),
    reviewNeeded: nullableBoolean(review.reviewNeeded),
    needsReview: nullableBoolean(review.needsReview),
    draftEventCreated: nullableBoolean(review.draftEventCreated),
    draftEventId: nullableString(review.draftEventId),
    draftSkipReason: nullableString(review.draftSkipReason),
    imageMirror: normalizeImageMirror(review.imageMirror),
  };
}

function normalizeAdminReview(rawPayload: JsonValue): AdminImportAdminReview | null {
  if (!isJsonObject(rawPayload)) {
    return null;
  }

  const review = rawPayload.adminReview;

  if (!isJsonObject(review)) {
    return null;
  }

  return {
    ...review,
    ignoredAt: nullableString(review.ignoredAt),
    ignoredBy: nullableString(review.ignoredBy),
    ignoreReason: nullableString(review.ignoreReason),
  };
}

function normalizeImportItemRow(row: AdminApiImportItemResponse): AdminImportReviewItem {
  const rawPayload = row.raw_payload ?? {};

  return {
    id: row.id,
    sourceId: row.source_id,
    runId: row.run_id,
    externalId: row.external_id,
    sourceUrl: row.source_url,
    parsedTitle: row.parsed_title,
    parsedStartsAt: row.parsed_starts_at,
    parsedLocation: row.parsed_location,
    rawPayload,
    status: row.status,
    createdAt: row.created_at,
    linkedEventId: row.linked_event_id,
    importReview: normalizeImportReview(rawPayload),
    adminReview: normalizeAdminReview(rawPayload),
    sourceName: nullableString(row.source_title),
    communityId: row.community_id,
  };
}

function normalizeSingleImportItem(
  data: AdminApiImportItemResponse | null,
): AdminImportReviewItem {
  if (!data) {
    throw new Error("Import item не найден или API вернул пустой результат.");
  }

  return normalizeImportItemRow(data);
}

function buildPublishApiPayload(
  payload: AdminPublishImportItemPayload,
): AdminImportItemApiPublishPayload {
  // manual_override is enforced server-side by the publish endpoint and is not
  // part of the API request schema.
  return compactUndefined({
    event_kind: payload.eventKind,
    title: payload.title,
    subtitle: payload.subtitle,
    description: payload.description,
    short_description: payload.shortDescription,
    starts_at: payload.startsAt,
    ends_at: payload.endsAt,
    is_permanent: payload.isPermanent,
    timezone: payload.timezone,
    location_name: payload.locationName,
    address: payload.address,
    image_url: payload.imageUrl,
    category: payload.category,
    audience: payload.audience,
    visibility: payload.visibility,
    status: payload.status,
    source_url: payload.sourceUrl,
    registration_mode: payload.registrationMode,
    registration_url: payload.registrationUrl,
    capacity: payload.capacity,
    waitlist_enabled: payload.waitlistEnabled,
    requires_approval: payload.requiresApproval,
    price_amount: payload.priceAmount,
    price_currency: payload.priceCurrency,
  });
}

function compactUndefined<T extends Record<string, unknown>>(payload: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(payload).filter(([, value]) => value !== undefined),
  ) as Partial<T>;
}

function formatImportReviewApiError(error: unknown, fallbackAction: string): string {
  if (
    error instanceof ApiClientError &&
    error.code === "validation_error" &&
    error.message.toLowerCase().includes("starts_at")
  ) {
    return `${fallbackAction}: у элемента импорта нет корректной даты начала (starts_at). Укажите дату и время начала вручную в форме черновика. ${error.message}`;
  }

  return formatImportApiError(error, fallbackAction);
}

export async function listImportItemsNeedingReview(
  limit?: number,
): Promise<AdminImportReviewItem[]> {
  const limitCount = normalizeLimit(limit);
  let rows: AdminApiImportItemResponse[] | null;

  try {
    rows = await apiClient.get<AdminApiImportItemResponse[] | null>(ADMIN_IMPORT_ITEMS_PATH, {
      query: { limit: limitCount },
    });
  } catch (error) {
    throw new Error(
      formatImportReviewApiError(error, "Не удалось загрузить элементы импорта"),
    );
  }

  return (rows ?? []).map(normalizeImportItemRow);
}

export async function getImportItem(importItemId: string): Promise<AdminImportReviewItem> {
  const normalizedId = importItemId.trim();

  if (!normalizedId) {
    throw new Error("Не удалось загрузить import item: пустой id.");
  }

  let row: AdminApiImportItemResponse | null;

  try {
    row = await apiClient.get<AdminApiImportItemResponse | null>(
      `${ADMIN_IMPORT_ITEMS_PATH}/${encodeURIComponent(normalizedId)}`,
    );
  } catch (error) {
    throw new Error(formatImportReviewApiError(error, "Не удалось загрузить import item"));
  }

  return normalizeSingleImportItem(row);
}

export async function ignoreImportItem(
  importItemId: string,
  reason?: string,
): Promise<AdminImportReviewItem> {
  const normalizedId = importItemId.trim();
  const normalizedReason = reason?.trim();

  if (!normalizedId) {
    throw new Error("Не удалось игнорировать import item: пустой id.");
  }

  let row: AdminApiImportItemResponse | null;

  try {
    row = await apiClient.post<AdminApiImportItemResponse | null>(
      `${ADMIN_IMPORT_ITEMS_PATH}/${encodeURIComponent(normalizedId)}/ignore`,
      {
        reason: normalizedReason && normalizedReason.length > 0 ? normalizedReason : null,
      },
    );
  } catch (error) {
    throw new Error(formatImportReviewApiError(error, "Не удалось игнорировать import item"));
  }

  return normalizeSingleImportItem(row);
}

export async function publishImportItemAsDraft(
  importItemId: string,
  payload: AdminPublishImportItemPayload,
): Promise<AdminPublishImportItemResult> {
  const normalizedId = importItemId.trim();

  if (!normalizedId) {
    throw new Error("Не удалось создать событие из import item: пустой id.");
  }

  const apiPayload = buildPublishApiPayload({
    ...payload,
    status: "draft",
    visibility: "hidden",
  });

  let response: AdminApiImportPublishResponse | null;

  try {
    response = await apiClient.post<
      AdminApiImportPublishResponse | null,
      AdminImportItemApiPublishPayload
    >(`${ADMIN_IMPORT_ITEMS_PATH}/${encodeURIComponent(normalizedId)}/publish`, apiPayload);
  } catch (error) {
    throw new Error(
      formatImportReviewApiError(error, "Не удалось создать событие-черновик из import item"),
    );
  }

  if (!response) {
    throw new Error("API вернул пустой результат публикации import item.");
  }

  const event = response.event ? normalizeAdminEventRow(response.event) : null;
  const importItem = response.import_item
    ? normalizeImportItemRow(response.import_item)
    : null;

  return {
    event,
    importItem,
    linkedEventId:
      nullableString(response.linked_event_id) ??
      importItem?.linkedEventId ??
      event?.id ??
      null,
    raw: response,
  };
}
