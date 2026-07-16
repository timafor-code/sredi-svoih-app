import type { AdminEventCategory, AdminEventCategoryRow } from "../types/eventCategories";

function string(value: unknown, fallback = ""): string {
  return value == null || String(value).trim() === "" ? fallback : String(value);
}

function number(value: unknown, fallback = 0): number {
  const result = typeof value === "number" ? value : Number(value);
  return Number.isFinite(result) ? result : fallback;
}

export function normalizeAdminEventCategoryRow(
  row: Partial<AdminEventCategoryRow>,
): AdminEventCategory {
  return {
    id: string(row.id), communityId: string(row.community_id), slug: string(row.slug), title: string(row.title),
    description: row.description == null ? null : String(row.description), color: string(row.color, "#7B68EE"),
    icon: string(row.icon, "•"), sortOrder: number(row.sort_order, 100), isActive: row.is_active === true,
    createdAt: string(row.created_at), updatedAt: string(row.updated_at),
  };
}

export type DeleteAdminEventCategoryResult = {
  category: AdminEventCategory;
  archived: boolean;
};
export {
  createAdminEventCategory,
  deleteAdminEventCategory,
  listAdminEventCategories,
  listEventCategoryUsageCounts,
  updateAdminEventCategory,
} from "./eventCategoriesApiService";
