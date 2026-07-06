export const API_PROVIDER_NAMES = ['supabase', 'api'] as const;

export type ApiProviderName = (typeof API_PROVIDER_NAMES)[number];

export const MOBILE_API_PROVIDER_KEYS = [
  'auth',
  'events',
  'registrations',
  'prayer',
  'contacts',
  'avatar',
  'device',
] as const;

export type MobileApiProviderKey = (typeof MOBILE_API_PROVIDER_KEYS)[number];

export type MobileApiProviderConfig = Record<MobileApiProviderKey, ApiProviderName>;

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

export type ApiUserSummary = {
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

export type ApiProfileSummary = {
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

export type ApiCommunityMembershipSummary = {
  id: string;
  community_id: string;
  role: string;
  status: string;
  joined_at: string | null;
  created_at: string;
};

export type ApiCommunitySummary = {
  id: string;
  name: string;
  city: string;
  slug: string | null;
};

export type ApiAuthTokenResponse = {
  access_token: string;
  refresh_token: string;
  token_type: 'bearer' | string;
  expires_at: string;
  user: ApiUserSummary;
};

export type ApiLoginRequest = {
  email: string;
  password: string;
  device_name?: string | null;
};

export type ApiRegisterRequest = {
  email: string;
  password: string;
};

export type ApiRegisterWithInviteProfileInput = {
  display_name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  full_name?: string | null;
  city?: string | null;
};

export type ApiRegisterWithInviteRequest = {
  invite_code: string;
  email: string;
  password: string;
  profile?: ApiRegisterWithInviteProfileInput | null;
};

export type ApiRefreshRequest = {
  refresh_token: string;
};

export type ApiLogoutRequest = {
  refresh_token: string;
};

export type ApiAuthEmailRequest = {
  email: string;
};

export type ApiOkResponse = {
  ok: boolean;
};

export type ApiStoredAuthTokens = Pick<
  ApiAuthTokenResponse,
  'access_token' | 'refresh_token' | 'token_type' | 'expires_at'
>;

export type ApiRegisterResponse = {
  user: ApiUserSummary;
  profile: ApiProfileSummary | null;
};

export type ApiCurrentUserResponse = {
  user: ApiUserSummary;
  profile: ApiProfileSummary | null;
  memberships: ApiCommunityMembershipSummary[];
};

export type ApiRegisterWithInviteResponse = ApiStoredAuthTokens & {
  user: ApiUserSummary;
  profile: ApiProfileSummary;
  membership: ApiCommunityMembershipSummary;
  community: ApiCommunitySummary;
};

export type ApiAcceptInviteResponse = {
  membership: ApiCommunityMembershipSummary;
  community: ApiCommunitySummary;
  already_member: boolean;
};
