import type { PrayerActivityType } from './prayerTracker';
import type { HebrewDateJson } from './contact';

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
  avatar_id: string | null;
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

export type ApiEventResponse = {
  id: string;
  community_id?: string | null;
  event_kind?: string | null;
  title?: string | null;
  subtitle?: string | null;
  short_description?: string | null;
  description?: string | null;
  starts_at?: string | null;
  ends_at?: string | null;
  is_permanent?: boolean | null;
  timezone?: string | null;
  location_name?: string | null;
  address?: string | null;
  latitude?: number | string | null;
  longitude?: number | string | null;
  image_url?: string | null;
  category?: string | null;
  audience?: string | null;
  visibility?: string | null;
  status?: string | null;
  source_type?: string | null;
  source_url?: string | null;
  registration_mode?: string | null;
  registration_url?: string | null;
  capacity?: number | string | null;
  waitlist_enabled?: boolean | null;
  requires_approval?: boolean | null;
  price_amount?: number | string | null;
  price_currency?: string | null;
  published_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

export type ApiEventOccurrenceResponse = {
  id: string;
  event_id?: string | null;
  title?: string | null;
  starts_at?: string | null;
  ends_at?: string | null;
  timezone?: string | null;
  registration_opens_at?: string | null;
  registration_closes_at?: string | null;
  capacity?: number | string | null;
  waitlist_enabled?: boolean | null;
  requires_approval?: boolean | null;
  status?: string | null;
  sort_order?: number | string | null;
  created_at?: string | null;
  updated_at?: string | null;
  server_now?: string | null;
  is_registration_always_open?: boolean | null;
  registration_state?: string | null;
  registration_state_reason?: string | null;
};

export type ApiRegistrationOptionSelectionRequest = {
  option_id: string;
  quantity: number;
};

export type ApiRegisterEventRequest = {
  occurrence_id?: string | null;
  seats_count?: number | null;
  guest_names?: string[] | null;
  comment?: string | null;
  option_selections?: ApiRegistrationOptionSelectionRequest[] | null;
};

export type ApiRegistrationSelectedOptionResponse = {
  id: string;
  option_id: string | null;
  title_snapshot: string;
  description_snapshot: string | null;
  option_type_snapshot: string;
  quantity: number | string;
  unit_price_amount: number | string;
  total_amount: number | string;
  currency: string;
  counts_toward_capacity: boolean;
  seats_count: number | string;
  is_donation: boolean;
  created_at: string;
};

export type ApiRegistrationCapacityReservationResponse = {
  id: string;
  capacity_unit_id: string;
  option_id: string | null;
  capacity_unit_key_snapshot: string;
  capacity_unit_title_snapshot: string;
  option_title_snapshot: string | null;
  quantity: number | string;
  seats_per_quantity: number | string;
  seats_count: number | string;
  created_at: string;
};

export type ApiEventRegistrationResponse = {
  id: string;
  event_id: string;
  occurrence_id: string | null;
  user_id: string;
  status: string;
  seats_count: number | string;
  guest_names: unknown[];
  comment: string | null;
  registered_at: string;
  confirmed_at: string | null;
  cancelled_at: string | null;
  payment_status: string;
  payment_id: string | null;
  created_at: string;
  updated_at: string;
  event: ApiEventResponse;
  occurrence: ApiEventOccurrenceResponse | null;
  selected_options: ApiRegistrationSelectedOptionResponse[];
  capacity_reservations: ApiRegistrationCapacityReservationResponse[];
  total_amount: number | string | null;
  total_currency: string | null;
};

export type ApiEventCategoryResponse = {
  id: string;
  community_id?: string | null;
  slug?: string | null;
  title?: string | null;
  description?: string | null;
  color?: string | null;
  icon?: string | null;
  sort_order?: number | string | null;
  is_active?: boolean | null;
  created_at?: string | null;
  updated_at?: string | null;
};

export type ApiPrayerActivityLogResponse = {
  id: string;
  user_id: string;
  activity_type: PrayerActivityType;
  activity_date: string;
  started_at: string | null;
  completed_at: string | null;
  timezone: string;
  city: string | null;
  hebrew_date: unknown;
  metadata: unknown;
  created_at: string;
  updated_at: string;
};

export type ApiRecordPrayerActivityRequest = {
  activity_type: PrayerActivityType;
  activity_date: string;
  started_at: string | null;
  completed_at: string | null;
  timezone: string;
  city: string | null;
  hebrew_date: Record<string, unknown>;
  metadata: Record<string, unknown>;
};

export type ApiAvatarUploadUrlRequest = {
  content_type: string;
  size_bytes: number;
};

export type ApiAvatarUploadUrlResponse = {
  avatar_id: string;
  upload_url: string;
  method: 'PUT';
  headers: Record<string, string>;
  expires_at: string;
  max_size_bytes: number;
};

export type ApiAvatarConfirmRequest = {
  avatar_id: string;
};

export type ApiAvatarConfirmResponse = {
  avatar_id: string;
  content_type: string;
  size_bytes: number;
  created_at: string;
  updated_at: string;
  confirmed_at: string;
  read_url: string;
  read_url_expires_at: string;
};

export type ApiAvatarReadUrlResponse = {
  avatar_id: string;
  read_url: string;
  expires_at: string;
};

export type ApiAvatarDeleteResponse = {
  avatar_id: string | null;
  deleted: boolean;
};

export type ApiCommunityContactResponse = {
  avatar_id: string | null;
  avatar_url: string | null;
  birth_date: string | null;
  city: string | null;
  community_id: string;
  display_name: string | null;
  email: string | null;
  first_name: string | null;
  hebrew_birth_date: HebrewDateJson | null;
  hebrew_name: string | null;
  id: string;
  joined_at: string | null;
  last_name: string | null;
  membership_status: string | null;
  phone: string | null;
  role: string | null;
  share_birth_date: boolean;
  share_city: boolean;
  share_email: boolean;
  share_hebrew_birth_date: boolean;
  share_hebrew_name: boolean;
  share_phone: boolean;
  show_in_community_directory: boolean;
  user_id: string;
};

export type ApiProfileContactVisibilityResponse = {
  birthday_reminders_enabled: boolean;
  created_at: string;
  share_birth_date: boolean;
  share_city: boolean;
  share_email: boolean;
  share_hebrew_birth_date: boolean;
  share_hebrew_name: boolean;
  share_phone: boolean;
  show_in_community_directory: boolean;
  updated_at: string;
  user_id: string;
};

export type ApiProfileContactVisibilityUpdateRequest = {
  birthday_reminders_enabled: boolean;
  share_birth_date: boolean;
  share_city: boolean;
  share_email: boolean;
  share_hebrew_birth_date: boolean;
  share_hebrew_name: boolean;
  share_phone: boolean;
  show_in_community_directory: boolean;
};
