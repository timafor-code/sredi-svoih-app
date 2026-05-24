import type { EventOccurrence } from '@/types/eventOccurrence';

type EventTimeInput = {
  eventKind?: string | null;
  startsAt?: string | null;
  endsAt?: string | null;
  isPermanent?: boolean | null;
  nextOccurrence?: EventOccurrence | null;
  effectiveStartsAt?: string | null;
  effectiveEndsAt?: string | null;
  hasOccurrences?: boolean | null;
};

const ACTIVE_OCCURRENCE_STATUSES = new Set(['active']);
const RECURRING_EVENT_KINDS = new Set(['shabbat', 'course', 'sunday_school', 'holiday']);

export function parseEventTime(value: string | null | undefined): number | null {
  if (!value) {
    return null;
  }

  const time = new Date(value).getTime();

  return Number.isNaN(time) ? null : time;
}

export function isRecurringEventKind(eventKind: string | null | undefined): boolean {
  return Boolean(eventKind && RECURRING_EVENT_KINDS.has(eventKind));
}

function isActiveOccurrence(occurrence: EventOccurrence): boolean {
  return ACTIVE_OCCURRENCE_STATUSES.has(occurrence.status);
}

export function selectNextFutureOccurrence(
  occurrences: EventOccurrence[] | null | undefined,
  now: number = Date.now(),
): EventOccurrence | null {
  if (!occurrences || occurrences.length === 0) {
    return null;
  }

  const futureOccurrences = occurrences.filter((occurrence) => {
    if (!isActiveOccurrence(occurrence)) {
      return false;
    }

    const startsAtTime = parseEventTime(occurrence.startsAt);
    const boundary = parseEventTime(occurrence.endsAt) ?? parseEventTime(occurrence.startsAt);

    return startsAtTime !== null && boundary !== null && boundary >= now;
  });

  return futureOccurrences.sort((first, second) => {
    const firstStart = parseEventTime(first.startsAt) ?? 0;
    const secondStart = parseEventTime(second.startsAt) ?? 0;

    if (firstStart !== secondStart) {
      return firstStart - secondStart;
    }

    return first.sortOrder - second.sortOrder;
  })[0] ?? null;
}

export function getEffectiveEventStartsAt(event: EventTimeInput): string | null {
  return event.effectiveStartsAt ?? event.nextOccurrence?.startsAt ?? event.startsAt ?? null;
}

export function getEffectiveEventEndsAt(event: EventTimeInput): string | null {
  if (event.effectiveStartsAt || event.nextOccurrence) {
    return event.effectiveEndsAt ?? event.nextOccurrence?.endsAt ?? null;
  }

  return event.endsAt ?? null;
}

// Permanent parent events remain upcoming until explicitly archived/cancelled/hidden
// unless loaded occurrence data shows that no future active session remains.
export function isEventPast(
  event: EventTimeInput,
  occurrences?: EventOccurrence[] | null,
  now: number = Date.now(),
): boolean {
  const occurrenceFromEvent = event.nextOccurrence ?? null;
  const occurrenceFromList = selectNextFutureOccurrence(occurrences, now);
  const hasEffectiveOccurrence = Boolean(event.effectiveStartsAt || occurrenceFromEvent);
  const hasOccurrenceData = event.hasOccurrences === true || Boolean(occurrences?.length);

  if (occurrenceFromList && !hasEffectiveOccurrence) {
    return false;
  }

  if (occurrenceFromEvent || occurrenceFromList || hasEffectiveOccurrence) {
    const effectiveBoundary = parseEventTime(getEffectiveEventEndsAt(event))
      ?? parseEventTime(getEffectiveEventStartsAt(event));

    return effectiveBoundary !== null && effectiveBoundary < now;
  }

  if (hasOccurrenceData) {
    return true;
  }

  if (event.isPermanent === true) {
    return false;
  }

  const endsAtTime = parseEventTime(getEffectiveEventEndsAt(event));

  if (endsAtTime !== null) {
    return endsAtTime < now;
  }

  const startsAtTime = parseEventTime(getEffectiveEventStartsAt(event));

  if (startsAtTime === null) {
    return false;
  }

  return startsAtTime < now;
}

export function getEventSortTime(event: EventTimeInput): number {
  const effectiveStartsAtTime = parseEventTime(getEffectiveEventStartsAt(event));

  if (effectiveStartsAtTime !== null) {
    return effectiveStartsAtTime;
  }

  if (event.hasOccurrences === true) {
    return parseEventTime(event.startsAt) ?? 0;
  }

  if (event.isPermanent === true) {
    return Number.POSITIVE_INFINITY;
  }

  return parseEventTime(event.startsAt) ?? 0;
}
