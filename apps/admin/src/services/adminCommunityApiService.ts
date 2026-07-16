import { apiClient } from "./apiClient";
import type { AdminApiCommunityResponse } from "../types/api";
import type { AdminCommunity } from "../types/community";

function normalizeAdminApiCommunity(row: AdminApiCommunityResponse): AdminCommunity {
  return {
    id: row.id,
    name: row.name,
    timezone: row.timezone,
    websiteUrl: row.website_url,
    createdAt: row.created_at,
  };
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
