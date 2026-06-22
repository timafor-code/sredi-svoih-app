import { requireSupabaseClient } from "./supabaseClient";
import {
  ADMIN_EVENT_OCCURRENCE_REGISTRATION_STATES,
  type AdminEventOccurrenceRegistrationState,
  type AdminEventOccurrence,
  type AdminEventOccurrenceInput,
  type AdminEventOccurrenceRow,
} from "../types/eventOccurrences";

type SupabaseSelectError = {
  message?: string;
  details?: string | null;
  hint?: string | null;
};

type EventOccurrenceRpcPayload = {
  id: string | null;
  title: string | null;
  startsAt: string;
  endsAt: string | null;
  timezone: string;
  registrationOpensAt: string | null;
  registrationClosesAt: string | null;
  capacity: number | null;
  waitlistEnabled: boolean | null;
  requiresApproval: boolean | null;
  status: string;
  sortOrder: number;
};

function isRegistrationState(
  value: unknown,
): value is AdminEventOccurrenceRegistrationState {
  return (
    typeof value === "string" &&
    (ADMIN_EVENT_OCCURRENCE_REGISTRATION_STATES as readonly string[]).includes(value)
  );
}

function requiredRegistrationState(
  value: unknown,
): AdminEventOccurrenceRegistrationState {
  return isRegistrationState(value) ? value : "unavailable";
}

function formatSupabaseError(action: string, error: SupabaseSelectError): string {
  const details = [error.message, error.details, error.hint].filter(Boolean).join(" ");
  return `${action} failed: ${details || "Unknown Supabase error"}`;
}

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

function safeNumber(value: unknown, fallback: number): number {
  const parsed = nullableNumber(value);
  return parsed === null ? fallback : parsed;
}

function nullableBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") return true;
    if (normalized === "false") return false;
  }

  return null;
}

function sortOccurrences(
  occurrences: AdminEventOccurrence[],
): AdminEventOccurrence[] {
  return [...occurrences].sort((left, right) => {
    const bySortOrder = left.sortOrder - right.sortOrder;
    if (bySortOrder !== 0) {
      return bySortOrder;
    }

    const leftStartsAt = new Date(left.startsAt).getTime();
    const rightStartsAt = new Date(right.startsAt).getTime();
    return leftStartsAt - rightStartsAt;
  });
}

export function normalizeAdminEventOccurrenceRow(
  row: Partial<AdminEventOccurrenceRow>,
): AdminEventOccurrence {
  return {
    id: requiredString(row.id, ""),
    eventId: requiredString(row.event_id, ""),
    title: nullableString(row.title),
    startsAt: requiredString(row.starts_at, ""),
    endsAt: nullableString(row.ends_at),
    timezone: requiredString(row.timezone, "Europe/Moscow"),
    registrationOpensAt: nullableString(row.registration_opens_at),
    registrationClosesAt: nullableString(row.registration_closes_at),
    capacity: nullableNumber(row.capacity),
    waitlistEnabled: nullableBoolean(row.waitlist_enabled),
    requiresApproval: nullableBoolean(row.requires_approval),
    status: requiredString(row.status, "active"),
    sortOrder: safeNumber(row.sort_order, 0),
    createdAt: requiredString(row.created_at, ""),
    updatedAt: requiredString(row.updated_at, ""),
    serverNow: nullableString(row.server_now),
    isRegistrationAlwaysOpen: nullableBoolean(row.is_registration_always_open) === true,
    registrationState: requiredRegistrationState(row.registration_state),
    registrationStateReason: nullableString(row.registration_state_reason),
  };
}

export async function listAdminEventOccurrences(
  eventId: string,
): Promise<AdminEventOccurrence[]> {
  const supabase = requireSupabaseClient();
  const { data, error } = await supabase.rpc("admin_list_event_occurrences", {
    p_event_id: eventId,
  });

  if (error) {
    throw new Error(formatSupabaseError("List event occurrences", error));
  }

  return sortOccurrences(
    ((data ?? []) as AdminEventOccurrenceRow[]).map(normalizeAdminEventOccurrenceRow),
  );
}

function toRpcPayload(
  input: AdminEventOccurrenceInput,
): EventOccurrenceRpcPayload {
  return {
    id: input.id,
    title: input.title,
    startsAt: input.startsAt,
    endsAt: input.endsAt,
    timezone: input.timezone,
    registrationOpensAt: input.registrationOpensAt,
    registrationClosesAt: input.registrationClosesAt,
    capacity: input.capacity,
    waitlistEnabled: input.waitlistEnabled,
    requiresApproval: input.requiresApproval,
    status: input.status,
    sortOrder: input.sortOrder,
  };
}

export async function replaceAdminEventOccurrences(
  eventId: string,
  occurrences: AdminEventOccurrenceInput[],
): Promise<AdminEventOccurrence[]> {
  const supabase = requireSupabaseClient();
  const payload = occurrences.map(toRpcPayload);
  const { error } = await supabase.rpc("admin_replace_event_occurrences", {
    p_event_id: eventId,
    p_occurrences: payload,
  });

  if (error) {
    throw new Error(formatSupabaseError("Replace event occurrences", error));
  }

  return listAdminEventOccurrences(eventId);
}
