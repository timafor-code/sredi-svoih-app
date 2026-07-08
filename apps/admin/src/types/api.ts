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

export type AdminApiEventResponse = {
  id: string;
  community_id: string;
  event_kind: string;
  title: string;
  subtitle: string | null;
  description: string | null;
  short_description: string | null;
  starts_at: string;
  ends_at: string | null;
  is_permanent: boolean;
  timezone: string | null;
  location_name: string | null;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  image_url: string | null;
  category: string;
  audience: string | null;
  visibility: string;
  status: string;
  source_type: string;
  source_url: string | null;
  source_external_id: string | null;
  manual_override: boolean;
  registration_mode: string;
  registration_url: string | null;
  capacity: number | null;
  waitlist_enabled: boolean;
  requires_approval: boolean;
  price_amount: number | null;
  price_currency: string | null;
  created_by: string | null;
  updated_by: string | null;
  published_at: string | null;
  created_at: string;
  updated_at: string;
};

export type AdminApiEventCategoryResponse = {
  id: string;
  community_id: string;
  slug: string;
  title: string;
  description: string | null;
  color: string;
  icon: string;
  sort_order: number;
  is_active: boolean;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
};

export type AdminApiEventOccurrenceResponse = {
  id: string;
  event_id: string;
  title: string | null;
  starts_at: string;
  ends_at: string | null;
  timezone: string;
  registration_opens_at: string | null;
  registration_closes_at: string | null;
  capacity: number | null;
  waitlist_enabled: boolean | null;
  requires_approval: boolean | null;
  status: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
  server_now: string | null;
  is_registration_always_open: boolean;
  registration_state: string;
  registration_state_reason: string | null;
};

export type AdminApiOptionCapacityUnitMappingResponse = {
  id: string;
  event_id: string;
  option_id: string;
  capacity_unit_id: string;
  seats_per_quantity: number;
  created_at: string;
};

export type AdminApiParticipationOptionResponse = {
  id: string;
  event_id: string;
  title: string;
  description: string | null;
  price_amount: number;
  price_currency: string;
  option_type: string;
  seat_limit: number | null;
  allow_quantity: boolean;
  min_quantity: number;
  max_quantity: number;
  is_donation: boolean;
  counts_toward_capacity: boolean;
  group_key: string | null;
  conflicts_with: string[];
  sort_order: number;
  is_active: boolean;
  capacity_units: AdminApiOptionCapacityUnitMappingResponse[];
  created_at: string;
  updated_at: string;
};

export type AdminApiEventCapacityUnitResponse = {
  id: string;
  event_id: string;
  key: string;
  title: string;
  description: string | null;
  capacity: number | null;
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};
