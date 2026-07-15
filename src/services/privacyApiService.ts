import { apiClient } from './apiClient';
import {
  PRIVACY_REQUEST_STATUSES,
  PRIVACY_REQUEST_TYPES,
  type CreatePrivacyRequestInput,
  type PrivacyRequest,
  type PrivacyRequestStatus,
  type PrivacyRequestType,
} from '@/types/privacy';

type ApiPrivacyRequestCreateRequest = {
  community_id?: string;
  message?: string;
  request_type: PrivacyRequestType;
};

type ApiPrivacyRequestResponse = {
  community_id: string | null;
  created_at: string;
  id: string;
  message: string | null;
  request_type: string;
  resolved_at: string | null;
  resolution_note: string | null;
  status: string;
  updated_at: string;
};

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Privacy request API response is missing ${field}.`);
  }

  return value;
}

function nullableString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function normalizeRequestType(value: unknown): PrivacyRequestType {
  if (typeof value === 'string' && PRIVACY_REQUEST_TYPES.includes(value as PrivacyRequestType)) {
    return value as PrivacyRequestType;
  }

  throw new Error('Privacy request API response has an invalid request type.');
}

function normalizeStatus(value: unknown): PrivacyRequestStatus {
  if (typeof value === 'string' && PRIVACY_REQUEST_STATUSES.includes(value as PrivacyRequestStatus)) {
    return value as PrivacyRequestStatus;
  }

  throw new Error('Privacy request API response has an invalid status.');
}

function optionalTrimmedString(value: string | null | undefined): string | undefined {
  const normalized = value?.trim();

  return normalized || undefined;
}

export function mapPrivacyRequestApiDto(response: ApiPrivacyRequestResponse): PrivacyRequest {
  return {
    communityId: nullableString(response.community_id),
    createdAt: requiredString(response.created_at, 'created_at'),
    id: requiredString(response.id, 'id'),
    message: nullableString(response.message),
    requestType: normalizeRequestType(response.request_type),
    resolvedAt: nullableString(response.resolved_at),
    resolutionNote: nullableString(response.resolution_note),
    status: normalizeStatus(response.status),
    updatedAt: requiredString(response.updated_at, 'updated_at'),
  };
}

function toCreateRequest(input: CreatePrivacyRequestInput): ApiPrivacyRequestCreateRequest {
  const communityId = optionalTrimmedString(input.communityId);
  const message = optionalTrimmedString(input.message);

  return {
    ...(communityId ? { community_id: communityId } : {}),
    ...(message ? { message } : {}),
    request_type: input.requestType,
  };
}

export async function createPrivacyRequestViaApi(
  input: CreatePrivacyRequestInput,
): Promise<PrivacyRequest> {
  const response = await apiClient.post<ApiPrivacyRequestResponse, ApiPrivacyRequestCreateRequest>(
    '/privacy/requests',
    toCreateRequest(input),
  );

  return mapPrivacyRequestApiDto(response);
}

export async function listMyPrivacyRequestsViaApi(): Promise<PrivacyRequest[]> {
  const response = await apiClient.get<ApiPrivacyRequestResponse[]>('/privacy/requests');

  return response.map(mapPrivacyRequestApiDto);
}
