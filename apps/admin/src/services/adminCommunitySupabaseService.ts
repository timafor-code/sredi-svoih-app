import { requireSupabaseClient } from "./supabaseClient";
import type { AdminCommunity, AdminCommunityRow } from "../types/community";

const COMMUNITY_FIELDS = `
  id,
  name,
  timezone,
  website_url,
  created_at
`;

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

export function normalizeAdminCommunityRow(
  row: Partial<AdminCommunityRow>,
): AdminCommunity {
  return {
    id: requiredString(row.id, ""),
    name: requiredString(row.name, "Community"),
    timezone: nullableString(row.timezone),
    websiteUrl: nullableString(row.website_url),
    createdAt: nullableString(row.created_at),
  };
}

export async function getAdminCommunity(
  communityId: string,
): Promise<AdminCommunity | null> {
  const supabase = requireSupabaseClient();
  const { data, error } = await supabase
    .from("communities")
    .select(COMMUNITY_FIELDS)
    .eq("id", communityId)
    .maybeSingle();

  if (error) {
    throw new Error(`Load community failed: ${error.message}`);
  }

  return data ? normalizeAdminCommunityRow(data as Partial<AdminCommunityRow>) : null;
}
