export const ADMIN_EVENT_STATUSES = ["draft", "published", "cancelled", "archived"] as const;
export const ADMIN_EVENT_VISIBILITIES = ["public", "members_only", "hidden"] as const;
export const ADMIN_EVENT_REGISTRATION_MODES = [
  "none",
  "external_link",
  "internal_free",
  "internal_paid",
] as const;

export type AdminEventStatus = (typeof ADMIN_EVENT_STATUSES)[number];
export type AdminEventVisibility = (typeof ADMIN_EVENT_VISIBILITIES)[number];
export type AdminEventRegistrationMode = (typeof ADMIN_EVENT_REGISTRATION_MODES)[number];

export type AdminEventRow = {
  id: string;
  community_id: string;
  title: string;
  subtitle: string | null;
  description: string | null;
  short_description: string | null;
  starts_at: string | null;
  ends_at: string | null;
  timezone: string | null;
  location_name: string | null;
  address: string | null;
  image_url: string | null;
  category: string | null;
  audience: string | null;
  visibility: AdminEventVisibility | string;
  status: AdminEventStatus | string;
  source_type: string;
  source_url: string | null;
  source_external_id: string | null;
  manual_override: boolean;
  registration_mode: AdminEventRegistrationMode | string;
  registration_url: string | null;
  capacity: number | null;
  waitlist_enabled: boolean;
  requires_approval: boolean;
  price_amount: number | null;
  price_currency: string | null;
  created_at: string;
  updated_at: string;
  published_at: string | null;
};

export type AdminEvent = {
  id: string;
  communityId: string;
  title: string;
  subtitle: string | null;
  description: string | null;
  shortDescription: string | null;
  startsAt: string | null;
  endsAt: string | null;
  timezone: string | null;
  locationName: string | null;
  address: string | null;
  imageUrl: string | null;
  category: string | null;
  audience: string | null;
  visibility: AdminEventVisibility | string;
  status: AdminEventStatus | string;
  sourceType: string;
  sourceUrl: string | null;
  sourceExternalId: string | null;
  manualOverride: boolean;
  registrationMode: AdminEventRegistrationMode | string;
  registrationUrl: string | null;
  capacity: number | null;
  waitlistEnabled: boolean;
  requiresApproval: boolean;
  priceAmount: number | null;
  priceCurrency: string | null;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
};

export type AdminEventMutationInput = {
  title: string;
  subtitle: string | null;
  shortDescription: string | null;
  description: string | null;
  startsAt: string;
  endsAt: string | null;
  timezone: string;
  locationName: string | null;
  address: string | null;
  imageUrl: string | null;
  category: string;
  audience: string | null;
  visibility: AdminEventVisibility;
  status: AdminEventStatus;
  registrationMode: AdminEventRegistrationMode;
  registrationUrl: string | null;
  capacity: number | null;
  waitlistEnabled: boolean;
  requiresApproval: boolean;
  priceAmount: number | null;
  priceCurrency: string;
};

export type CreateAdminEventInput = AdminEventMutationInput & {
  communityId: string;
};

export type UpdateAdminEventInput = Partial<AdminEventMutationInput>;
