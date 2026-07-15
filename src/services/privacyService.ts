import { getMobileApiProvider, isMobileApiProviderEnabled } from './apiClient';
import {
  createPrivacyRequestViaApi,
  listMyPrivacyRequestsViaApi,
} from './privacyApiService';
import type { CreatePrivacyRequestInput, PrivacyRequest } from '@/types/privacy';
import { runApiProviderOperation } from '@/types/api';

const SUPABASE_PRIVACY_REQUESTS_UNAVAILABLE =
  'Privacy requests are not available through the Supabase provider.';

/**
 * There was no legacy mobile privacy-request facade or Supabase RPC before
 * this API contract. Keep the default provider conservative and explicit
 * instead of inventing a direct-table write.
 */
export function isApiPrivacyProviderEnabled(): boolean {
  return isMobileApiProviderEnabled('privacy');
}

export async function createPrivacyRequest(
  input: CreatePrivacyRequestInput,
): Promise<PrivacyRequest> {
  return runApiProviderOperation(getMobileApiProvider('privacy'), {
    api: () => createPrivacyRequestViaApi(input),
    supabase: async () => {
      throw new Error(SUPABASE_PRIVACY_REQUESTS_UNAVAILABLE);
    },
  });
}

export async function listMyPrivacyRequests(): Promise<PrivacyRequest[]> {
  return runApiProviderOperation(getMobileApiProvider('privacy'), {
    api: () => listMyPrivacyRequestsViaApi(),
    supabase: async () => {
      throw new Error(SUPABASE_PRIVACY_REQUESTS_UNAVAILABLE);
    },
  });
}
