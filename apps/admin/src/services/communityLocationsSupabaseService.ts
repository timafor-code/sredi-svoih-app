import { requireSupabaseClient } from "./supabaseClient";
import type {
  AdminCommunityLocation,
  AdminCommunityLocationRow,
  CreateAdminCommunityLocationInput,
  UpdateAdminCommunityLocationInput,
} from "../types/communityLocations";

type SupabaseRpcError = {
  message?: string;
  details?: string | null;
  hint?: string | null;
};

function nullableString(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  return typeof value === "string" ? value : String(value);
}

function requiredString(value: unknown, fallback: string): string {
  const normalized = nullableString(value);
  return normalized && normalized.trim().length > 0 ? normalized : fallback;
}

function requiredNumber(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return fallback;
}

function formatRpcError(action: string, error: SupabaseRpcError): string {
  const details = [error.message, error.details, error.hint].filter(Boolean).join(" ");
  return `${action} failed: ${details || "Unknown Supabase error"}`;
}

export function normalizeAdminCommunityLocationRow(
  row: Partial<AdminCommunityLocationRow>,
): AdminCommunityLocation {
  return {
    id: requiredString(row.id, ""),
    communityId: requiredString(row.community_id, ""),
    title: requiredString(row.title, ""),
    address: requiredString(row.address, ""),
    isDefault: row.is_default === true,
    isActive: row.is_active === true,
    sortOrder: requiredNumber(row.sort_order, 100),
    createdAt: requiredString(row.created_at, ""),
    updatedAt: requiredString(row.updated_at, ""),
  };
}

function normalizeSingleLocation(
  data:
    | Partial<AdminCommunityLocationRow>
    | Partial<AdminCommunityLocationRow>[]
    | null,
): AdminCommunityLocation {
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) {
    throw new Error("Community location RPC returned an empty result.");
  }
  return normalizeAdminCommunityLocationRow(row);
}

function buildPayload(
  input: Partial<CreateAdminCommunityLocationInput>,
): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  if (input.communityId !== undefined) payload.communityId = input.communityId;
  if (input.title !== undefined) payload.title = input.title;
  if (input.address !== undefined) payload.address = input.address;
  if (input.isDefault !== undefined) payload.isDefault = input.isDefault;
  if (input.isActive !== undefined) payload.isActive = input.isActive;
  if (input.sortOrder !== undefined) payload.sortOrder = input.sortOrder;
  return payload;
}

export async function listAdminCommunityLocations(
  communityId: string,
): Promise<AdminCommunityLocation[]> {
  const supabase = requireSupabaseClient();
  const { data, error } = await supabase.rpc("admin_list_community_locations");

  if (error) {
    throw new Error(formatRpcError("List community locations", error));
  }

  return ((data ?? []) as AdminCommunityLocationRow[])
    .map(normalizeAdminCommunityLocationRow)
    .filter((location) => location.communityId === communityId);
}

export async function createAdminCommunityLocation(
  input: CreateAdminCommunityLocationInput,
): Promise<AdminCommunityLocation> {
  const supabase = requireSupabaseClient();
  const { data, error } = await supabase.rpc("admin_create_community_location", {
    payload: buildPayload(input),
  });

  if (error) {
    throw new Error(formatRpcError("Create community location", error));
  }

  return normalizeSingleLocation(
    data as
      | Partial<AdminCommunityLocationRow>
      | Partial<AdminCommunityLocationRow>[]
      | null,
  );
}

export async function updateAdminCommunityLocation(
  locationId: string,
  input: UpdateAdminCommunityLocationInput,
): Promise<AdminCommunityLocation> {
  const supabase = requireSupabaseClient();
  const { data, error } = await supabase.rpc("admin_update_community_location", {
    location_id: locationId,
    payload: buildPayload(input),
  });

  if (error) {
    throw new Error(formatRpcError("Update community location", error));
  }

  return normalizeSingleLocation(
    data as
      | Partial<AdminCommunityLocationRow>
      | Partial<AdminCommunityLocationRow>[]
      | null,
  );
}

export async function archiveAdminCommunityLocation(
  locationId: string,
): Promise<AdminCommunityLocation> {
  const supabase = requireSupabaseClient();
  const { data, error } = await supabase.rpc("admin_archive_community_location", {
    location_id: locationId,
  });

  if (error) {
    throw new Error(formatRpcError("Archive community location", error));
  }

  return normalizeSingleLocation(
    data as
      | Partial<AdminCommunityLocationRow>
      | Partial<AdminCommunityLocationRow>[]
      | null,
  );
}
