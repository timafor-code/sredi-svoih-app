export type WebRegistrationState =
  | "open"
  | "not_yet_open"
  | "closed"
  | "full"
  | "unavailable";

export type OccurrenceSelectionMode = "none" | "user_select" | "nearest";

export type WebRegistrationMode = "internal_free" | "internal_paid";

export type ApiResponse<T> = {
  data: T;
  error: null;
  meta: Record<string, unknown>;
};

export type ApiErrorResponse = {
  data: null;
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown> | null;
  };
  meta: Record<string, unknown>;
};

export type WebRegistrationEvent = {
  id: string;
  title: string;
  subtitle: string | null;
  description: string | null;
  short_description: string | null;
  starts_at: string;
  ends_at: string | null;
  timezone: string | null;
  location_name: string | null;
  address: string | null;
  image_url: string | null;
  category: string;
  registration_mode: WebRegistrationMode;
  capacity: number | null;
  waitlist_enabled: boolean;
  requires_approval: boolean;
};

export type WebRegistrationOccurrence = {
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
  registration_state: WebRegistrationState;
};

export type WebRegistrationParticipationOption = {
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
  sort_order: number;
};

export type WebRegistrationLegalDocument = {
  id: string;
  document_type: "event_registration_consent" | "privacy_policy";
  version: string;
  title: string;
  content_hash: string;
  published_url: string;
  effective_at: string;
};

export type WebQuestionnaireFieldType =
  | "short_text"
  | "long_text"
  | "single_select"
  | "multi_select"
  | "boolean";

export type WebQuestionnaireOption = {
  value: string;
  label: string;
};

export type WebQuestionnaireField = {
  id: string;
  field_key: string;
  field_type: WebQuestionnaireFieldType;
  label: string;
  required: boolean;
  purpose: string;
  retention_days: number;
  options: WebQuestionnaireOption[];
  validation: Record<string, number>;
  sort_order: number;
};

export type WebEventRegistrationFormResponse = {
  canonical_public_path: string;
  resolved_from_alias: boolean;
  event: WebRegistrationEvent;
  registration_state: WebRegistrationState;
  occurrence_selection_mode: OccurrenceSelectionMode;
  default_occurrence_id: string | null;
  next_registration_state_check_at: string | null;
  occurrences: WebRegistrationOccurrence[];
  participation_options: WebRegistrationParticipationOption[];
  legal_documents: WebRegistrationLegalDocument[];
  questionnaire_form_id: string | null;
  questions: WebQuestionnaireField[];
};

export type AccountChoice = "without_password" | "create_account";

export type TemporaryAuthTokens = {
  access_token: string;
  refresh_token: string;
  expires_at: string;
};

export type ExistingAccountIdentity = {
  email: string;
  email_verified_at: string | null;
  first_name: string;
  last_name: string;
  phone: string;
};

export type MyRegistrationStatus =
  | "pending"
  | "confirmed"
  | "waitlisted"
  | "cancelled"
  | "rejected"
  | "attended"
  | "no_show";

export type MyRegistrationPaymentStatus =
  | "not_required"
  | "pending"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "refunded"
  | "paid";

export type MyRegistrationEvent = {
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
  source_url: string | null;
  registration_mode: string;
  registration_url: string | null;
  capacity: number | null;
  waitlist_enabled: boolean;
  requires_approval: boolean;
  price_amount: number | null;
  price_currency: string | null;
  published_at: string | null;
  created_at: string;
  updated_at: string;
};

export type MyRegistrationOccurrence = {
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
};

export type MyRegistrationSelectedOption = {
  id: string;
  option_id: string | null;
  title_snapshot: string;
  description_snapshot: string | null;
  option_type_snapshot: string;
  quantity: number;
  unit_price_amount: number;
  total_amount: number;
  currency: string;
  counts_toward_capacity: boolean;
  seats_count: number;
  is_donation: boolean;
  created_at: string;
};

export type MyRegistrationCapacityReservation = {
  id: string;
  capacity_unit_id: string;
  option_id: string | null;
  capacity_unit_key_snapshot: string;
  capacity_unit_title_snapshot: string;
  option_title_snapshot: string | null;
  quantity: number;
  seats_per_quantity: number;
  seats_count: number;
  created_at: string;
};

export type MyRegistration = {
  id: string;
  event_id: string;
  occurrence_id: string | null;
  user_id: string;
  status: MyRegistrationStatus;
  seats_count: number;
  guest_names: unknown[];
  comment: string | null;
  registered_at: string;
  confirmed_at: string | null;
  cancelled_at: string | null;
  payment_status: MyRegistrationPaymentStatus;
  payment_id: string | null;
  created_at: string;
  updated_at: string;
  event: MyRegistrationEvent;
  occurrence: MyRegistrationOccurrence | null;
  selected_options: MyRegistrationSelectedOption[];
  capacity_reservations: MyRegistrationCapacityReservation[];
  total_amount: number | null;
  total_currency: string | null;
};

export type WebOptionSelection = {
  option_id: string;
  quantity: number;
};

export type WebLegalAcceptance = {
  document_id: string;
  content_hash: string;
};

export type WebQuestionnaireAnswerValue = string | boolean | string[];

export type WebQuestionnaireAnswer = {
  field_id: string;
  value: WebQuestionnaireAnswerValue;
};

export type WebRegistrationIntentRequest = {
  event_id: string;
  occurrence_id: string | null;
  first_name: string;
  last_name: string;
  phone: string;
  email: string;
  seats_count: number;
  option_selections: WebOptionSelection[];
  questionnaire_form_id: string | null;
  answers: WebQuestionnaireAnswer[];
  legal_acceptances: WebLegalAcceptance[];
  account_choice: AccountChoice;
  idempotency_key: string;
};

export type WebRegistrationIntentCreated = {
  flow_id: string;
  next_step: "confirm_email" | "completed";
  expires_at: string;
};

export type WebRegistrationStatus = "confirmed" | "pending" | "waitlisted" | "attended";

export type WebRegistrationPaymentStatus =
  | "not_required"
  | "pending"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "refunded"
  | "paid";

export type WebRegistrationResult = {
  id: string;
  event_id: string;
  occurrence_id: string | null;
  status: WebRegistrationStatus;
  seats_count: number;
  payment_status: WebRegistrationPaymentStatus;
  total_amount: number | null;
  total_currency: string | null;
};

export type AccountNextStep = "none" | "set_password" | "sign_in" | "request_set_password";

export type WebRegistrationConfirmResult = {
  intent_status: "confirmed";
  registration: WebRegistrationResult;
  account_next_step: AccountNextStep;
  set_password_code: string | null;
  set_password_expires_at: string | null;
};

export type WebRegistrationIntentStatus = {
  state: "email_verification_required" | "confirmed" | "not_available";
  expires_at: string | null;
  registration: WebRegistrationResult | null;
  account_next_step: AccountNextStep | null;
};

export type WebRegistrationResendResult = {
  next_step: "confirm_email";
  expires_at: string;
};

export type AuthCodeResult = {
  ok: true;
};
