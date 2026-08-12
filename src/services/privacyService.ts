import {
  confirmPrivacyAccessCodeViaApi,
  confirmPrivacyErasureViaApi,
  createDeletionPrivacyRequestViaApi,
  createPrivacyRequestViaApi,
  listMyPrivacyRequestsViaApi,
  requestPrivacyAccessCodeViaApi,
} from './privacyApiService';
import type {
  CreatePrivacyRequestInput,
  PrivacyAccessAccepted,
  PrivacyErasureLifecycle,
  PrivacyRequest,
  PrivacySession,
} from '@/types/privacy';

export function isApiPrivacyProviderEnabled(): boolean {
  return true;
}

export async function createPrivacyRequest(
  input: CreatePrivacyRequestInput,
): Promise<PrivacyRequest> {
  return createPrivacyRequestViaApi(input);
}

export async function listMyPrivacyRequests(): Promise<PrivacyRequest[]> {
  return listMyPrivacyRequestsViaApi();
}

export async function requestPrivacyAccessCode(email: string): Promise<PrivacyAccessAccepted> {
  return requestPrivacyAccessCodeViaApi(email);
}

export async function confirmPrivacyAccessCode(
  email: string,
  code: string,
): Promise<PrivacySession> {
  return confirmPrivacyAccessCodeViaApi(email, code);
}

export async function createDeletionPrivacyRequest(
  privacySessionToken: string,
): Promise<PrivacyRequest> {
  return createDeletionPrivacyRequestViaApi(privacySessionToken);
}

export async function confirmPrivacyErasure(
  requestId: string,
  privacySessionToken: string,
): Promise<PrivacyErasureLifecycle> {
  return confirmPrivacyErasureViaApi(requestId, privacySessionToken);
}
