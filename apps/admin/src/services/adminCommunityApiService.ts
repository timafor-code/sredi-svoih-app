import { apiClient } from "./apiClient";
import { normalizeAdminCommunityRow } from "./adminCommunitySupabaseService";
import type { AdminApiCommunityResponse } from "../types/api";
import type { AdminCommunity } from "../types/community";

function normalizeAdminApiCommunity(row: AdminApiCommunityResponse): AdminCommunity {
  return normalizeAdminCommunityRow(row);
}

export async function getAdminCommunity(
  communityId: string,
): Promise<AdminCommunity | null> {
  const community = await apiClient.get<AdminApiCommunityResponse>(
    "/admin/community",
    {
      query: {
        community_id: communityId,
      },
    },
  );

  return normalizeAdminApiCommunity(community);
}
