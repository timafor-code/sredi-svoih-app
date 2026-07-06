export const API_PROVIDER_NAMES = ["supabase", "api"] as const;

export type ApiProviderName = (typeof API_PROVIDER_NAMES)[number];

export const ADMIN_API_PROVIDER_KEYS = [
  "auth",
  "events",
  "registrations",
  "members",
  "invites",
  "seating",
  "import",
  "feedback",
  "community",
] as const;

export type AdminApiProviderKey = (typeof ADMIN_API_PROVIDER_KEYS)[number];

export type AdminApiProviderConfig = Record<AdminApiProviderKey, ApiProviderName>;

export type ApiErrorDetail = {
  field?: string;
  code: string;
  message: string;
};

export type ApiErrorResponse = {
  code: string;
  message: string;
  details?: ApiErrorDetail[] | Record<string, unknown> | null;
};

export type ApiPaginationMeta = {
  limit: number;
  next_cursor: string | null;
  has_more: boolean;
};

export type ApiResponseMeta = {
  request_id?: string;
  pagination?: ApiPaginationMeta;
  [key: string]: unknown;
};

export type ApiResponseEnvelope<TData> = {
  data: TData | null;
  error: ApiErrorResponse | null;
  meta?: ApiResponseMeta | null;
};

export type AdminApiUserSummary = {
  id: string;
  email: string | null;
  phone: string | null;
  status: string;
  email_verified_at: string | null;
  phone_verified_at: string | null;
  last_login_at: string | null;
  created_at: string;
  updated_at: string;
};

export type AdminApiProfileSummary = {
  id: string;
  user_id: string;
  community_id: string | null;
  display_name: string | null;
  first_name: string | null;
  last_name: string | null;
  full_name: string | null;
  avatar_url: string | null;
  city: string | null;
  onboarding_completed: boolean;
  created_at: string;
  updated_at: string;
};

export type AdminApiCommunitySummary = {
  id: string;
  name: string;
  city: string | null;
  slug: string | null;
};

export type AdminApiMembershipSummary = {
  id: string;
  community_id: string;
  user_id?: string | null;
  role: string;
  status: string;
  joined_at: string | null;
  created_at: string;
  updated_at: string;
  community?: AdminApiCommunitySummary | null;
};

export type AdminApiAuthTokenResponse = {
  access_token: string;
  refresh_token: string;
  token_type: "bearer" | string;
  expires_at?: string | null;
  user: AdminApiUserSummary;
};

export type AdminApiLoginRequest = {
  email: string;
  password: string;
};

export type AdminApiRefreshRequest = {
  refresh_token: string;
};

export type AdminApiLogoutRequest = {
  refresh_token: string;
};

export type AdminApiOkResponse = {
  ok: boolean;
};

export type AdminApiStoredAuthTokens = Pick<
  AdminApiAuthTokenResponse,
  "access_token" | "refresh_token" | "token_type" | "expires_at"
>;

export type AdminApiCurrentUserResponse = {
  user: AdminApiUserSummary;
  profile: AdminApiProfileSummary | null;
  memberships: AdminApiMembershipSummary[];
};
