import { apiClient } from "./apiClient";
import type {
  AdminPrivacyDueDateItem,
  AdminPrivacyRequestStatus,
  AdminPrivacyRequestType,
  ListAdminPrivacyDueDatesParams,
} from "../types/privacyDueDates";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Privacy due-date response has an invalid ${field}.`);
  }

  return value;
}

function nullableString(value: unknown, field: string): string | null {
  if (value === null) {
    return null;
  }

  return requiredString(value, field);
}

function normalizeRequestType(value: unknown): AdminPrivacyRequestType {
  if (
    value === "data_export"
    || value === "deletion"
    || value === "correction"
    || value === "other"
  ) {
    return value;
  }

  throw new Error("Privacy due-date response has an unsupported request type.");
}

function normalizeStatus(value: unknown): AdminPrivacyRequestStatus {
  if (
    value === "open"
    || value === "reviewed"
    || value === "resolved"
    || value === "rejected"
    || value === "closed"
  ) {
    return value;
  }

  throw new Error("Privacy due-date response has an unsupported request status.");
}

function normalizePrivacyDueDate(value: unknown): AdminPrivacyDueDateItem {
  if (!isRecord(value)) {
    throw new Error("Privacy due-date response contains an invalid item.");
  }

  return {
    id: requiredString(value.id, "id"),
    requestType: normalizeRequestType(value.request_type),
    status: normalizeStatus(value.status),
    createdAt: requiredString(value.created_at, "created_at"),
    dueAt: nullableString(value.due_at, "due_at"),
  };
}

export async function listAdminPrivacyDueDates(
  params: ListAdminPrivacyDueDatesParams,
): Promise<AdminPrivacyDueDateItem[]> {
  const response = await apiClient.get<unknown>(
    "/admin/privacy/requests",
    params.filter === "overdue"
      ? { query: { overdue_only: true } }
      : undefined,
  );

  if (!Array.isArray(response)) {
    throw new Error("Privacy due-date response has an invalid request list.");
  }

  return response.map(normalizePrivacyDueDate);
}
