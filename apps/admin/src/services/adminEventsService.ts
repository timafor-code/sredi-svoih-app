import type { AdminEvent, AdminEventRow } from "../types/events";

function string(value: unknown, fallback = ""): string {
  return value == null || String(value).trim() === "" ? fallback : String(value);
}

function nullableString(value: unknown): string | null {
  return value == null ? null : String(value);
}

function nullableNumber(value: unknown): number | null {
  const result = typeof value === "number" ? value : Number(value);
  return Number.isFinite(result) ? result : null;
}

export function normalizeAdminEventRow(row: Partial<AdminEventRow>): AdminEvent {
  return {
    id: string(row.id), communityId: string(row.community_id), eventKind: string(row.event_kind, "single"),
    title: string(row.title, "Без названия"), subtitle: nullableString(row.subtitle),
    description: nullableString(row.description), shortDescription: nullableString(row.short_description),
    startsAt: nullableString(row.starts_at), endsAt: nullableString(row.ends_at), isPermanent: row.is_permanent === true,
    timezone: nullableString(row.timezone), locationName: nullableString(row.location_name), address: nullableString(row.address),
    imageUrl: nullableString(row.image_url), category: nullableString(row.category), audience: nullableString(row.audience),
    visibility: string(row.visibility, "public"), status: string(row.status, "draft"),
    sourceType: string(row.source_type, "manual"), sourceUrl: nullableString(row.source_url),
    sourceExternalId: nullableString(row.source_external_id), manualOverride: row.manual_override === true,
    registrationMode: string(row.registration_mode, "none"), registrationUrl: nullableString(row.registration_url),
    capacity: nullableNumber(row.capacity), waitlistEnabled: row.waitlist_enabled === true,
    requiresApproval: row.requires_approval === true, priceAmount: nullableNumber(row.price_amount),
    priceCurrency: nullableString(row.price_currency), createdAt: string(row.created_at), updatedAt: string(row.updated_at),
    publishedAt: nullableString(row.published_at),
  };
}

export {
  createAdminEvent,
  deleteAdminEvent,
  listAdminEvents,
  updateAdminEvent,
} from "./adminEventsApiService";
export {
  listAdminEventCapacities,
  listEventRegistrations,
  listRegistrationEvents,
  markRegistrationAttendance,
  updateRegistrationStatus,
} from "./adminRegistrationApiService";
export { listAdminEventOccurrences as listRegistrationEventOccurrences } from "./adminEventOccurrencesApiService";
