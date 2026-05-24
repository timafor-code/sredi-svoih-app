export type AdminCommunityLocationRow = {
  id: string;
  community_id: string;
  title: string;
  address: string;
  is_default: boolean;
  is_active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

export type AdminCommunityLocation = {
  id: string;
  communityId: string;
  title: string;
  address: string;
  isDefault: boolean;
  isActive: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

export type AdminCommunityLocationMutationInput = {
  title: string;
  address: string;
  isDefault: boolean;
  isActive: boolean;
  sortOrder: number;
};

export type CreateAdminCommunityLocationInput =
  AdminCommunityLocationMutationInput & {
    communityId: string;
  };

export type UpdateAdminCommunityLocationInput =
  Partial<AdminCommunityLocationMutationInput>;
