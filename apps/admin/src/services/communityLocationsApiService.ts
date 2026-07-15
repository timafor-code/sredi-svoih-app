import { apiClient } from "./apiClient";
import type { AdminApiCommunityLocationResponse } from "../types/api";
import type {
  AdminCommunityLocation,
  CreateAdminCommunityLocationInput,
  UpdateAdminCommunityLocationInput,
} from "../types/communityLocations";

type AdminCommunityLocationApiPayload = {
  community_id?: string;
  title?: string;
  address?: string;
  is_default?: boolean;
  is_active?: boolean;
  sort_order?: number;
};

function compactUndefined<T extends Record<string, unknown>>(payload: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(payload).filter(([, value]) => value !== undefined),
  ) as Partial<T>;
}

function normalizeAdminApiCommunityLocation(
  row: AdminApiCommunityLocationResponse,
): AdminCommunityLocation {
  return {
    id: row.id,
    communityId: row.community_id,
    title: row.title,
    address: row.address,
    isDefault: row.is_default,
    isActive: row.is_active,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function buildLocationApiPayload(
  input: Partial<CreateAdminCommunityLocationInput>,
): Partial<AdminCommunityLocationApiPayload> {
  return compactUndefined({
    community_id: input.communityId,
    title: input.title,
    address: input.address,
    is_default: input.isDefault,
    is_active: input.isActive,
    sort_order: input.sortOrder,
  });
}

export async function listAdminCommunityLocations(
  communityId: string,
): Promise<AdminCommunityLocation[]> {
  const locations = await apiClient.get<AdminApiCommunityLocationResponse[]>(
    "/admin/community-locations",
    {
      query: {
        community_id: communityId,
      },
    },
  );

  return locations.map(normalizeAdminApiCommunityLocation);
}

export async function createAdminCommunityLocation(
  input: CreateAdminCommunityLocationInput,
): Promise<AdminCommunityLocation> {
  const location = await apiClient.post<
    AdminApiCommunityLocationResponse,
    Partial<AdminCommunityLocationApiPayload>
  >("/admin/community-locations", buildLocationApiPayload(input));

  return normalizeAdminApiCommunityLocation(location);
}

export async function updateAdminCommunityLocation(
  locationId: string,
  input: UpdateAdminCommunityLocationInput,
): Promise<AdminCommunityLocation> {
  const location = await apiClient.patch<
    AdminApiCommunityLocationResponse,
    Partial<AdminCommunityLocationApiPayload>
  >(
    `/admin/community-locations/${encodeURIComponent(locationId)}`,
    buildLocationApiPayload(input),
  );

  return normalizeAdminApiCommunityLocation(location);
}

export async function archiveAdminCommunityLocation(
  locationId: string,
): Promise<AdminCommunityLocation> {
  const location = await apiClient.request<AdminApiCommunityLocationResponse>(
    `/admin/community-locations/${encodeURIComponent(locationId)}/archive`,
    { method: "POST" },
  );

  return normalizeAdminApiCommunityLocation(location);
}
