import { requireSupabaseClient } from "./supabaseClient";
import type {
  AdminImportRun,
  AdminImportRunHistoryParams,
  AdminImportRunHistoryResponse,
  AdminImportRunRow,
  AdminImportRunStatus,
  AdminWebsiteImportErrorResponse,
  AdminWebsiteImportParserError,
  AdminWebsiteImportPayload,
  AdminWebsiteImportResponse,
  AdminWebsiteImportSuccessResponse,
} from "../types/websiteImport";
import { ADMIN_IMPORT_RUN_STATUSES } from "../types/websiteImport";

const ADMIN_WEBSITE_IMPORT_FUNCTION = "admin-website-import";
const DEFAULT_IMPORT_RUN_HISTORY_LIMIT = 10;
const MAX_IMPORT_RUN_HISTORY_LIMIT = 50;
const APPLY_REVIEW_ONLY_PAYLOAD: AdminWebsiteImportPayload = {
  mode: "apply_review_only",
};

type EdgeInvokeError = {
  code?: string;
  context?: {
    json?: () => Promise<unknown>;
    status?: number;
    text?: () => Promise<string>;
  };
  details?: string | null;
  hint?: string | null;
  message?: string;
  name?: string;
  status?: number;
};

type AdminWebsiteImportErrorOptions = {
  code: string;
  parserErrors?: AdminWebsiteImportParserError[];
  response?: AdminWebsiteImportErrorResponse | null;
  runId?: string | null;
  status?: number;
};

type SupabaseRpcError = {
  code?: string;
  details?: string | null;
  hint?: string | null;
  message?: string;
};

export class AdminWebsiteImportError extends Error {
  code: string;
  parserErrors: AdminWebsiteImportParserError[];
  response: AdminWebsiteImportErrorResponse | null;
  runId: string | null;
  status?: number;

  constructor(message: string, options: AdminWebsiteImportErrorOptions) {
    super(message);
    this.name = "AdminWebsiteImportError";
    this.code = options.code;
    this.parserErrors = options.parserErrors ?? [];
    this.response = options.response ?? null;
    this.runId = options.runId ?? null;
    this.status = options.status;
  }
}

export async function listAdminImportRuns(
  params: AdminImportRunHistoryParams = {},
): Promise<AdminImportRunHistoryResponse> {
  const supabase = requireSupabaseClient();
  const limit = normalizeImportRunHistoryLimit(params.limit);
  const { data, error } = await supabase.rpc("admin_list_import_runs", {
    payload: { limit },
  });

  if (error) {
    throw new Error(formatImportRunHistoryRpcError(error));
  }

  return ((data ?? []) as AdminImportRunRow[]).map(normalizeImportRunRow);
}

export async function runAdminWebsiteImportForReview(): Promise<AdminWebsiteImportSuccessResponse> {
  const supabase = requireSupabaseClient();

  try {
    const { data, error } = await supabase.functions.invoke<AdminWebsiteImportResponse>(
      ADMIN_WEBSITE_IMPORT_FUNCTION,
      {
        body: APPLY_REVIEW_ONLY_PAYLOAD,
      },
    );

    if (error) {
      const response = await readFunctionErrorResponse(error as EdgeInvokeError);
      throw buildAdminWebsiteImportError(response, error as EdgeInvokeError);
    }

    if (!isRecord(data)) {
      throw new AdminWebsiteImportError(
        "Edge Function не вернула данные по запуску импорта.",
        {
          code: "empty_response",
        },
      );
    }

    if (data.ok !== true) {
      throw buildAdminWebsiteImportError(data as AdminWebsiteImportErrorResponse, null);
    }

    return data as AdminWebsiteImportSuccessResponse;
  } catch (error) {
    if (error instanceof AdminWebsiteImportError) {
      throw error;
    }

    const invokeError = error as EdgeInvokeError;
    throw new AdminWebsiteImportError(formatUnexpectedInvokeError(invokeError), {
      code: inferUnexpectedInvokeCode(invokeError),
      status: invokeError.status,
    });
  }
}

function normalizeImportRunHistoryLimit(limit: number | undefined): number {
  if (typeof limit !== "number" || !Number.isFinite(limit)) {
    return DEFAULT_IMPORT_RUN_HISTORY_LIMIT;
  }

  return Math.min(Math.max(Math.trunc(limit), 1), MAX_IMPORT_RUN_HISTORY_LIMIT);
}

