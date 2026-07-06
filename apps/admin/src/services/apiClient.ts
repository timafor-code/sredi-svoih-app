import { getAdminApiAccessToken } from "./adminApiAuthTokenStore";
import type {
  AdminApiProviderConfig,
  AdminApiProviderKey,
  ApiErrorResponse,
  ApiProviderName,
  ApiResponseEnvelope,
  ApiResponseMeta,
} from "../types/api";

const DEFAULT_API_TIMEOUT_MS = 15000;
const DEFAULT_PROVIDER: ApiProviderName = "supabase";

type ApiHttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
type ApiQueryValue = string | number | boolean | null | undefined;
type ApiQueryParams = Record<string, ApiQueryValue | readonly ApiQueryValue[]>;
type ApiRequestHeaders = Record<string, string | null | undefined>;

type ApiRequestOptions<TBody = unknown> = {
  body?: TBody;
  headers?: ApiRequestHeaders;
  includeAuthToken?: boolean;
  method?: ApiHttpMethod;
  query?: ApiQueryParams;
  signal?: AbortSignal;
  timeoutMs?: number;
};

type ApiClientErrorInit = {
  error: ApiErrorResponse;
  requestId?: string | null;
  status: number;
};

export const providerEnvNames: Record<AdminApiProviderKey, string> = {
  auth: "VITE_AUTH_PROVIDER",
  events: "VITE_ADMIN_EVENTS_PROVIDER",
  registrations: "VITE_ADMIN_REGISTRATIONS_PROVIDER",
  members: "VITE_ADMIN_MEMBERS_PROVIDER",
  invites: "VITE_ADMIN_INVITES_PROVIDER",
  seating: "VITE_ADMIN_SEATING_PROVIDER",
  import: "VITE_ADMIN_IMPORT_PROVIDER",
  feedback: "VITE_ADMIN_FEEDBACK_PROVIDER",
  community: "VITE_ADMIN_COMMUNITY_PROVIDER",
};

export class ApiClientError extends Error {
  readonly code: string;
  readonly details: ApiErrorResponse["details"];
  readonly requestId: string | null;
  readonly status: number;

  constructor({ error, requestId = null, status }: ApiClientErrorInit) {
    super(error.message);
    this.name = "ApiClientError";
    this.code = error.code;
    this.details = error.details;
    this.requestId = requestId;
    this.status = status;
  }
}

export class ApiClientConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ApiClientConfigurationError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function normalizeApiBaseUrl(value: string | null | undefined): string | null {
  const trimmed = value?.trim();

  if (!trimmed) {
    return null;
  }

  return trimmed.replace(/\/+$/, "");
}

function normalizeProvider(value: string | null | undefined): ApiProviderName {
  return value?.trim() === "api" ? "api" : DEFAULT_PROVIDER;
}

export const apiBaseUrl = normalizeApiBaseUrl(
  import.meta.env.VITE_API_URL as string | undefined,
);

export const adminApiProviderConfig: AdminApiProviderConfig = {
  auth: normalizeProvider(import.meta.env.VITE_AUTH_PROVIDER as string | undefined),
  events: normalizeProvider(import.meta.env.VITE_ADMIN_EVENTS_PROVIDER as string | undefined),
  registrations: normalizeProvider(
    import.meta.env.VITE_ADMIN_REGISTRATIONS_PROVIDER as string | undefined,
  ),
  members: normalizeProvider(import.meta.env.VITE_ADMIN_MEMBERS_PROVIDER as string | undefined),
  invites: normalizeProvider(import.meta.env.VITE_ADMIN_INVITES_PROVIDER as string | undefined),
  seating: normalizeProvider(import.meta.env.VITE_ADMIN_SEATING_PROVIDER as string | undefined),
  import: normalizeProvider(import.meta.env.VITE_ADMIN_IMPORT_PROVIDER as string | undefined),
  feedback: normalizeProvider(import.meta.env.VITE_ADMIN_FEEDBACK_PROVIDER as string | undefined),
  community: normalizeProvider(import.meta.env.VITE_ADMIN_COMMUNITY_PROVIDER as string | undefined),
};

