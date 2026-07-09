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

export type AdminApiCommunityResponse = {
  id: string;
  name: string;
  timezone: string | null;
  website_url: string | null;
  created_at: string | null;
};

export type AdminApiCommunityLocationResponse = {
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

export type AdminApiRegistrationSelectedOptionResponse = {
  id: string;
  option_id: string | null;
  title: string;
  description: string | null;
  option_type: string;
  quantity: number;
  unit_price_amount: number;
  total_amount: number;
  currency: string;
  counts_toward_capacity: boolean;
  seats_count: number;
  is_donation: boolean;
  created_at: string;
};

export type AdminApiEventRegistrationResponse = {
  id: string;
  event_id: string;
  occurrence_id: string | null;
  user_id: string;
  participant_display_name: string;
  email: string | null;
  phone: string | null;
  status: string;
  seats_count: number;
  guest_names: unknown[];
  comment: string | null;
  payment_status: string;
  payment_id: string | null;
  registered_at: string;
  confirmed_at: string | null;
  cancelled_at: string | null;
  occurrence_starts_at: string | null;
  occurrence_ends_at: string | null;
  occurrence_title: string | null;
  selected_options: AdminApiRegistrationSelectedOptionResponse[];
  total_amount: number | null;
  created_at: string;
  updated_at: string;
};

export type AdminApiRegistrationCapacityStatusCountsResponse = {
  confirmed: number;
  pending: number;
  waitlisted: number;
  cancelled: number;
  rejected: number;
  attended: number;
  no_show: number;
};

export type AdminApiRegistrationCapacityOptionStatResponse = {
  option_id: string | null;
  title: string;
  option_type: string;
  registrations_count: number;
  quantity: number;
  seats_count: number;
  is_donation: boolean;
  counts_toward_capacity: boolean;
};

export type AdminApiRegistrationCapacityBucketOptionBreakdownResponse = {
  option_id: string | null;
  title: string;
  registrations_count: number;
  quantity: number;
  seats_count: number;
  is_donation: boolean;
  counts_toward_capacity: boolean;
};

export type AdminApiRegistrationCapacityBucketResponse = {
  capacity_unit_id: string;
  key: string;
  code: string;
  title: string;
  capacity: number | null;
  effective_capacity: number | null;
  occupied_seats: number;
  remaining_seats: number | null;
  free_seats: number | null;
  effective_remaining_seats: number | null;
  fill_percent: number | null;
  effective_fill_percent: number | null;
  effective_free_percent: number | null;
  reservations_count: number;
  option_titles: string[];
  option_breakdown: AdminApiRegistrationCapacityBucketOptionBreakdownResponse[];
  is_unlimited: boolean;
  uses_fallback_capacity: boolean;
};

export type AdminApiRegistrationCapacityBucketAggregateResponse = {
  occupied_seats: number;
  known_capacity: number;
  remaining_seats: number;
  fill_percent: number | null;
  free_percent: number | null;
  limited_bucket_count: number;
  has_unlimited_buckets: boolean;
};

export type AdminApiRegistrationCapacityTotalsResponse = {
  total_registrations: number;
  total_registrations_count: number;
  status_counts: AdminApiRegistrationCapacityStatusCountsResponse;
  confirmed_count: number;
  pending_count: number;
  waitlisted_count: number;
  cancelled_count: number;
  rejected_count: number;
  attended_count: number;
  no_show_count: number;
  active_registrations_count: number;
  active_seats_count: number;
  unique_registered_users_count: number;
  unique_guests_count: number;
  unique_people_count: number;
  multi_meal_guests_count: number;
  sponsors_donations_count: number;
  donations_count: number;
  donation_quantity: number;
  donation_registrations_count: number;
  capacity: number | null;
  remaining_seats: number | null;
  free_seats: number | null;
  fill_percent: number | null;
  free_percent: number | null;
};

export type AdminApiRegistrationCapacityAnalyticsResponse = {
  event_id: string;
  occurrence_id: string | null;
  totals: AdminApiRegistrationCapacityTotalsResponse;
  bucket_aggregate: AdminApiRegistrationCapacityBucketAggregateResponse;
  buckets: AdminApiRegistrationCapacityBucketResponse[];
  option_stats: AdminApiRegistrationCapacityOptionStatResponse[];
  donation_options: AdminApiRegistrationCapacityOptionStatResponse[];
};

export type AdminApiMemberListItemResponse = {
  user_id: string;
  display_name: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  avatar_url: string | null;
  city: string | null;
  birth_date: string | null;
  hebrew_birth_date: Record<string, unknown> | null;
  nusach: string | null;
  onboarding_completed: boolean;
  profile_created_at: string;
  profile_updated_at: string;
  membership_id: string | null;
  community_id: string | null;
  membership_role: string | null;
  membership_status: string | null;
  joined_at: string | null;
  invited_by: string | null;
  registrations_total: number;
  registrations_upcoming: number;
  registrations_past: number;
  registrations_cancelled: number;
  last_registration_at: string | null;
};

export type AdminApiMemberDetailResponse = AdminApiMemberListItemResponse & {
  profile_community_id: string | null;
  full_name: string | null;
  hebrew_name: string | null;
  birth_time_context: string;
  tribe_status: string | null;
  marital_status: string | null;
  about: string | null;
  profile_visibility: string;
  birthday_visibility: string;
  phone_visibility: string;
  notification_preferences: Record<string, unknown>;
  membership_community_id: string | null;
  membership_created_at: string | null;
};

export type AdminApiMemberRegistrationResponse = {
  registration_id: string;
  event_id: string;
  event_title: string;
  occurrence_id: string | null;
  occurrence_title: string | null;
  occurrence_starts_at: string | null;
  occurrence_ends_at: string | null;
  registration_status: string;
  seats_count: number;
  payment_status: string;
  registered_at: string;
  confirmed_at: string | null;
  cancelled_at: string | null;
  selected_options: AdminApiRegistrationSelectedOptionResponse[];
};

export type AdminApiMemberProfileUpdateResponse = {
  user_id: string;
  profile_community_id: string | null;
  full_name: string | null;
  first_name: string | null;
  last_name: string | null;
  display_name: string | null;
  hebrew_name: string | null;
  email: string | null;
  phone: string | null;
  city: string | null;
  birth_date: string | null;
  hebrew_birth_date: Record<string, unknown> | null;
  birth_time_context: string;
  nusach: string | null;
  tribe_status: string | null;
  marital_status: string | null;
  about: string | null;
  onboarding_completed: boolean;
  profile_updated_at: string;
};

export type AdminApiMemberMembershipResponse = {
  membership_id: string;
  community_id: string;
  user_id: string;
  membership_role: string;
  membership_status: string;
  joined_at: string | null;
  invited_by: string | null;
  created_at: string;
};

export type AdminApiInviteRole = "member" | "event_manager" | "admin" | "rabbi";

export type AdminApiInviteStatus = "active" | "used" | "expired" | "revoked";

export type AdminApiInviteCreateRequest = {
  community_id: string;
  role: AdminApiInviteRole;
  email: string | null;
  phone: string | null;
  max_uses: number;
  expires_at: string | null;
};

export type AdminApiInviteCreateResponse = {
  invite_id: string;
  community_id: string;
  code: string;
  role: AdminApiInviteRole;
  email: string | null;
  phone: string | null;
  max_uses: number;
  used_count: number;
  expires_at: string | null;
  status: AdminApiInviteStatus;
  created_by: string | null;
  accepted_by: string | null;
  accepted_at: string | null;
  created_at: string;
};

export type AdminApiSeatingTemplateResponse = {
  id: string;
  community_id: string;
  title: string;
  description: string | null;
  snapshot: Record<string, unknown>;
  is_builtin: boolean;
  is_active: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type AdminApiSeatingLayoutRowResponse = {
  id: string;
  community_id: string;
  event_id: string;
  occurrence_id: string | null;
  capacity_unit_id: string;
  template_id: string | null;
  title: string | null;
  capacity_limit_snapshot: number | null;
  seating_done: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type AdminApiSeatingTableResponse = {
  id: string;
  layout_id: string;
  client_table_id: string;
  cx: number | string;
  cy: number | string;
  w: number | string;
  h: number | string;
  angle: number | string;
  long_side_seats: number | string;
  is_rabbi_table: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

export type AdminApiSeatingConnectionResponse = {
  id: string;
  layout_id: string;
  from_client_table_id: string;
  from_end: string | null;
  to_client_table_id: string;
  to_end: string | null;
  anchor_x: number | string | null;
  anchor_y: number | string | null;
  created_at: string;
};

export type AdminApiSeatingAssignmentResponse = {
  id: string;
  layout_id: string;
  registration_id: string | null;
  guest_index: number | null;
  user_id: string | null;
  seat_key: string | null;
  guest_label: string | null;
  guest_initials: string | null;
  assignment_type: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type AdminApiSeatingLayoutEnvelopeResponse = {
  layout: AdminApiSeatingLayoutRowResponse | null;
  tables: AdminApiSeatingTableResponse[];
  connections: AdminApiSeatingConnectionResponse[];
  assignments: AdminApiSeatingAssignmentResponse[];
};

export type AdminApiSeatingAssignmentsSaveResponse = {
  layout_id: string;
  placed_count: number;
  pooled_count: number;
  reserve_count: number;
};
