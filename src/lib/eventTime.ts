import type { EventOccurrence } from '@/types/eventOccurrence';

type EventTimeInput = {
  startsAt?: string | null;
  endsAt?: string | null;
  isPermanent?: boolean | null;
};

const ACTIVE_OCCURRENCE_STATUSES = new Set(['active']);

export function parseEventTime(value: string | null | undefined): number | null {
  if (!value) {
    return null;
  }

  const time = new Date(value).getTime();

  return Number.isNaN(time) ? null : time;
}

function hasFutureActiveOccurrence(
  occurrences: EventOccurrence[] | null | undefined,
  now: number,
): boolean {
  if (!occurrences || occurrences.length === 0) {
    return false;
  }

  return occurrences.some((occurrence) => {
    if (!ACTIVE_OCCURRENCE_STATUSES.has(occurrence.status)) {
      return false;
    }

    const boundary = parseEventTime(occurrence.endsAt) ?? parseEventTime(occurrence.startsAt);

    return boundary !== null && boundary >= now;
  });
}

// Permanent parent events remain upcoming until explicitly archived/cancelled/hidden
// or until a future occurrence model says otherwise.
export function isEventPast(
  event: EventTimeInput,
  occurrences?: EventOccurrence[] | null,
  now: number = Date.now(),
): boolean {
  if (event.isPermanent === true) {
    return false;
  }

  if (hasFutureActiveOccurrence(occurrences, now)) {
    return false;
  }

  const endsAtTime = parseEventTime(event.endsAt);

  if (endsAtTime !== null) {
    return endsAtTime < now;
  }

  const startsAtTime = parseEventTime(event.startsAt);

  if (startsAtTime === null) {
    return false;
  }

  return startsAtTime < now;
}

export function getEventSortTime(event: EventTimeInput): number {
  if (event.isPermanent === true) {
    return Number.POSITIVE_INFINITY;
  }

  return parseEventTime(event.startsAt) ?? 0;
}
