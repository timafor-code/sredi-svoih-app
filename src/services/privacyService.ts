import {
  createPrivacyRequestViaApi,
  listMyPrivacyRequestsViaApi,
} from './privacyApiService';
import type { CreatePrivacyRequestInput, PrivacyRequest } from '@/types/privacy';

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
