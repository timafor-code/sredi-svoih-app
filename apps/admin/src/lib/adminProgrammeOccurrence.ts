import type { AdminEventOccurrence } from "../types/eventOccurrences";

export type AdminProgrammeOccurrenceSelection =
  | { kind: "selected"; occurrence: AdminEventOccurrence }
  | { kind: "unavailable" }
  | { kind: "invalid" };

/**
 * Mirrors the public Shabbat occurrence choice while relying exclusively on
 * the timestamp returned by the Admin occurrence endpoint. Registration state
 * is deliberately not part of this decision: a closed future occurrence is
 * still the public programme occurrence until it ends.
 */
export function selectAdminProgrammeOccurrence(
  occurrences: readonly AdminEventOccurrence[] | null | undefined,
): AdminProgrammeOccurrenceSelection {
  if (!occurrences) return { kind: "invalid" };
  if (occurrences.length === 0) return { kind: "unavailable" };

  const serverNowValues = occurrences.map((occurrence) => parseTimestamp(occurrence.serverNow));
  if (serverNowValues.some((value) => value === null)) return { kind: "invalid" };
  const serverNow = serverNowValues[0]!;
  if (serverNowValues.some((value) => value !== serverNow)) return { kind: "invalid" };

  const eligible: Array<{ occurrence: AdminEventOccurrence; startsAt: number }> = [];
  for (const occurrence of occurrences) {
    if (occurrence.status !== "active") continue;

    const startsAt = parseTimestamp(occurrence.startsAt);
    const boundary = parseTimestamp(occurrence.endsAt ?? occurrence.startsAt);
    if (startsAt === null || boundary === null) return { kind: "invalid" };
    if (boundary > serverNow) eligible.push({ occurrence, startsAt });
  }

  eligible.sort((left, right) => (
    left.startsAt - right.startsAt || left.occurrence.id.localeCompare(right.occurrence.id)
  ));
  return eligible[0] ? { kind: "selected", occurrence: eligible[0].occurrence } : { kind: "unavailable" };
}

function parseTimestamp(value: string | null | undefined): number | null {
  if (!value || !value.trim()) return null;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}
