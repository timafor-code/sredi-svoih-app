import { apiClient } from "./apiClient";
import { listAdminEvents } from "./adminEventsApiService";
import { normalizeAdminEventCategoryRow } from "./eventCategoriesService";
import type { AdminApiEventCategoryResponse } from "../types/api";
import type {
  AdminEventCategory,
  CreateAdminEventCategoryInput,
  UpdateAdminEventCategoryInput,
} from "../types/eventCategories";
import type { DeleteAdminEventCategoryResult } from "./eventCategoriesService";

type AdminEventCategoryApiPayload = {
  community_id?: string;
  slug?: string;
  title?: string;
  description?: string | null;
  color?: string;
  icon?: string;
  sort_order?: number;
  is_active?: boolean;
};

function compactUndefined<T extends Record<string, unknown>>(payload: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(payload).filter(([, value]) => value !== undefined),
  ) as Partial<T>;
}

function normalizeAdminApiEventCategory(
  row: AdminApiEventCategoryResponse,
): AdminEventCategory {
  return normalizeAdminEventCategoryRow(row);
}

function buildCategoryApiPayload(
  input: Partial<CreateAdminEventCategoryInput>,
): Partial<AdminEventCategoryApiPayload> {
  return compactUndefined({
    community_id: input.communityId,
    slug: input.slug,
    title: input.title,
    description: input.description,
    color: input.color,
    icon: input.icon,
    sort_order: input.sortOrder,
    is_active: input.isActive,
  });
}

export async function listAdminEventCategories(
  communityId: string,
): Promise<AdminEventCategory[]> {
  const categories = await apiClient.get<AdminApiEventCategoryResponse[]>(
    "/admin/event-categories",
  );

  return categories
    .map(normalizeAdminApiEventCategory)
    .filter((category) => category.communityId === communityId);
}

export async function createAdminEventCategory(
  input: CreateAdminEventCategoryInput,
): Promise<AdminEventCategory> {
  const category = await apiClient.post<
    AdminApiEventCategoryResponse,
    Partial<AdminEventCategoryApiPayload>
  >("/admin/event-categories", buildCategoryApiPayload(input));

  return normalizeAdminApiEventCategory(category);
}

export async function updateAdminEventCategory(
  categoryId: string,
  input: UpdateAdminEventCategoryInput,
): Promise<AdminEventCategory> {
  const category = await apiClient.patch<
    AdminApiEventCategoryResponse,
    Partial<AdminEventCategoryApiPayload>
  >(`/admin/event-categories/${encodeURIComponent(categoryId)}`, buildCategoryApiPayload(input));

  return normalizeAdminApiEventCategory(category);
}

export async function deleteAdminEventCategory(
  _categoryId: string,
  _previouslyActive: boolean,
): Promise<DeleteAdminEventCategoryResult> {
  throw new Error(
    "Delete event category is not available in API provider mode yet. Edit the category and set it inactive, or switch VITE_ADMIN_EVENTS_PROVIDER back to supabase for the legacy delete/archive RPC.",
  );
}

export async function listEventCategoryUsageCounts(
  communityId: string,
): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  const events = await listAdminEvents();

  events
    .filter((event) => event.communityId === communityId)
    .forEach((event) => {
      if (!event.category) return;
      counts[event.category] = (counts[event.category] ?? 0) + 1;
    });

  return counts;
}
