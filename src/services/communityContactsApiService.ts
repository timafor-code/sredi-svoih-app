import type { ApiCommunityContactResponse } from '@/types/api';
import type { CommunityContact, CommunityContactRpcRow } from '@/types/contact';

import {
  COMMUNITY_CONTACTS_AUTH_REQUIRED,
  COMMUNITY_CONTACTS_MEMBERSHIP_REQUIRED,
  mapCommunityContactRpcRow,
} from './communityContactsService';
import { apiClient, ApiClientError } from './apiClient';
import { resolveAuthorizedAvatarReadUrl } from './avatarService';

const AVATAR_READ_CONCURRENCY = 4;

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

async function mapWithConcurrency<TInput, TOutput>(
  items: TInput[],
  limit: number,
  mapper: (item: TInput) => Promise<TOutput>,
): Promise<TOutput[]> {
  const results: TOutput[] = [];
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await mapper(items[currentIndex]);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => worker()),
  );

  return results;
}

async function resolveContactAvatarUrls(
  rows: ApiCommunityContactResponse[],
): Promise<Map<string, string>> {
  const avatarIds = Array.from(new Set(
    rows
      .map((row) => row.avatar_id)
      .filter((avatarId): avatarId is string => Boolean(avatarId)),
  ));

  if (avatarIds.length === 0) {
    return new Map();
  }

  const entries = await mapWithConcurrency(
    avatarIds,
    AVATAR_READ_CONCURRENCY,
    async (avatarId) => {
      try {
        return [avatarId, await resolveAuthorizedAvatarReadUrl(avatarId)] as const;
      } catch {
        return [avatarId, null] as const;
      }
    },
  );

  return new Map(
    entries.filter((entry): entry is readonly [string, string] => entry[1] !== null),
  );
}

function toCommunityContactRpcRow(
  row: ApiCommunityContactResponse,
  avatarUrls: Map<string, string> | null,
): CommunityContactRpcRow {
  const avatarUrl = avatarUrls
    ? row.avatar_id ? avatarUrls.get(row.avatar_id) ?? null : null
    : row.avatar_url;

  return {
    ...row,
    avatar_url: avatarUrl,
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

    const visibleRows = (rows ?? [])
      .filter((row) => row.show_in_community_directory);
  const avatarUrls = await resolveContactAvatarUrls(visibleRows);

    return visibleRows
      .map((row) => toCommunityContactRpcRow(row, avatarUrls))
      .map(mapCommunityContactRpcRow);
  } catch (error) {
    if (error instanceof ApiClientError) {
      throw normalizeApiCommunityContactsError(error);
    }

    throw error;
  }
}
