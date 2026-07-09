import { ApiClientConfigurationError, ApiClientError, apiClient } from "./apiClient";
import type {
  AdminApiImportRunResponse,
  AdminImportRun,
  AdminImportRunHistoryParams,
  AdminImportRunHistoryResponse,
  AdminImportRunStatus,
  AdminWebsiteImportParserError,
  AdminWebsiteImportSuccessResponse,
  AdminWebsiteImportSummary,
} from "../types/websiteImport";
import { ADMIN_IMPORT_RUN_STATUSES } from "../types/websiteImport";

const ADMIN_IMPORT_RUNS_PATH = "/admin/import-runs";
const DEFAULT_IMPORT_RUN_HISTORY_LIMIT = 10;
const MAX_IMPORT_RUN_HISTORY_LIMIT = 50;
// The run endpoint fetches and parses the website synchronously, so it needs
// more time than the default API request timeout.
const IMPORT_RUN_REQUEST_TIMEOUT_MS = 120_000;

type AdminWebsiteImportErrorOptions = {
  code: string;
  parserErrors?: AdminWebsiteImportParserError[];
  runId?: string | null;
  status?: number;
};

export class AdminWebsiteImportError extends Error {
  code: string;
  parserErrors: AdminWebsiteImportParserError[];
  runId: string | null;
  status?: number;

  constructor(message: string, options: AdminWebsiteImportErrorOptions) {
    super(message);
    this.name = "AdminWebsiteImportError";
    this.code = options.code;
    this.parserErrors = options.parserErrors ?? [];
    this.runId = options.runId ?? null;
    this.status = options.status;
  }
}

export async function listAdminImportRuns(
  params: AdminImportRunHistoryParams = {},
): Promise<AdminImportRunHistoryResponse> {
  const limit = normalizeImportRunHistoryLimit(params.limit);
  let rows: AdminApiImportRunResponse[] | null;

  try {
    rows = await apiClient.get<AdminApiImportRunResponse[] | null>(ADMIN_IMPORT_RUNS_PATH, {
      query: { limit },
    });
  } catch (error) {
    throw new Error(
      formatImportApiError(error, "Не удалось загрузить журнал запусков импорта"),
    );
  }

  return (rows ?? []).map(normalizeImportRunRow);
}

export async function runAdminWebsiteImportForReview(): Promise<AdminWebsiteImportSuccessResponse> {
  let run: AdminApiImportRunResponse | null;

  try {
    // The Python API creates review-only runs; mode "apply_review_only" is
    // enforced server-side and is not part of the request body.
    run = await apiClient.post<AdminApiImportRunResponse | null, Record<string, never>>(
      ADMIN_IMPORT_RUNS_PATH,
      {},
      { timeoutMs: IMPORT_RUN_REQUEST_TIMEOUT_MS },
    );
  } catch (error) {
    throw toAdminWebsiteImportError(error);
  }

  if (!isRecord(run)) {
    throw new AdminWebsiteImportError("API не вернул данные по запуску импорта.", {
      code: "empty_response",
    });
  }

  if (run.status === "failed") {
    const details = run.error?.trim();
    throw new AdminWebsiteImportError(
      `Импорт завершился с ошибкой: ${details || "без подробностей"}. Подробности доступны в журнале запусков.`,
      {
        code: "import_run_failed",
        runId: run.id,
      },
    );
  }

  return {
    ok: true,
    mode: run.mode,
    source: {
      sourceId: run.source_id,
      sourceUrl: run.source_url,
    },
    run: {
      runId: run.id,
      status: run.status,
      startedAt: run.started_at,
      finishedAt: run.finished_at,
    },
    summary: normalizeRunSummary(run),
  };
}

function normalizeImportRunHistoryLimit(limit: number | undefined): number {
  if (typeof limit !== "number" || !Number.isFinite(limit)) {
    return DEFAULT_IMPORT_RUN_HISTORY_LIMIT;
  }

  return Math.min(Math.max(Math.trunc(limit), 1), MAX_IMPORT_RUN_HISTORY_LIMIT);
}

