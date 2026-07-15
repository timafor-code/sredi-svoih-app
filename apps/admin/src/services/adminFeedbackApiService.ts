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

type AdminFeedbackApiListResponse = {
  items: AdminFeedbackApiResponse[];
  limit: number;
  offset: number;
  total_count: number;
};

type AdminFeedbackApiStatusUpdateRequest = {
  status: AdminFeedbackStatus;
};

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
  filters: AdminFeedbackListFilters = {},
): Promise<AdminFeedbackListResponse> {
  const response = await apiClient.get<AdminFeedbackApiListResponse>('/admin/feedback', {
    query: {
      limit: filters.limit,
      offset: filters.offset,
      section: optionalTrimmedString(filters.section),
      severity: filters.severity ?? undefined,
      status: filters.status ?? undefined,
    },
  });

  if (!Array.isArray(response.items)) {
    throw new Error('Feedback API response is missing items.');
  }
  if (!Number.isInteger(response.total_count) || response.total_count < 0) {
    throw new Error('Feedback API response has an invalid total_count.');
  }
  if (!Number.isInteger(response.limit) || response.limit < 1) {
    throw new Error('Feedback API response has an invalid limit.');
  }
  if (!Number.isInteger(response.offset) || response.offset < 0) {
    throw new Error('Feedback API response has an invalid offset.');
  }

  return {
    items: response.items.map((item) => ({
      ...mapAdminFeedbackApiDto(item),
      totalCount: response.total_count,
    })),
    limit: response.limit,
    offset: response.offset,
    totalCount: response.total_count,
  };
}

export async function updateAdminFeedbackStatusViaApi(
  input: AdminFeedbackStatusUpdateInput,
): Promise<AdminFeedbackStatusUpdateResponse> {
  const feedbackId = requiredString(input.id, 'id');
  const response = await apiClient.patch<
    AdminFeedbackApiResponse,
    AdminFeedbackApiStatusUpdateRequest
  >(`/admin/feedback/${encodeURIComponent(feedbackId)}`, { status: input.status });
  const feedback = mapAdminFeedbackApiDto(response);
  const { totalCount: _totalCount, ...result } = feedback;

  return result;
}