export function getAdminApiProviderConfig(): AdminApiProviderConfig {
  return { ...adminApiProviderConfig };
}

export function getAdminApiProvider(provider: AdminApiProviderKey): ApiProviderName {
  return adminApiProviderConfig[provider];
}

export function isAdminApiProviderEnabled(provider: AdminApiProviderKey): boolean {
  return getAdminApiProvider(provider) === "api";
}

function appendQueryParam(url: URL, key: string, value: ApiQueryValue): void {
  if (value === null || value === undefined) {
    return;
  }

  url.searchParams.append(key, String(value));
}

function isApiQueryValueArray(
  value: ApiQueryValue | readonly ApiQueryValue[],
): value is readonly ApiQueryValue[] {
  return Array.isArray(value);
}

function buildApiUrl(path: string, query?: ApiQueryParams): string {
  if (!apiBaseUrl) {
    throw new ApiClientConfigurationError(
      "VITE_API_URL is required before using the API provider.",
    );
  }

  const normalizedPath = path.startsWith("/") ? path : `/${path}`;

  try {
    const url = new URL(`${apiBaseUrl}${normalizedPath}`);

    Object.entries(query ?? {}).forEach(([key, value]) => {
      if (isApiQueryValueArray(value)) {
        value.forEach((entry) => appendQueryParam(url, key, entry));
        return;
      }

      appendQueryParam(url, key, value);
    });

    return url.toString();
  } catch {
    throw new ApiClientConfigurationError("VITE_API_URL must be an absolute API base URL.");
  }
}

function createHeaders(customHeaders: ApiRequestHeaders | undefined, hasBody: boolean) {
  const headers: Record<string, string> = {
    Accept: "application/json",
  };

  if (hasBody) {
    headers["Content-Type"] = "application/json; charset=utf-8";
  }

  Object.entries(customHeaders ?? {}).forEach(([key, value]) => {
    if (value !== null && value !== undefined) {
      headers[key] = value;
    }
  });

  return headers;
}

function isApiResponseEnvelope(value: unknown): value is ApiResponseEnvelope<unknown> {
  return isRecord(value) && "data" in value && "error" in value;
}

function requestIdFromMeta(meta: ApiResponseMeta | null | undefined): string | null {
  return typeof meta?.request_id === "string" ? meta.request_id : null;
}

async function parseJsonResponse(response: Response): Promise<unknown> {
  const responseText = await response.text();

  if (!responseText) {
    return null;
  }

  try {
    return JSON.parse(responseText);
  } catch {
    return null;
  }
}

function defaultErrorCode(status: number): string {
  if (status === 401) return "unauthenticated";
  if (status === 403) return "forbidden";
  if (status === 404) return "not_found";
  if (status === 409) return "conflict";
  if (status === 422) return "validation_error";
  if (status === 429) return "rate_limited";
  if (status >= 500) return "internal_error";

  return "bad_request";
}

function defaultErrorMessage(status: number): string {
  if (status === 401) return "Authentication is required.";
  if (status === 403) return "The request is not allowed.";
  if (status === 404) return "The requested resource was not found.";
  if (status === 409) return "The request conflicts with the current state.";
  if (status === 422) return "Request validation failed.";
  if (status === 429) return "Too many requests.";
  if (status >= 500) return "The API request failed.";

  return "The request could not be completed.";
}

function errorFromResponseBody(
  status: number,
  body: unknown,
): { error: ApiErrorResponse; requestId: string | null } {
  if (isApiResponseEnvelope(body) && body.error) {
    return {
      error: body.error,
      requestId: requestIdFromMeta(body.meta),
    };
  }

  if (isRecord(body) && typeof body.detail === "string") {
    return {
      error: {
        code: defaultErrorCode(status),
        message: body.detail,
      },
      requestId: null,
    };
  }

  if (isRecord(body) && Array.isArray(body.detail)) {
    return {
      error: {
        code: defaultErrorCode(status),
        message: defaultErrorMessage(status),
        details: { detail: body.detail },
      },
      requestId: null,
    };
  }

  return {
    error: {
      code: defaultErrorCode(status),
      message: defaultErrorMessage(status),
    },
    requestId: null,
  };
}

