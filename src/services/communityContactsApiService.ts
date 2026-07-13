import type { ApiCommunityContactResponse } from '@/types/api';
import type { CommunityContact, CommunityContactRpcRow } from '@/types/contact';

import {
  COMMUNITY_CONTACTS_AUTH_REQUIRED,
  COMMUNITY_CONTACTS_MEMBERSHIP_REQUIRED,
  mapCommunityContactRpcRow,
} from './communityContactsService';
import { apiClient, ApiClientError } from './apiClient';

function normalizeApiCommunityContactsError(error: ApiClientError): Error {
  const normalizedMessage = error.message.toLowerCase();

  if (error.status === 401 || error.code === 'unauthenticated') {
    return new Error(COMMUNITY_CONTACTS_AUTH_REQUIRED);
  }

  if (
    error.status === 403
    && (
      error.code === 'membership_required'
      || error.code === 'forbidden'
      || normalizedMessage.includes('membership')
    )
  ) {
    return new Error(COMMUNITY_CONTACTS_MEMBERSHIP_REQUIRED);
  }

  return new Error(error.message);
}

function toCommunityContactRpcRow(row: ApiCommunityContactResponse): CommunityContactRpcRow {
  return {
    ...row,
    email: null,
    share_email: false,
  };
}

export async function listCommunityContactsFromApi(
  communityId?: string,
): Promise<CommunityContact[]> {
  try {
    const rows = await apiClient.get<ApiCommunityContactResponse[] | null>(
      '/community/contacts',
      {
        query: {
          community_id: communityId,
        },
      },
    );

    return (rows ?? [])
      .map(toCommunityContactRpcRow)
      .filter((row) => row.show_in_community_directory)
      .map(mapCommunityContactRpcRow);
  } catch (error) {
    if (error instanceof ApiClientError) {
      throw normalizeApiCommunityContactsError(error);
    }

    throw error;
  }
}
