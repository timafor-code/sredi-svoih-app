export const ADMIN_EVENT_STATUSES = ["draft", "published", "cancelled", "archived"] as const;
export const ADMIN_EVENT_VISIBILITIES = ["public", "members_only", "hidden"] as const;
export const ADMIN_EVENT_KINDS = [
  "single",
  "course",
  "sunday_school",
  "shabbat",
  "holiday",
  "announcement",
] as const;
export const ADMIN_EVENT_REGISTRATION_MODES = [
  "none",
  "external_link",
  "internal_free",
  "internal_paid",
] as const;

export type AdminEventStatus = (typeof ADMIN_EVENT_STATUSES)[number];
export type AdminEventVisibility = (typeof ADMIN_EVENT_VISIBILITIES)[number];
export type AdminEventKind = (typeof ADMIN_EVENT_KINDS)[number];
export type AdminEventRegistrationMode = (typeof ADMIN_EVENT_REGISTRATION_MODES)[number];

export const EVENT_STATUS_LABELS: Record<AdminEventStatus, string> = {
  draft: "Черновик",
  published: "Опубликовано",
  cancelled: "Отменено",
  archived: "В архиве",
};

export const EVENT_VISIBILITY_LABELS: Record<AdminEventVisibility, string> = {
  public: "Публично",
  members_only: "Для участников",
  hidden: "Скрыто",
};

export const REGISTRATION_MODE_LABELS: Record<AdminEventRegistrationMode, string> = {
  none: "Без регистрации",
  external_link: "Внешняя ссылка",
  internal_free: "Внутренняя бесплатная",
  internal_paid: "Варианты участия / оплата",
};

export const REGISTRATION_MODE_SHORT_LABELS: Record<AdminEventRegistrationMode, string> = {
  none: "Нет",
  external_link: "Внешняя",
  internal_free: "Внутр.",
  internal_paid: "Варианты",
};

export const EVENT_SOURCE_LABELS = {
  manual: "Вручную",
  external: "Внешняя",
  external_link: "Внешняя",
  import: "Импорт",
  website_scrape: "Импорт",
} as const;

export function isAdminEventStatus(value: string): value is AdminEventStatus {
  return (ADMIN_EVENT_STATUSES as readonly string[]).includes(value);
}

export function isAdminEventVisibility(value: string): value is AdminEventVisibility {
  return (ADMIN_EVENT_VISIBILITIES as readonly string[]).includes(value);
}

export function isAdminEventRegistrationMode(
  value: string,
): value is AdminEventRegistrationMode {
  return (ADMIN_EVENT_REGISTRATION_MODES as readonly string[]).includes(value);
}

export function getEventStatusLabel(status: string): string {
  return isAdminEventStatus(status) ? EVENT_STATUS_LABELS[status] : status;
}

export function getEventVisibilityLabel(visibility: string): string {
  return isAdminEventVisibility(visibility) ? EVENT_VISIBILITY_LABELS[visibility] : visibility;
}

export function getRegistrationModeLabel(registrationMode: string): string {
  return isAdminEventRegistrationMode(registrationMode)
    ? REGISTRATION_MODE_LABELS[registrationMode]
    : registrationMode;
}

export function getRegistrationModeShortLabel(registrationMode: string): string {
  return isAdminEventRegistrationMode(registrationMode)
    ? REGISTRATION_MODE_SHORT_LABELS[registrationMode]
    : registrationMode;
}

export function getEventSourceLabel(sourceType: string): string {
  const normalizedSourceType = sourceType.trim().toLocaleLowerCase("en-US");

  return normalizedSourceType in EVENT_SOURCE_LABELS
    ? EVENT_SOURCE_LABELS[normalizedSourceType as keyof typeof EVENT_SOURCE_LABELS]
    : sourceType;
}

export type AdminEventRow = {
  id: string;
  community_id: string;
  event_kind: AdminEventKind | string;
  title: string;
  subtitle: string | null;
  description: string | null;
  short_description: string | null;
  starts_at: string | null;
  ends_at: string | null;
  is_permanent: boolean;
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
  eventKind: AdminEventKind | string;
  title: string;
  subtitle: string | null;
  description: string | null;
  shortDescription: string | null;
  startsAt: string | null;
  endsAt: string | null;
  isPermanent: boolean;
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
  eventKind: AdminEventKind;
  subtitle: string | null;
  shortDescription: string | null;
  description: string | null;
  startsAt: string;
  endsAt: string | null;
  isPermanent: boolean;
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
