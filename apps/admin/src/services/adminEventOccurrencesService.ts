import type { AdminEventOccurrence, AdminEventOccurrenceRow } from "../types/eventOccurrences";

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

function nullableBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

export function normalizeAdminEventOccurrenceRow(
  row: Partial<AdminEventOccurrenceRow>,
): AdminEventOccurrence {
  return {
    id: string(row.id), eventId: string(row.event_id), title: nullableString(row.title),
    startsAt: string(row.starts_at), endsAt: nullableString(row.ends_at),
    timezone: string(row.timezone, "Europe/Moscow"),
    registrationOpensAt: nullableString(row.registration_opens_at),
    registrationClosesAt: nullableString(row.registration_closes_at), capacity: nullableNumber(row.capacity),
    waitlistEnabled: nullableBoolean(row.waitlist_enabled), requiresApproval: nullableBoolean(row.requires_approval),
    status: string(row.status, "active"), sortOrder: nullableNumber(row.sort_order) ?? 0,
    createdAt: string(row.created_at), updatedAt: string(row.updated_at),
    serverNow: nullableString(row.server_now), isRegistrationAlwaysOpen: row.is_registration_always_open === true,
    registrationState: (row.registration_state as AdminEventOccurrence["registrationState"]) ?? "unavailable",
    registrationStateReason: nullableString(row.registration_state_reason),
  };
}

export { listAdminEventOccurrences, replaceAdminEventOccurrences } from "./adminEventOccurrencesApiService";
