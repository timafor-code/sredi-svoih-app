import { requireSupabaseClient } from "./supabaseClient";
import type {
  AdminEvent,
  AdminEventMutationInput,
  AdminEventRow,
  CreateAdminEventInput,
  UpdateAdminEventInput,
} from "../types/events";

type SupabaseSelectError = {
  message?: string;
  details?: string | null;
  hint?: string | null;
};

const ADMIN_EVENT_FIELDS = `
  id,
  community_id,
  title,
  subtitle,
  description,
  short_description,
  starts_at,
  ends_at,
  timezone,
  location_name,
  address,
  image_url,
  category,
  audience,
  visibility,
  status,
  source_type,
  source_url,
  source_external_id,
  manual_override,
  registration_mode,
  registration_url,
  capacity,
  waitlist_enabled,
  requires_approval,
  price_amount,
  price_currency,
  created_at,
  updated_at,
  published_at
`;

function nullableString(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  return typeof value === "string" ? value : String(value);
}

function requiredString(value: unknown, fallback: string): string {
  const normalized = nullableString(value);
  return normalized && normalized.trim().length > 0 ? normalized : fallback;
}

function nullableNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function normalizeAdminEventRow(row: Partial<AdminEventRow>): AdminEvent {
  return {
    id: requiredString(row.id, ""),
    communityId: requiredString(row.community_id, ""),
    title: requiredString(row.title, "Без названия"),
    subtitle: nullableString(row.subtitle),
    description: nullableString(row.description),
    shortDescription: nullableString(row.short_description),
    startsAt: nullableString(row.starts_at),
    endsAt: nullableString(row.ends_at),
    timezone: nullableString(row.timezone),
    locationName: nullableString(row.location_name),
    address: nullableString(row.address),
    imageUrl: nullableString(row.image_url),
    category: nullableString(row.category),
    audience: nullableString(row.audience),
    visibility: requiredString(row.visibility, "public"),
    status: requiredString(row.status, "draft"),
    sourceType: requiredString(row.source_type, "manual"),
    sourceUrl: nullableString(row.source_url),
    sourceExternalId: nullableString(row.source_external_id),
    manualOverride: row.manual_override === true,
    registrationMode: requiredString(row.registration_mode, "none"),
    registrationUrl: nullableString(row.registration_url),
    capacity: nullableNumber(row.capacity),
    waitlistEnabled: row.waitlist_enabled === true,
    requiresApproval: row.requires_approval === true,
    priceAmount: nullableNumber(row.price_amount),
    priceCurrency: nullableString(row.price_currency),
    createdAt: requiredString(row.created_at, ""),
    updatedAt: requiredString(row.updated_at, ""),
    publishedAt: nullableString(row.published_at),
  };
}

function normalizeSingleAdminEvent(
  data: Partial<AdminEventRow> | Partial<AdminEventRow>[] | null,
): AdminEvent {
  const row = Array.isArray(data) ? data[0] : data;

  if (!row) {
    throw new Error("Admin event RPC returned an empty result.");
  }

  return normalizeAdminEventRow(row);
}

function formatSupabaseError(action: string, error: SupabaseSelectError): string {
  const details = [error.message, error.details, error.hint].filter(Boolean).join(" ");
  return `${action} failed: ${details || "Unknown Supabase error"}`;
}

export async function listAdminEvents(): Promise<AdminEvent[]> {
  const supabase = requireSupabaseClient();
  const { data, error } = await supabase
    .from("events")
    .select(ADMIN_EVENT_FIELDS)
    .order("starts_at", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(formatSupabaseError("List admin events", error));
  }

  return ((data ?? []) as AdminEventRow[]).map(normalizeAdminEventRow);
}

export async function createAdminEvent(input: CreateAdminEventInput): Promise<AdminEvent> {
  const supabase = requireSupabaseClient();
  const payload = {
    communityId: input.communityId,
    ...buildAdminEventMutationPayload(input),
  };

  const { data, error } = await supabase.rpc("admin_create_event", { payload });

  if (error) {
    throw new Error(formatSupabaseError("Create admin event", error));
  }

  return normalizeSingleAdminEvent(data as Partial<AdminEventRow> | Partial<AdminEventRow>[] | null);
}

export async function updateAdminEvent(
  eventId: string,
  input: UpdateAdminEventInput,
): Promise<AdminEvent> {
  const supabase = requireSupabaseClient();
  const payload = buildAdminEventMutationPayload(input);
  const { data, error } = await supabase.rpc("admin_update_event", {
    event_id: eventId,
    payload,
  });

  if (error) {
    throw new Error(formatSupabaseError("Update admin event", error));
  }

  return normalizeSingleAdminEvent(data as Partial<AdminEventRow> | Partial<AdminEventRow>[] | null);
}

type AdminEventMutationPayload = Record<string, string | number | boolean | null>;

function buildAdminEventMutationPayload(
  input: Partial<AdminEventMutationInput>,
): AdminEventMutationPayload {
  const payload = {
    title: input.title,
    subtitle: input.subtitle,
    shortDescription: input.shortDescription,
    description: input.description,
    startsAt: input.startsAt,
    endsAt: input.endsAt,
    timezone: input.timezone,
    locationName: input.locationName,
    address: input.address,
    imageUrl: input.imageUrl,
    category: input.category,
    audience: input.audience,
    visibility: input.visibility,
    status: input.status,
    registrationMode: input.registrationMode,
    registrationUrl: input.registrationUrl,
    capacity: input.capacity,
    waitlistEnabled: input.waitlistEnabled,
    requiresApproval: input.requiresApproval,
    priceAmount: input.priceAmount,
    priceCurrency: input.priceCurrency,
  } satisfies Record<string, string | number | boolean | null | undefined>;

  return Object.fromEntries(
    Object.entries(payload).filter(([, value]) => value !== undefined),
  ) as AdminEventMutationPayload;
}
