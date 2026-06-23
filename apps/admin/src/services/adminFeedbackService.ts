import { requireSupabaseClient } from "./supabaseClient";
import {
  ADMIN_FEEDBACK_SEVERITIES,
  ADMIN_FEEDBACK_STATUSES,
  type AdminFeedbackItem,
  type AdminFeedbackListFilters,
  type AdminFeedbackListResponse,
  type AdminFeedbackRow,
  type AdminFeedbackSeverity,
  type AdminFeedbackStatus,
  type AdminFeedbackStatusUpdateInput,
  type AdminFeedbackStatusUpdateResponse,
  type AdminFeedbackSubmitResult,
  type CreateAdminFeedbackInput,
} from "../types/feedback";

type SupabaseRpcError = {
  code?: string;
  message?: string;
  details?: string | null;
  hint?: string | null;
};

type AdminCreateFeedbackRpcPayload = {
  section: string;
  message: string;
  severity: AdminFeedbackSeverity;
  user_agent?: string;
  url?: string;
  entity_type?: string;
  entity_id?: string;
};

type AdminListFeedbackRpcPayload = {
  status?: AdminFeedbackStatus;
  severity?: AdminFeedbackSeverity;
  section?: string;
  limit: number;
  offset: number;
};

type AdminUpdateFeedbackStatusRpcPayload = {
  id: string;
  status: AdminFeedbackStatus;
};

type AdminCreateFeedbackRpcResult = {
  id?: unknown;
  status?: unknown;
  created_at?: unknown;
  createdAt?: unknown;
};

const ADMIN_FEEDBACK_RPC_NOT_FOUND_MESSAGE =
  "Admin feedback RPC not found. Apply the admin feedback migration first.";

const ADMIN_FEEDBACK_SUBMIT_ACCESS_DENIED_MESSAGE =
  "Недостаточно прав: отправка feedback доступна только admin/event_manager.";

const ADMIN_FEEDBACK_REVIEW_ACCESS_DENIED_MESSAGE =
  "Недостаточно прав: список и разбор feedback доступны только администратору общины.";

const MAX_SECTION_LENGTH = 80;
const MAX_MESSAGE_LENGTH = 4000;
const MAX_ENTITY_TYPE_LENGTH = 80;
const MAX_FEEDBACK_ID_LENGTH = 80;
const MAX_USER_AGENT_LENGTH = 500;
const MAX_URL_LENGTH = 1000;
const DEFAULT_LIST_LIMIT = 50;
const MAX_LIST_LIMIT = 100;

function errorText(error: SupabaseRpcError): string {
  return [error.message, error.details, error.hint].filter(Boolean).join(" ");
}

function isRpcNotFoundError(error: SupabaseRpcError): boolean {
  const text = errorText(error).toLowerCase();

  return (
    error.code === "PGRST202" ||
    error.code === "42883" ||
    text.includes("could not find the function") ||
    (text.includes("schema cache") && text.includes("admin_"))
  );
}

function isAccessDeniedError(error: SupabaseRpcError): boolean {
  const text = errorText(error).toLowerCase();

  return (
    error.code === "42501" ||
    text.includes("access denied") ||
    text.includes("permission denied") ||
    text.includes("admin role required") ||
    text.includes("insufficient privilege")
  );
}

function formatSupabaseError(action: string, error: SupabaseRpcError): string {
  if (isRpcNotFoundError(error)) {
    return ADMIN_FEEDBACK_RPC_NOT_FOUND_MESSAGE;
  }

  if (isAccessDeniedError(error)) {
    return action === "Create admin feedback"
      ? ADMIN_FEEDBACK_SUBMIT_ACCESS_DENIED_MESSAGE
      : ADMIN_FEEDBACK_REVIEW_ACCESS_DENIED_MESSAGE;
  }

  const details = errorText(error);
  return `${action} failed: ${details || "Unknown Supabase error"}`;
}

function requiredTrimmedString(value: string, fieldName: string, maxLength: number): string {
  const normalized = value.trim();

  if (!normalized) {
    throw new Error(`${fieldName} is required.`);
  }

  if (normalized.length > maxLength) {
    throw new Error(`${fieldName} must be ${maxLength} characters or fewer.`);
  }

  return normalized;
}

function optionalTrimmedString(
  value: string | null | undefined,
  maxLength: number,
): string | undefined {
  const normalized = value?.trim();

  if (!normalized) {
    return undefined;
  }

  return normalized.slice(0, maxLength);
}

