import { requireSupabaseClient } from "./supabaseClient";
import type {
  AdminImportReview,
  AdminImportReviewItem,
  AdminImportReviewRow,
  JsonObject,
  JsonValue,
} from "../types/importReview";

type SupabaseRpcError = {
  message?: string;
  details?: string | null;
  hint?: string | null;
  code?: string;
};

const DEFAULT_REVIEW_LIMIT = 50;
const MAX_REVIEW_LIMIT = 100;

type ImportReviewRpcErrorOptions = {
  fallbackAction: string;
  rpcName: string;
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
  };
}

function normalizeImportItemRow(row: AdminImportReviewRow): AdminImportReviewItem {
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
    sourceName: row.source_name,
    communityId: row.community_id,
  };
}

function normalizeSingleImportItem(
  data: AdminImportReviewRow | AdminImportReviewRow[] | null,
): AdminImportReviewItem {
  const row = Array.isArray(data) ? data[0] : data;

  if (!row) {
    throw new Error("Import item не найден или RPC вернул пустой результат.");
  }

  return normalizeImportItemRow(row);
}

function formatImportReviewRpcError(
  error: SupabaseRpcError,
  { fallbackAction, rpcName }: ImportReviewRpcErrorOptions,
): string {
  const details = [error.message, error.details, error.hint].filter(Boolean).join(" ");
  const searchable = `${error.code ?? ""} ${details}`.toLowerCase();

  if (
    searchable.includes("auth required") ||
    searchable.includes("permission denied") ||
    searchable.includes("not authorized") ||
    searchable.includes("row-level security") ||
    searchable.includes("42501") ||
    searchable.includes("28000")
  ) {
    return `Нет доступа к ${rpcName} для текущей сессии. Проверьте роль admin/event_manager и backend role check. ${
      details || "Supabase не вернул подробности."
    }`;
  }

  if (
    searchable.includes("p0002") ||
    searchable.includes("not found") ||
    searchable.includes("не найден")
  ) {
    return `Import item не найден или недоступен для текущей роли. ${
      details || "Supabase не вернул подробности."
    }`;
  }

  if (
    searchable.includes("could not find the function") ||
    searchable.includes("schema cache")
  ) {
    return `RPC ${rpcName} недоступен или не найден: ${
      details || "Supabase не вернул подробности."
    }`;
  }

  return `${fallbackAction}: ${
    details || "неизвестная ошибка Supabase."
  }`;
}

export async function listImportItemsNeedingReview(
  limit?: number,
): Promise<AdminImportReviewItem[]> {
  const supabase = requireSupabaseClient();
  const limitCount = normalizeLimit(limit);
  const { data, error } = await supabase.rpc("admin_list_import_items_needing_review", {
    limit_count: limitCount,
  });

  if (error) {
    throw new Error(
      formatImportReviewRpcError(error, {
        fallbackAction: "Не удалось загрузить import items needing review",
        rpcName: "admin_list_import_items_needing_review",
      }),
    );
  }

  return ((data ?? []) as AdminImportReviewRow[]).map(normalizeImportItemRow);
}

export async function getImportItem(importItemId: string): Promise<AdminImportReviewItem> {
  const normalizedId = importItemId.trim();

  if (!normalizedId) {
    throw new Error("Не удалось загрузить import item: пустой id.");
  }

  const supabase = requireSupabaseClient();
  const { data, error } = await supabase.rpc("admin_get_import_item", {
    import_item_id: normalizedId,
  });

  if (error) {
    throw new Error(
      formatImportReviewRpcError(error, {
        fallbackAction: "Не удалось загрузить import item",
        rpcName: "admin_get_import_item",
      }),
    );
  }

  return normalizeSingleImportItem(data as AdminImportReviewRow | AdminImportReviewRow[] | null);
}
