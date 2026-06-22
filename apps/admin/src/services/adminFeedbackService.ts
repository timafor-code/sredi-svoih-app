import { requireSupabaseClient } from "./supabaseClient";
import {
  ADMIN_FEEDBACK_SEVERITIES,
  type AdminFeedbackSeverity,
  type AdminFeedbackSubmitResult,
  type CreateAdminFeedbackInput,
} from "../types/feedback";

type SupabaseRpcError = {
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

type AdminCreateFeedbackRpcResult = {
  id?: unknown;
  status?: unknown;
  created_at?: unknown;
  createdAt?: unknown;
};

const MAX_SECTION_LENGTH = 80;
const MAX_MESSAGE_LENGTH = 4000;
const MAX_ENTITY_TYPE_LENGTH = 80;
const MAX_USER_AGENT_LENGTH = 500;
const MAX_URL_LENGTH = 1000;

function formatSupabaseError(action: string, error: SupabaseRpcError): string {
  const details = [error.message, error.details, error.hint].filter(Boolean).join(" ");
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

function normalizeSeverity(severity: AdminFeedbackSeverity): AdminFeedbackSeverity {
  if (ADMIN_FEEDBACK_SEVERITIES.includes(severity)) {
    return severity;
  }

  throw new Error("Feedback severity is invalid.");
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