function nullableString(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  return typeof value === "string" ? value : String(value);
}

function requiredString(value: unknown, fieldName: string): string {
  const normalized = nullableString(value);

  if (!normalized || normalized.trim().length === 0) {
    throw new Error(`${fieldName} is missing from feedback RPC result.`);
  }

  return normalized;
}

function nullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeBoundedInteger(
  value: number | null | undefined,
  fieldName: string,
  fallback: number,
  min: number,
  max: number,
): number {
  if (value === null || value === undefined) {
    return fallback;
  }

  const parsed = Number(value);

  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`${fieldName} must be an integer.`);
  }

  return Math.min(Math.max(parsed, min), max);
}

function isFeedbackSeverity(value: string): value is AdminFeedbackSeverity {
  return ADMIN_FEEDBACK_SEVERITIES.includes(value as AdminFeedbackSeverity);
}

function isFeedbackStatus(value: string): value is AdminFeedbackStatus {
  return ADMIN_FEEDBACK_STATUSES.includes(value as AdminFeedbackStatus);
}

function normalizeSeverity(severity: AdminFeedbackSeverity): AdminFeedbackSeverity {
  if (ADMIN_FEEDBACK_SEVERITIES.includes(severity)) {
    return severity;
  }

  throw new Error("Feedback severity is invalid.");
}

function normalizeStatus(status: AdminFeedbackStatus): AdminFeedbackStatus {
  if (ADMIN_FEEDBACK_STATUSES.includes(status)) {
    return status;
  }

  throw new Error("Feedback status is invalid.");
}

function normalizeSeverityFilter(
  severity: AdminFeedbackListFilters["severity"],
): AdminFeedbackSeverity | undefined {
  if (!severity || severity === "all") {
    return undefined;
  }

  return normalizeSeverity(severity);
}

function normalizeStatusFilter(
  status: AdminFeedbackListFilters["status"],
): AdminFeedbackStatus | undefined {
  if (!status || status === "all") {
    return undefined;
  }

  return normalizeStatus(status);
}

function normalizeFeedbackSeverityValue(value: unknown): AdminFeedbackSeverity {
  const severity = requiredString(value, "Feedback severity");

  if (isFeedbackSeverity(severity)) {
    return severity;
  }

  throw new Error("Feedback severity returned by RPC is invalid.");
}

