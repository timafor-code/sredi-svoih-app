import { isAdminApiProviderEnabled } from "./apiClient";
import {
  archiveAdminCommunityLocation as archiveAdminCommunityLocationViaApi,
  createAdminCommunityLocation as createAdminCommunityLocationViaApi,
  listAdminCommunityLocations as listAdminCommunityLocationsViaApi,
  updateAdminCommunityLocation as updateAdminCommunityLocationViaApi,
} from "./communityLocationsApiService";
import {
  archiveAdminCommunityLocation as archiveAdminCommunityLocationViaSupabase,
  createAdminCommunityLocation as createAdminCommunityLocationViaSupabase,
  listAdminCommunityLocations as listAdminCommunityLocationsViaSupabase,
  updateAdminCommunityLocation as updateAdminCommunityLocationViaSupabase,
} from "./communityLocationsSupabaseService";
import type {
  AdminCommunityLocation,
  CreateAdminCommunityLocationInput,
  UpdateAdminCommunityLocationInput,
} from "../types/communityLocations";

export { normalizeAdminCommunityLocationRow } from "./communityLocationsSupabaseService";

export async function listAdminCommunityLocations(
  communityId: string,
): Promise<AdminCommunityLocation[]> {
  if (isAdminApiProviderEnabled("community")) {
    return listAdminCommunityLocationsViaApi(communityId);
  }

  return listAdminCommunityLocationsViaSupabase(communityId);
}

export async function createAdminCommunityLocation(
  input: CreateAdminCommunityLocationInput,
): Promise<AdminCommunityLocation> {
  if (isAdminApiProviderEnabled("community")) {
    return createAdminCommunityLocationViaApi(input);
  }

  return createAdminCommunityLocationViaSupabase(input);
}

export async function updateAdminCommunityLocation(
  locationId: string,
  input: UpdateAdminCommunityLocationInput,
): Promise<AdminCommunityLocation> {
  if (isAdminApiProviderEnabled("community")) {
    return updateAdminCommunityLocationViaApi(locationId, input);
  }

  return updateAdminCommunityLocationViaSupabase(locationId, input);
}

export async function archiveAdminCommunityLocation(
  locationId: string,
): Promise<AdminCommunityLocation> {
  if (isAdminApiProviderEnabled("community")) {
    return archiveAdminCommunityLocationViaApi(locationId);
  }

  return archiveAdminCommunityLocationViaSupabase(locationId);
}