function normalizeImportRunRow(row: AdminImportRunRow): AdminImportRun {
  return {
    id: row.id,
    sourceId: row.source_id,
    sourceName: nullableString(row.source_name),
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

function normalizeImportRunStatus(status: unknown): AdminImportRunStatus {
  if (
    typeof status === "string" &&
    (ADMIN_IMPORT_RUN_STATUSES as readonly string[]).includes(status)
  ) {
    return status as AdminImportRunStatus;
  }

  return "failed";
}

function nullableString(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  const normalized = String(value).trim();
  return normalized || null;
}

function nullableNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
}

function formatImportRunHistoryRpcError(error: SupabaseRpcError): string {
  const details = [error.message, error.details, error.hint].filter(Boolean).join(" ");
  const searchable = `${error.code ?? ""} ${details}`.toLowerCase();

  if (
    searchable.includes("unauthenticated") ||
    searchable.includes("permission denied") ||
    searchable.includes("admin_or_event_manager_required") ||
    searchable.includes("42501") ||
    searchable.includes("28000")
  ) {
    return `Нет доступа к журналу запусков импорта для текущей сессии. Проверьте вход и роль admin/event_manager. ${
      details || "Supabase не вернул подробности."
    }`;
  }

  if (
    searchable.includes("could not find the function") ||
    searchable.includes("schema cache")
  ) {
    return `RPC admin_list_import_runs недоступен или не найден: ${
      details || "Supabase не вернул подробности."
    }`;
  }

  return `Не удалось загрузить журнал запусков импорта: ${
    details || "неизвестная ошибка Supabase."
  }`;
}

async function readFunctionErrorResponse(
  error: EdgeInvokeError,
): Promise<AdminWebsiteImportErrorResponse | null> {
  const context = error.context;

  if (!context) {
    return null;
  }

  if (typeof context.json === "function") {
    try {
      const parsed = await context.json();
      return isRecord(parsed) ? (parsed as AdminWebsiteImportErrorResponse) : null;
    } catch {
      // Fall through to text handling below.
    }
  }

  if (typeof context.text === "function") {
    try {
      const text = await context.text();
      const parsed = JSON.parse(text);
      return isRecord(parsed) ? (parsed as AdminWebsiteImportErrorResponse) : null;
    } catch {
      return null;
    }
  }

  return null;
}

function buildAdminWebsiteImportError(
  response: AdminWebsiteImportErrorResponse | null,
  invokeError: EdgeInvokeError | null,
): AdminWebsiteImportError {
  const code = normalizeErrorCode(response, invokeError);
  const parserErrors = normalizeParserErrors(response);
  const status = invokeError?.context?.status ?? invokeError?.status;

  return new AdminWebsiteImportError(formatAdminWebsiteImportError(code, response, invokeError), {
    code,
    parserErrors,
    response,
    runId: response?.runId ?? null,
    status,
  });
}

function normalizeErrorCode(
  response: AdminWebsiteImportErrorResponse | null,
  invokeError: EdgeInvokeError | null,
): string {
  const code = firstNonEmpty(response?.error, response?.code, invokeError?.code);

  if (code) {
    return code;
  }

  const searchable = `${invokeError?.name ?? ""} ${invokeError?.message ?? ""}`.toLowerCase();

  if (searchable.includes("fetch") || searchable.includes("network")) {
    return "network_error";
  }

  return "edge_function_error";
}

function normalizeParserErrors(
  response: AdminWebsiteImportErrorResponse | null,
): AdminWebsiteImportParserError[] {
  if (Array.isArray(response?.parserErrors)) {
    return response.parserErrors.filter(isRecord) as AdminWebsiteImportParserError[];
  }

  if (Array.isArray(response?.summary?.parserErrors)) {
    return response.summary.parserErrors.filter(isRecord) as AdminWebsiteImportParserError[];
  }

  return [];
}

function formatAdminWebsiteImportError(
  code: string,
  response: AdminWebsiteImportErrorResponse | null,
  invokeError: EdgeInvokeError | null,
): string {
  const details = firstNonEmpty(
    response?.message,
    invokeError?.message,
    invokeError?.details,
    invokeError?.hint,
  );
  const searchable = `${code} ${details ?? ""}`.toLowerCase();

  if (code === "import_already_running") {
    return "Импорт уже запущен. Дождитесь завершения текущего import run и обновите очередь проверки.";
  }

  if (code === "invalid_source_url") {
    return "Edge Function отклонила sourceUrl. Разрешены только sredisvoih.com и www.sredisvoih.com; в UI переопределение sourceUrl не используется.";
  }

  if (
    code === "request_timeout" ||
    code === "overall_timeout" ||
    code === "fetch_failed" ||
    searchable.includes("timeout") ||
    searchable.includes("network") ||
    searchable.includes("failed to fetch")
  ) {
    return "Не удалось вызвать импорт: сеть или timeout. Проверьте соединение и повторите запуск.";
  }

  if (
    code === "unauthenticated" ||
    code === "access_denied" ||
    code === "import_source_forbidden" ||
    code === "forbidden" ||
    searchable.includes("not authorized") ||
    searchable.includes("access denied") ||
    searchable.includes("permission denied") ||
    searchable.includes("jwt")
  ) {
    return "Нет доступа к запуску импорта для текущей сессии. Проверьте вход и роль admin/event_manager.";
  }

  if (
    code.startsWith("invalid_") ||
    code.includes("parser") ||
    code.includes("parse") ||
    hasParserErrors(response)
  ) {
    return `Импорт остановлен ошибкой парсера: ${details ?? code}.`;
  }

  return `Не удалось запустить импорт сайта: ${details ?? code}.`;
}

function formatUnexpectedInvokeError(error: EdgeInvokeError): string {
  const searchable = `${error.name ?? ""} ${error.message ?? ""}`.toLowerCase();

  if (
    searchable.includes("fetch") ||
    searchable.includes("network") ||
    searchable.includes("timeout")
  ) {
    return "Не удалось вызвать импорт: сеть или timeout. Проверьте соединение и повторите запуск.";
  }

  return `Не удалось вызвать Edge Function admin-website-import: ${
    error.message || "неизвестная ошибка."
  }`;
}

function inferUnexpectedInvokeCode(error: EdgeInvokeError): string {
  const searchable = `${error.name ?? ""} ${error.message ?? ""}`.toLowerCase();

  if (searchable.includes("fetch") || searchable.includes("network")) {
    return "network_error";
  }

  if (searchable.includes("timeout")) {
    return "request_timeout";
  }

  return "edge_function_error";
}

function hasParserErrors(response: AdminWebsiteImportErrorResponse | null): boolean {
  return Boolean(response?.parserErrors?.length || response?.summary?.parserErrors?.length);
}

function firstNonEmpty(...values: Array<string | null | undefined>): string | null {
  for (const value of values) {
    const trimmed = value?.trim();

    if (trimmed) {
      return trimmed;
    }
  }

  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