function normalizeImportRunRow(row: AdminApiImportRunResponse): AdminImportRun {
  return {
    id: row.id,
    sourceId: row.source_id,
    sourceName: nullableString(row.source_title),
    status: normalizeImportRunStatus(row.status),
    startedAt: row.started_at,
    finishedAt: nullableString(row.finished_at),
    foundCount: nullableNumber(row.found_count),
    createdCount: nullableNumber(row.created_count),
    updatedCount: nullableNumber(row.updated_count),
    error: nullableString(row.error),
    createdAt: row.created_at,
  };
}

function normalizeRunSummary(run: AdminApiImportRunResponse): AdminWebsiteImportSummary {
  const summary = isRecord(run.summary) ? run.summary : {};
  const dedupeStatusCounts = isRecord(summary.dedupeStatusCounts)
    ? summary.dedupeStatusCounts
    : {};
  const normalized: AdminWebsiteImportSummary = { ...summary };

  assignSummaryCount(normalized, "foundCount", run.found_count ?? summary.foundOnList);
  assignSummaryCount(normalized, "parsedCount", run.parsed_count ?? summary.parsedCount);
  assignSummaryCount(normalized, "itemErrorCount", summary.errorCount);
  assignSummaryCount(normalized, "itemsWrittenCount", summary.itemsWritten);
  assignSummaryCount(
    normalized,
    "itemsLinkedExistingEventCount",
    dedupeStatusCounts.linked_existing,
  );
  assignSummaryCount(
    normalized,
    "itemsPossibleDuplicateEventCount",
    dedupeStatusCounts.possible_duplicate,
  );
  assignSummaryCount(
    normalized,
    "itemsManualOverrideEventCount",
    dedupeStatusCounts.manual_override_skipped,
  );

  return normalized;
}

function assignSummaryCount(
  summary: AdminWebsiteImportSummary,
  key: keyof AdminWebsiteImportSummary & string,
  value: unknown,
): void {
  const count = toFiniteNumber(value);

  if (count !== null) {
    summary[key] = count;
  }
}

function normalizeImportRunStatus(status: unknown): AdminImportRunStatus {
  if (
    typeof status === "string" &&
    (ADMIN_IMPORT_RUN_STATUSES as readonly string[]).includes(status)
  ) {
    return status as AdminImportRunStatus;
  }

  return "failed";
}

function toAdminWebsiteImportError(error: unknown): AdminWebsiteImportError {
  if (error instanceof AdminWebsiteImportError) {
    return error;
  }

  if (error instanceof ApiClientError) {
    return new AdminWebsiteImportError(
      formatImportApiError(error, "Не удалось запустить импорт сайта"),
      {
        code: error.code,
        status: error.status,
      },
    );
  }

  if (error instanceof ApiClientConfigurationError) {
    return new AdminWebsiteImportError(
      "Python API не настроен: задайте VITE_API_URL для web-admin.",
      {
        code: "api_not_configured",
      },
    );
  }

  return new AdminWebsiteImportError(
    "Не удалось запустить импорт сайта: неизвестная ошибка.",
    {
      code: "unknown_error",
    },
  );
}

export function formatImportApiError(error: unknown, fallbackAction: string): string {
  if (error instanceof ApiClientConfigurationError) {
    return "Python API не настроен: задайте VITE_API_URL для web-admin.";
  }

  if (!(error instanceof ApiClientError)) {
    return `${fallbackAction}: ${error instanceof Error ? error.message : "неизвестная ошибка."}`;
  }

  if (error.code === "network_error") {
    return "Python API недоступен: проверьте, что backend запущен, и повторите запрос.";
  }

  if (error.code === "request_timeout") {
    return "Python API не ответил вовремя (timeout). Повторите запрос позже.";
  }

  if (error.code === "conflict") {
    return "Импорт уже запущен. Дождитесь завершения текущего import run и обновите журнал запусков.";
  }

  if (error.code === "unauthenticated" || error.code === "forbidden") {
    return "Нет доступа к импорту для текущей сессии. Проверьте вход и роль admin/event_manager.";
  }

  if (error.code === "not_found") {
    return `${fallbackAction}: запись не найдена или недоступна для текущей роли.`;
  }

  if (error.code === "validation_error") {
    return `${fallbackAction}: ${error.message || "API отклонил данные запроса."}`;
  }

  return `${fallbackAction}: ${error.message || error.code}.`;
}

function nullableString(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  const normalized = String(value).trim();
  return normalized || null;
}

function nullableNumber(value: unknown): number {
  return toFiniteNumber(value) ?? 0;
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