function createAbortController(
  externalSignal: AbortSignal | undefined,
  timeoutMs: number,
): {
  cleanup: () => void;
  signal?: AbortSignal;
  timedOut: () => boolean;
} {
  if (typeof AbortController === "undefined") {
    return {
      cleanup: () => undefined,
      signal: externalSignal,
      timedOut: () => false,
    };
  }

  const controller = new AbortController();
  let didTimeOut = false;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  const abortFromExternalSignal = () => {
    controller.abort();
  };

  if (externalSignal?.aborted) {
    controller.abort();
  } else {
    externalSignal?.addEventListener("abort", abortFromExternalSignal, { once: true });
  }

  if (timeoutMs > 0) {
    timeoutId = setTimeout(() => {
      didTimeOut = true;
      controller.abort();
    }, timeoutMs);
  }

  return {
    cleanup: () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }

      externalSignal?.removeEventListener("abort", abortFromExternalSignal);
    },
    signal: controller.signal,
    timedOut: () => didTimeOut,
  };
}

async function request<TData, TBody = unknown>(
  path: string,
  options: ApiRequestOptions<TBody> = {},
): Promise<TData> {
  const {
    body,
    headers: customHeaders,
    includeAuthToken = true,
    method = body === undefined ? "GET" : "POST",
    query,
    signal,
    timeoutMs = DEFAULT_API_TIMEOUT_MS,
  } = options;
  const url = buildApiUrl(path, query);
  const hasBody = body !== undefined;
  const headers = createHeaders(customHeaders, hasBody);
  const abortController = createAbortController(signal, timeoutMs);

  try {
    if (includeAuthToken) {
      const accessToken = getAdminApiAccessToken();

      if (accessToken) {
        headers.Authorization = `Bearer ${accessToken}`;
      }
    }

    const response = await fetch(url, {
      body: hasBody ? JSON.stringify(body) : undefined,
      headers,
      method,
      signal: abortController.signal,
    });
    const responseBody = await parseJsonResponse(response);

    if (!response.ok) {
      const { error, requestId } = errorFromResponseBody(response.status, responseBody);

      throw new ApiClientError({
        error,
        requestId,
        status: response.status,
      });
    }

    if (isApiResponseEnvelope(responseBody)) {
      if (responseBody.error) {
        throw new ApiClientError({
          error: responseBody.error,
          requestId: requestIdFromMeta(responseBody.meta),
          status: response.status,
        });
      }

      return responseBody.data as TData;
    }

    return responseBody as TData;
  } catch (error) {
    if (
      error instanceof ApiClientError
      || error instanceof ApiClientConfigurationError
    ) {
      throw error;
    }

    throw new ApiClientError({
      error: {
        code: abortController.timedOut() ? "request_timeout" : "network_error",
        message: abortController.timedOut()
          ? "The API request timed out."
          : "The API request could not be completed.",
      },
      status: 0,
    });
  } finally {
    abortController.cleanup();
  }
}

export const apiClient = {
  delete: <TData>(path: string, options?: ApiRequestOptions<never>) => request<TData>(
    path,
    { ...options, method: "DELETE" },
  ),
  get: <TData>(path: string, options?: ApiRequestOptions<never>) => request<TData>(
    path,
    { ...options, method: "GET" },
  ),
  patch: <TData, TBody = unknown>(
    path: string,
    body: TBody,
    options?: ApiRequestOptions<TBody>,
  ) => request<TData, TBody>(path, { ...options, body, method: "PATCH" }),
  post: <TData, TBody = unknown>(
    path: string,
    body: TBody,
    options?: ApiRequestOptions<TBody>,
  ) => request<TData, TBody>(path, { ...options, body, method: "POST" }),
  put: <TData, TBody = unknown>(
    path: string,
    body: TBody,
    options?: ApiRequestOptions<TBody>,
  ) => request<TData, TBody>(path, { ...options, body, method: "PUT" }),
  request,
};

export type { ApiRequestOptions };
export { DEFAULT_API_TIMEOUT_MS };
