export type AdminAuthSession = {
  user: {
    email: string | null;
    id: string;
  };
};

export type AdminRole = "admin" | "event_manager" | "member";

export type AdminMembershipStatus = "pending" | "active" | "suspended" | "left";

export type AdminProfile = {
  id: string;
  email: string | null;
  full_name: string | null;
  display_name: string | null;
  first_name: string | null;
  last_name: string | null;
  avatar_url: string | null;
  city: string | null;
};

export type AdminCommunitySummary = {
  id?: string | null;
  name?: string | null;
};

export type AdminMembership = {
  id: string;
  community_id: string;
  community_name?: string | null;
  community?: AdminCommunitySummary | null;
  user_id: string;
  role: AdminRole;
  status: AdminMembershipStatus;
  joined_at: string | null;
  created_at: string;
};

export type AdminAuthContext = {
  isAuthenticated: boolean;
  session: AdminAuthSession | null;
  profile: AdminProfile | null;
  membership: AdminMembership | null;
  role: AdminRole | null;
  isAdmin: boolean;
  isEventManager: boolean;
  canAccessAdmin: boolean;
};
