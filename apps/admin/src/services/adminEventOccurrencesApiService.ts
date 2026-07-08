import { apiClient } from "./apiClient";
import { normalizeAdminEventOccurrenceRow } from "./adminEventOccurrencesService";
import type { AdminApiEventOccurrenceResponse } from "../types/api";
import type {
  AdminEventOccurrence,
  AdminEventOccurrenceInput,
} from "../types/eventOccurrences";

type AdminEventOccurrenceApiPayload = {
  id: string | null;
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
};

function normalizeAdminApiEventOccurrence(
  row: AdminApiEventOccurrenceResponse,
): AdminEventOccurrence {
  return normalizeAdminEventOccurrenceRow(row);
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

function toApiPayload(
  input: AdminEventOccurrenceInput,
): AdminEventOccurrenceApiPayload {
  return {
    id: input.id,
    title: input.title,
    starts_at: input.startsAt,
    ends_at: input.endsAt,
    timezone: input.timezone,
    registration_opens_at: input.registrationOpensAt,
    registration_closes_at: input.registrationClosesAt,
    capacity: input.capacity,
    waitlist_enabled: input.waitlistEnabled,
    requires_approval: input.requiresApproval,
    status: input.status,
    sort_order: input.sortOrder,
  };
}

export async function listAdminEventOccurrences(
  eventId: string,
): Promise<AdminEventOccurrence[]> {
  const occurrences = await apiClient.get<AdminApiEventOccurrenceResponse[]>(
    `/admin/events/${encodeURIComponent(eventId)}/occurrences`,
  );

  return sortOccurrences(occurrences.map(normalizeAdminApiEventOccurrence));
}

export async function replaceAdminEventOccurrences(
  eventId: string,
  occurrences: AdminEventOccurrenceInput[],
): Promise<AdminEventOccurrence[]> {
  const response = await apiClient.put<
    AdminApiEventOccurrenceResponse[],
    { occurrences: AdminEventOccurrenceApiPayload[] }
  >(
    `/admin/events/${encodeURIComponent(eventId)}/occurrences`,
    { occurrences: occurrences.map(toApiPayload) },
  );

  return sortOccurrences(response.map(normalizeAdminApiEventOccurrence));
}
