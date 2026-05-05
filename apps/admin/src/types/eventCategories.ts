export type AdminEventCategoryRow = {
  id: string;
  community_id: string;
  slug: string;
  title: string;
  description: string | null;
  color: string;
  icon: string;
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type AdminEventCategory = {
  id: string;
  communityId: string;
  slug: string;
  title: string;
  description: string | null;
  color: string;
  icon: string;
  sortOrder: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type AdminEventCategoryMutationInput = {
  slug: string;
  title: string;
  description: string | null;
  color: string;
  icon: string;
  sortOrder: number;
  isActive: boolean;
};

export type CreateAdminEventCategoryInput = AdminEventCategoryMutationInput & {
  communityId: string;
};

export type UpdateAdminEventCategoryInput = Partial<AdminEventCategoryMutationInput>;
