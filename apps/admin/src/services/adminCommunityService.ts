import { isAdminApiProviderEnabled } from "./apiClient";
import { getAdminCommunity as getAdminCommunityViaApi } from "./adminCommunityApiService";
import { getAdminCommunity as getAdminCommunityViaSupabase } from "./adminCommunitySupabaseService";
import type { AdminCommunity } from "../types/community";

export { normalizeAdminCommunityRow } from "./adminCommunitySupabaseService";

export async function getAdminCommunity(
  communityId: string,
): Promise<AdminCommunity | null> {
  if (isAdminApiProviderEnabled("community")) {
    return getAdminCommunityViaApi(communityId);
  }

  return getAdminCommunityViaSupabase(communityId);
}
