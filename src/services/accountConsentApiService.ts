import type {
  ApiAcceptAccountConsentRequest,
  ApiAccountConsentStatusResponse,
} from '@/types/api';

import { apiClient } from './apiClient';

export async function getAccountConsentStatus(): Promise<ApiAccountConsentStatusResponse> {
  return apiClient.get<ApiAccountConsentStatusResponse>('/auth/account-consent');
}

export async function acceptAccountConsent(
  input: ApiAcceptAccountConsentRequest,
): Promise<ApiAccountConsentStatusResponse> {
  return apiClient.post<ApiAccountConsentStatusResponse, ApiAcceptAccountConsentRequest>(
    '/auth/account-consent/accept',
    input,
  );
}
