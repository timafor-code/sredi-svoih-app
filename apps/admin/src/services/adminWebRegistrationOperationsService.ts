import { apiClient } from "./apiClient";
import type {
  AdminWebRegistrationIdentityConflict,
  AdminWebRegistrationOperationsSummary,
  ListWebRegistrationIdentityConflictsParams,
  UpdateWebRegistrationIdentityConflictInput,
  WebRegistrationConflictStatus,
} from "../types/webRegistrationOperations";

type OperationsSummaryApiResponse = {
  active_email_verification_intents: unknown;
  open_identity_conflicts: unknown;
  open_privacy_requests: unknown;
  overdue_privacy_requests: unknown;
};

type IdentityConflictApiResponse = {
  id: unknown;
  registration_intent_id: unknown;
  category: unknown;
  status: unknown;
  email_user_id: unknown;
  phone_user_id: unknown;
  event_id: unknown;
  occurrence_id: unknown;
  intent_status: unknown;
  created_at: unknown;
  resolved_at: unknown;
};

type IdentityConflictUpdateApiRequest = {
  status: WebRegistrationConflictStatus;
};

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Web-registration operations response has an invalid ${field}.`);
  }

  return value;
}

function nullableString(value: unknown, field: string): string | null {
  if (value === null) {
    return null;
  }

  return requiredString(value, field);
}

function nonNegativeInteger(value: unknown, field: string): number {
  if (!Number.isInteger(value) || (value as number) < 0) {
    throw new Error(`Web-registration operations response has an invalid ${field}.`);
  }

  return value as number;
}

function normalizeConflictStatus(value: unknown): WebRegistrationConflictStatus {
  if (value === "open" || value === "resolved") {
    return value;
  }

  throw new Error("Web-registration operations response has an unsupported conflict status.");
}

function normalizeConflictCategory(
  value: unknown,
): AdminWebRegistrationIdentityConflict["category"] {
  if (value === "email_phone_different_users") {
    return value;
  }

  throw new Error("Web-registration operations response has an unsupported conflict category.");
}

function normalizeSummary(
  response: OperationsSummaryApiResponse,
): AdminWebRegistrationOperationsSummary {
  return {
    activeEmailVerificationIntents: nonNegativeInteger(
      response.active_email_verification_intents,
      "active_email_verification_intents",
    ),
    openIdentityConflicts: nonNegativeInteger(
      response.open_identity_conflicts,
      "open_identity_conflicts",
    ),
    openPrivacyRequests: nonNegativeInteger(
      response.open_privacy_requests,
      "open_privacy_requests",
    ),
    overduePrivacyRequests: nonNegativeInteger(
      response.overdue_privacy_requests,
      "overdue_privacy_requests",
    ),
  };
}

function normalizeConflict(
  response: IdentityConflictApiResponse,
): AdminWebRegistrationIdentityConflict {
  return {
    id: requiredString(response.id, "id"),
    registrationIntentId: requiredString(
      response.registration_intent_id,
      "registration_intent_id",
    ),
    category: normalizeConflictCategory(response.category),
    status: normalizeConflictStatus(response.status),
    emailUserId: nullableString(response.email_user_id, "email_user_id"),
    phoneUserId: nullableString(response.phone_user_id, "phone_user_id"),
    eventId: requiredString(response.event_id, "event_id"),
    occurrenceId: nullableString(response.occurrence_id, "occurrence_id"),
    intentStatus: requiredString(response.intent_status, "intent_status"),
    createdAt: requiredString(response.created_at, "created_at"),
    resolvedAt: nullableString(response.resolved_at, "resolved_at"),
  };
}

export async function getWebRegistrationOperationsSummary(): Promise<AdminWebRegistrationOperationsSummary> {
  const response = await apiClient.get<OperationsSummaryApiResponse>(
    "/admin/web-registration/operations-summary",
  );

  return normalizeSummary(response);
}

export async function listWebRegistrationIdentityConflicts(
  params: ListWebRegistrationIdentityConflictsParams,
): Promise<AdminWebRegistrationIdentityConflict[]> {
  const response = await apiClient.get<IdentityConflictApiResponse[]>(
    "/admin/web-registration/conflicts",
    {
      query: {
        status: params.status,
        limit: params.limit,
        offset: params.offset,
      },
    },
  );

  if (!Array.isArray(response)) {
    throw new Error("Web-registration operations response has an invalid conflict list.");
  }

  return response.map(normalizeConflict);
}

export async function updateWebRegistrationIdentityConflict(
  conflictId: string,
  status: UpdateWebRegistrationIdentityConflictInput["status"],
): Promise<AdminWebRegistrationIdentityConflict> {
  const normalizedConflictId = requiredString(conflictId, "conflict_id");
  const body: IdentityConflictUpdateApiRequest = { status };
  const response = await apiClient.patch<
    IdentityConflictApiResponse,
    IdentityConflictUpdateApiRequest
  >(
    `/admin/web-registration/conflicts/${encodeURIComponent(normalizedConflictId)}`,
    body,
  );

  return normalizeConflict(response);
}
