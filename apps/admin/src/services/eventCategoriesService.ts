import { requireSupabaseClient } from "./supabaseClient";
import type {
  AdminEventCategory,
  AdminEventCategoryRow,
  CreateAdminEventCategoryInput,
  UpdateAdminEventCategoryInput,
} from "../types/eventCategories";

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

export function normalizeAdminEventCategoryRow(
  row: Partial<AdminEventCategoryRow>,
): AdminEventCategory {
  return {
    id: requiredString(row.id, ""),
    communityId: requiredString(row.community_id, ""),
    slug: requiredString(row.slug, ""),
    title: requiredString(row.title, ""),
    description: nullableString(row.description),
    color: requiredString(row.color, "#7B68EE"),
    icon: requiredString(row.icon, "•"),
    sortOrder: requiredNumber(row.sort_order, 100),
    isActive: row.is_active === true,
    createdAt: requiredString(row.created_at, ""),
    updatedAt: requiredString(row.updated_at, ""),
  };
}

function normalizeSingleCategory(
  data: Partial<AdminEventCategoryRow> | Partial<AdminEventCategoryRow>[] | null,
): AdminEventCategory {
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) {
    throw new Error("Category RPC returned an empty result.");
  }
  return normalizeAdminEventCategoryRow(row);
}

function formatRpcError(action: string, error: SupabaseRpcError): string {
  const details = [error.message, error.details, error.hint].filter(Boolean).join(" ");
  return `${action} failed: ${details || "Unknown Supabase error"}`;
}

export async function listAdminEventCategories(
  communityId: string,
): Promise<AdminEventCategory[]> {
  const supabase = requireSupabaseClient();
  const { data, error } = await supabase.rpc("admin_list_event_categories", {
    p_community_id: communityId,
  });

  if (error) {
    throw new Error(formatRpcError("List event categories", error));
  }

  return ((data ?? []) as AdminEventCategoryRow[]).map(normalizeAdminEventCategoryRow);
}

function buildPayload(input: Partial<CreateAdminEventCategoryInput>): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  if (input.communityId !== undefined) payload.communityId = input.communityId;
  if (input.slug !== undefined) payload.slug = input.slug;
  if (input.title !== undefined) payload.title = input.title;
  if (input.description !== undefined) payload.description = input.description;
  if (input.color !== undefined) payload.color = input.color;
  if (input.icon !== undefined) payload.icon = input.icon;
  if (input.sortOrder !== undefined) payload.sortOrder = input.sortOrder;
  if (input.isActive !== undefined) payload.isActive = input.isActive;
  return payload;
}

export async function createAdminEventCategory(
  input: CreateAdminEventCategoryInput,
): Promise<AdminEventCategory> {
  const supabase = requireSupabaseClient();
  const { data, error } = await supabase.rpc("admin_create_event_category", {
    payload: buildPayload(input),
  });

  if (error) {
    throw new Error(formatRpcError("Create event category", error));
  }

  return normalizeSingleCategory(
    data as Partial<AdminEventCategoryRow> | Partial<AdminEventCategoryRow>[] | null,
  );
}

export async function updateAdminEventCategory(
  categoryId: string,
  input: UpdateAdminEventCategoryInput,
): Promise<AdminEventCategory> {
  const supabase = requireSupabaseClient();
  const { data, error } = await supabase.rpc("admin_update_event_category", {
    category_id: categoryId,
    payload: buildPayload(input),
  });

  if (error) {
    throw new Error(formatRpcError("Update event category", error));
  }

  return normalizeSingleCategory(
    data as Partial<AdminEventCategoryRow> | Partial<AdminEventCategoryRow>[] | null,
  );
}

export type DeleteAdminEventCategoryResult = {
  category: AdminEventCategory;
  archived: boolean;
};

export async function deleteAdminEventCategory(
  categoryId: string,
  previouslyActive: boolean,
): Promise<DeleteAdminEventCategoryResult> {
  const supabase = requireSupabaseClient();
  const { data, error } = await supabase.rpc("admin_delete_event_category", {
    category_id: categoryId,
  });

  if (error) {
    throw new Error(formatRpcError("Delete event category", error));
  }

  const category = normalizeSingleCategory(
    data as Partial<AdminEventCategoryRow> | Partial<AdminEventCategoryRow>[] | null,
  );

  return {
    category,
    archived: previouslyActive && category.isActive === false,
  };
}

export async function listEventCategoryUsageCounts(
  communityId: string,
): Promise<Record<string, number>> {
  const supabase = requireSupabaseClient();
  const { data, error } = await supabase
    .from("events")
    .select("category")
    .eq("community_id", communityId);

  if (error) {
    throw new Error(formatRpcError("Count event category usage", error));
  }

  const counts: Record<string, number> = {};
  ((data ?? []) as Array<{ category: string | null }>).forEach((row) => {
    const slug = row.category;
    if (!slug) return;
    counts[slug] = (counts[slug] ?? 0) + 1;
  });

  return counts;
}
