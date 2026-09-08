import type {
  AdminEvent,
  AdminEventRow,
  AdminEventSchedule,
  AdminEventScheduleDay,
  AdminEventScheduleItem,
} from "../types/events";
import { isAdminEventSystemKey } from "../types/events";

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

function normalizeScheduleItem(value: unknown): AdminEventScheduleItem | null {
  if (!isRecord(value) || typeof value.time !== "string" || typeof value.title !== "string") {
    return null;
  }

  return {
    time: value.time,
    title: value.title,
    optionId: typeof value.option_id === "string" ? value.option_id : null,
    systemKey: value.system_key === undefined || value.system_key === null
      ? null
      : isAdminEventSystemKey(value.system_key) ? value.system_key : null,
  };
}

function normalizeScheduleDay(value: unknown): AdminEventScheduleDay | null {
  if (!isRecord(value) || typeof value.date !== "string" || !Array.isArray(value.items)) {
    return null;
  }

  const items = value.items
    .map(normalizeScheduleItem)
    .filter((item): item is AdminEventScheduleItem => item !== null);

  if (items.length !== value.items.length) {
    return null;
  }

  return {
    date: value.date,
    label: typeof value.label === "string" ? value.label : null,
    note: typeof value.note === "string" ? value.note : null,
    items,
  };
}

function normalizeSchedule(value: unknown): AdminEventSchedule | null {
  if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.days)) {
    return null;
  }

  const days = value.days
    .map(normalizeScheduleDay)
    .filter((day): day is AdminEventScheduleDay => day !== null);

  return days.length === value.days.length ? { version: 1, days } : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
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
    priceCurrency: nullableString(row.price_currency), schedule: normalizeSchedule(row.schedule),
    createdAt: string(row.created_at), updatedAt: string(row.updated_at),
    publishedAt: nullableString(row.published_at),
  };
}

export {
  createAdminEvent,
  deleteAdminEvent,
  getAdminEvent,
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
export {
  checkAdminEventPublicSlug,
  getAdminEventWebRegistration,
  updateAdminEventWebRegistration,
} from "./adminEventWebRegistrationService";
