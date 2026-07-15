import { apiClient } from './apiClient';
import {
  ADMIN_FEEDBACK_SEVERITIES,
  ADMIN_FEEDBACK_STATUSES,
  type AdminFeedbackItem,
  type AdminFeedbackListFilters,
  type AdminFeedbackListResponse,
  type AdminFeedbackSeverity,
  type AdminFeedbackStatus,
  type AdminFeedbackStatusUpdateInput,
  type AdminFeedbackStatusUpdateResponse,
  type AdminFeedbackSubmitResult,
  type CreateAdminFeedbackInput,
} from '../types/feedback';

type AdminFeedbackApiCreateRequest = {
  community_id?: string;
  entity_id?: string;
  entity_type?: string;
  message: string;
  section: string;
  severity: AdminFeedbackSeverity;
  url?: string;
  user_agent?: string;
};

type AdminFeedbackApiResponse = {
  community_id: string;
  created_at: string;
  entity_id: string | null;
  entity_type: string | null;
  id: string;
  message: string;
  resolved_at: string | null;
  resolved_by: string | null;
  section: string;
  severity: string;
  status: string;
  updated_at: string;
  url: string | null;
  user_agent: string | null;
  user_id: string;
};

export const ADMIN_FEEDBACK_LIST_API_UNSUPPORTED =
  'Feedback list is not available in API provider mode yet. The Python API currently supports feedback submission only.';

export const ADMIN_FEEDBACK_STATUS_UPDATE_API_UNSUPPORTED =
  'Feedback status updates are not available in API provider mode yet. The Python API currently supports feedback submission only.';

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Feedback API response is missing ${field}.`);
  }

  return value;
}

function nullableString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function normalizeSeverity(value: unknown): AdminFeedbackSeverity {
  if (typeof value === 'string' && ADMIN_FEEDBACK_SEVERITIES.includes(value as AdminFeedbackSeverity)) {
    return value as AdminFeedbackSeverity;
  }

  throw new Error('Feedback API response has an invalid severity.');
}

function normalizeStatus(value: unknown): AdminFeedbackStatus {
  if (typeof value === 'string' && ADMIN_FEEDBACK_STATUSES.includes(value as AdminFeedbackStatus)) {
    return value as AdminFeedbackStatus;
  }

  throw new Error('Feedback API response has an invalid status.');
}

function optionalTrimmedString(value: string | null | undefined): string | undefined {
  const normalized = value?.trim();

  return normalized || undefined;
}

export function mapAdminFeedbackApiDto(response: AdminFeedbackApiResponse): AdminFeedbackItem {
  return {
    communityId: requiredString(response.community_id, 'community_id'),
    createdAt: requiredString(response.created_at, 'created_at'),
    entityId: nullableString(response.entity_id),
    entityType: nullableString(response.entity_type),
    id: requiredString(response.id, 'id'),
    message: requiredString(response.message, 'message'),
    resolvedAt: nullableString(response.resolved_at),
    resolvedBy: nullableString(response.resolved_by),
    section: requiredString(response.section, 'section'),
    severity: normalizeSeverity(response.severity),
    status: normalizeStatus(response.status),
    totalCount: null,
    updatedAt: nullableString(response.updated_at),
    url: nullableString(response.url),
    userAgent: nullableString(response.user_agent),
    userId: requiredString(response.user_id, 'user_id'),
  };
}

function toCreateRequest(input: CreateAdminFeedbackInput): AdminFeedbackApiCreateRequest {
  const communityId = optionalTrimmedString(input.communityId);
  const entityId = optionalTrimmedString(input.entity?.entityId);
  const entityType = optionalTrimmedString(input.entity?.entityType);
  const url = optionalTrimmedString(input.url);
  const userAgent = optionalTrimmedString(input.userAgent);

  return {
    ...(communityId ? { community_id: communityId } : {}),
    ...(entityId && entityType ? { entity_id: entityId, entity_type: entityType } : {}),
    ...(url ? { url } : {}),
    ...(userAgent ? { user_agent: userAgent } : {}),
    message: input.message.trim(),
    section: input.section,
    severity: input.severity,
  };
}

export async function createAdminFeedbackViaApi(
  input: CreateAdminFeedbackInput,
): Promise<AdminFeedbackSubmitResult> {
  const response = await apiClient.post<AdminFeedbackApiResponse, AdminFeedbackApiCreateRequest>(
    '/admin/feedback',
    toCreateRequest(input),
  );
  const feedback = mapAdminFeedbackApiDto(response);

  return {
    createdAt: feedback.createdAt,
    id: feedback.id,
    status: feedback.status,
  };
}

export async function listAdminFeedbackViaApi(
  _filters: AdminFeedbackListFilters = {},
): Promise<AdminFeedbackListResponse> {
  throw new Error(ADMIN_FEEDBACK_LIST_API_UNSUPPORTED);
}

export async function updateAdminFeedbackStatusViaApi(
  _input: AdminFeedbackStatusUpdateInput,
): Promise<AdminFeedbackStatusUpdateResponse> {
  throw new Error(ADMIN_FEEDBACK_STATUS_UPDATE_API_UNSUPPORTED);
}