function normalizeFeedbackStatusValue(value: unknown): AdminFeedbackStatus {
  const status = requiredString(value, "Feedback status");

  if (isFeedbackStatus(status)) {
    return status;
  }

  throw new Error("Feedback status returned by RPC is invalid.");
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function normalizeFeedbackResult(data: unknown): AdminFeedbackSubmitResult {
  const row = (Array.isArray(data) ? data[0] : data) as AdminCreateFeedbackRpcResult | null;

  if (!row || typeof row !== "object") {
    throw new Error("Create admin feedback failed: RPC returned no result.");
  }

  const id = stringValue(row.id);

  if (!id) {
    throw new Error("Create admin feedback failed: RPC returned no feedback id.");
  }

  return {
    id,
    status: stringValue(row.status) ?? "open",
    createdAt: stringValue(row.created_at ?? row.createdAt) ?? "",
  };
}

function normalizeFeedbackBaseRow(
  row: Partial<AdminFeedbackRow>,
): AdminFeedbackStatusUpdateResponse {
  return {
    id: requiredString(row.id, "Feedback id"),
    communityId: requiredString(row.community_id, "Feedback community id"),
    userId: requiredString(row.user_id, "Feedback user id"),
    section: requiredString(row.section, "Feedback section"),
    entityType: nullableString(row.entity_type),
    entityId: nullableString(row.entity_id),
    severity: normalizeFeedbackSeverityValue(row.severity),
    message: requiredString(row.message, "Feedback message"),
    status: normalizeFeedbackStatusValue(row.status),
    url: nullableString(row.url),
    userAgent: nullableString(row.user_agent),
    createdAt: requiredString(row.created_at, "Feedback created_at"),
    updatedAt: nullableString(row.updated_at),
    resolvedAt: nullableString(row.resolved_at),
    resolvedBy: nullableString(row.resolved_by),
  };
}

function normalizeFeedbackRow(row: Partial<AdminFeedbackRow>): AdminFeedbackItem {
  return {
    ...normalizeFeedbackBaseRow(row),
    totalCount: nullableNumber(row.total_count),
  };
}

function feedbackRowFromResult(data: unknown): Partial<AdminFeedbackRow> | null {
  const row = Array.isArray(data) ? data[0] : data;

  if (!row || typeof row !== "object" || Array.isArray(row)) {
    return null;
  }

  return row as Partial<AdminFeedbackRow>;
}

function buildListAdminFeedbackPayload(filters: AdminFeedbackListFilters): {
  limit: number;
  offset: number;
  payload: AdminListFeedbackRpcPayload;
} {
  const limit = normalizeBoundedInteger(
    filters.limit,
    "Feedback list limit",
    DEFAULT_LIST_LIMIT,
    1,
    MAX_LIST_LIMIT,
  );
  const offset = normalizeBoundedInteger(
    filters.offset,
    "Feedback list offset",
    0,
    0,
    Number.MAX_SAFE_INTEGER,
  );
  const status = normalizeStatusFilter(filters.status);
  const severity = normalizeSeverityFilter(filters.severity);
  const section = optionalTrimmedString(filters.section, MAX_SECTION_LENGTH);
  const payload: AdminListFeedbackRpcPayload = {
    limit,
    offset,
  };

  if (status) {
    payload.status = status;
  }

  if (severity) {
    payload.severity = severity;
  }

  if (section) {
    payload.section = section;
  }

  return { limit, offset, payload };
}

export async function createAdminFeedback(
  input: CreateAdminFeedbackInput,
): Promise<AdminFeedbackSubmitResult> {
  const payload: AdminCreateFeedbackRpcPayload = {
    section: requiredTrimmedString(input.section, "Feedback section", MAX_SECTION_LENGTH),
    message: requiredTrimmedString(input.message, "Feedback message", MAX_MESSAGE_LENGTH),
    severity: normalizeSeverity(input.severity),
  };
  const url = optionalTrimmedString(input.url, MAX_URL_LENGTH);
  const userAgent = optionalTrimmedString(input.userAgent, MAX_USER_AGENT_LENGTH);
  const entityType = optionalTrimmedString(input.entity?.entityType, MAX_ENTITY_TYPE_LENGTH);
  const entityId = optionalTrimmedString(input.entity?.entityId, MAX_URL_LENGTH);

  if (url) {
    payload.url = url;
  }

  if (userAgent) {
    payload.user_agent = userAgent;
  }

  if (entityType && entityId) {
    payload.entity_type = entityType;
    payload.entity_id = entityId;
  }

  const supabase = requireSupabaseClient();
  const { data, error } = await supabase.rpc("admin_create_feedback", { payload });

  if (error) {
    throw new Error(formatSupabaseError("Create admin feedback", error));
  }

  return normalizeFeedbackResult(data);
}

export async function listAdminFeedback(
  filters: AdminFeedbackListFilters = {},
): Promise<AdminFeedbackListResponse> {
  const supabase = requireSupabaseClient();
  const { limit, offset, payload } = buildListAdminFeedbackPayload(filters);
  const { data, error } = await supabase.rpc("admin_list_feedback", { payload });

  if (error) {
    throw new Error(formatSupabaseError("List admin feedback", error));
  }

  const rows = Array.isArray(data) ? (data as Partial<AdminFeedbackRow>[]) : [];
  const items = rows.map(normalizeFeedbackRow);

  return {
    items,
    totalCount: items[0]?.totalCount ?? 0,
    limit,
    offset,
  };
}

export async function updateAdminFeedbackStatus(
  input: AdminFeedbackStatusUpdateInput,
): Promise<AdminFeedbackStatusUpdateResponse> {
  const payload: AdminUpdateFeedbackStatusRpcPayload = {
    id: requiredTrimmedString(input.id, "Feedback id", MAX_FEEDBACK_ID_LENGTH),
    status: normalizeStatus(input.status),
  };
  const supabase = requireSupabaseClient();
  const { data, error } = await supabase.rpc("admin_update_feedback_status", { payload });

  if (error) {
    throw new Error(formatSupabaseError("Update admin feedback status", error));
  }

  const row = feedbackRowFromResult(data);

  if (!row) {
    throw new Error("Update admin feedback status failed: RPC returned no feedback row.");
  }

  return normalizeFeedbackBaseRow(row);
}
