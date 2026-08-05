export type WebRegistrationState =
  | "open"
  | "not_yet_open"
  | "closed"
  | "full"
  | "unavailable";

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

export type WebEventRegistrationFormResponse = {
  event: WebRegistrationEvent;
  registration_state: WebRegistrationState;
  occurrences: WebRegistrationOccurrence[];
  participation_options: WebRegistrationParticipationOption[];
  legal_documents: WebRegistrationLegalDocument[];
};

export type AccountChoice = "without_password" | "create_account";
