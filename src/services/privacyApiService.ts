import { apiClient } from './apiClient';
import {
  PRIVACY_ERASURE_LIFECYCLE_STATES,
  PRIVACY_REQUEST_STATUSES,
  PRIVACY_REQUEST_TYPES,
  type CreatePrivacyRequestInput,
  type PrivacyAccessAccepted,
  type PrivacyErasureLifecycle,
  type PrivacyErasureLifecycleState,
  type PrivacyRequest,
  type PrivacyRequestStatus,
  type PrivacyRequestType,
  type PrivacySession,
} from '@/types/privacy';

type ApiPrivacyAccessRequest = {
  email: string;
};

type ApiPrivacyAccessAcceptedResponse = {
  accepted: unknown;
};

type ApiPrivacyAccessConfirmRequest = ApiPrivacyAccessRequest & {
  code: string;
};

type ApiPrivacySessionResponse = {
  privacy_session_token: unknown;
  token_type: unknown;
  scope: unknown;
  expires_at: unknown;
};

type ApiPrivacyErasureConfirmRequest = {
  confirmation: 'delete_my_data';
};

type ApiPrivacyErasureLifecycleResponse = {
  request_id: unknown;
  state: unknown;
  processing_stopped_at: unknown;
  cancelled_at: unknown;
  registrations_require_reregistration_after_cancel: unknown;
};

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

function normalizeErasureState(value: unknown): PrivacyErasureLifecycleState {
  if (
    typeof value === 'string'
    && PRIVACY_ERASURE_LIFECYCLE_STATES.includes(value as PrivacyErasureLifecycleState)
  ) {
    return value as PrivacyErasureLifecycleState;
  }

  throw new Error('Privacy erasure API response has an invalid lifecycle state.');
}

function normalizeEmail(email: string): string {
  const normalized = email.trim().toLowerCase();

  if (!normalized) {
    throw new Error('Account email is required for privacy access.');
  }

  return normalized;
}

function privacySessionHeaders(privacySessionToken: string): Record<string, string> {
  const normalizedToken = privacySessionToken.trim();

  if (!normalizedToken) {
    throw new Error('Privacy session token is required.');
  }

  return { Authorization: `Bearer ${normalizedToken}` };
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

export function mapPrivacySessionApiDto(response: ApiPrivacySessionResponse): PrivacySession {
  if (response.token_type !== 'bearer') {
    throw new Error('Privacy access API response has an invalid token type.');
  }

  if (response.scope !== 'privacy_self_service') {
    throw new Error('Privacy access API response has an invalid scope.');
  }

  return {
    privacySessionToken: requiredString(
      response.privacy_session_token,
      'privacy_session_token',
    ),
    tokenType: response.token_type,
    scope: response.scope,
    expiresAt: requiredString(response.expires_at, 'expires_at'),
  };
}

export function mapPrivacyErasureLifecycleApiDto(
  response: ApiPrivacyErasureLifecycleResponse,
): PrivacyErasureLifecycle {
  if (response.registrations_require_reregistration_after_cancel !== true) {
    throw new Error('Privacy erasure API response has an invalid registration lifecycle flag.');
  }

  return {
    requestId: requiredString(response.request_id, 'request_id'),
    state: normalizeErasureState(response.state),
    processingStoppedAt: requiredString(response.processing_stopped_at, 'processing_stopped_at'),
    cancelledAt: nullableString(response.cancelled_at),
    registrationsRequireReregistrationAfterCancel: true,
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

export async function requestPrivacyAccessCodeViaApi(
  email: string,
): Promise<PrivacyAccessAccepted> {
  const response = await apiClient.post<ApiPrivacyAccessAcceptedResponse, ApiPrivacyAccessRequest>(
    '/privacy/access/request',
    { email: normalizeEmail(email) },
    { includeAuthToken: false },
  );

  if (response.accepted !== true) {
    throw new Error('Privacy access API response was not accepted.');
  }

  return { accepted: true };
}

export async function confirmPrivacyAccessCodeViaApi(
  email: string,
  code: string,
): Promise<PrivacySession> {
  if (!/^\d{6}$/.test(code)) {
    throw new Error('Privacy access code must contain exactly six digits.');
  }

  const response = await apiClient.post<ApiPrivacySessionResponse, ApiPrivacyAccessConfirmRequest>(
    '/privacy/access/confirm',
    { email: normalizeEmail(email), code },
    { includeAuthToken: false },
  );

  return mapPrivacySessionApiDto(response);
}

export async function createDeletionPrivacyRequestViaApi(
  privacySessionToken: string,
): Promise<PrivacyRequest> {
  const response = await apiClient.post<ApiPrivacyRequestResponse, ApiPrivacyRequestCreateRequest>(
    '/privacy/requests',
    { request_type: 'deletion' },
    {
      headers: privacySessionHeaders(privacySessionToken),
      includeAuthToken: false,
    },
  );

  return mapPrivacyRequestApiDto(response);
}

export async function confirmPrivacyErasureViaApi(
  requestId: string,
  privacySessionToken: string,
): Promise<PrivacyErasureLifecycle> {
  const normalizedRequestId = requestId.trim();

  if (!normalizedRequestId) {
    throw new Error('Privacy request ID is required.');
  }

  const response = await apiClient.post<
    ApiPrivacyErasureLifecycleResponse,
    ApiPrivacyErasureConfirmRequest
  >(
    `/privacy/requests/${encodeURIComponent(normalizedRequestId)}/confirm-erasure`,
    { confirmation: 'delete_my_data' },
    {
      headers: privacySessionHeaders(privacySessionToken),
      includeAuthToken: false,
    },
  );

  return mapPrivacyErasureLifecycleApiDto(response);
}
