import { requireSupabaseClient } from "./supabaseClient";
import type {
  AdminWebsiteImportErrorResponse,
  AdminWebsiteImportParserError,
  AdminWebsiteImportPayload,
  AdminWebsiteImportResponse,
  AdminWebsiteImportSuccessResponse,
} from "../types/websiteImport";

const ADMIN_WEBSITE_IMPORT_FUNCTION = "admin-website-import";
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
