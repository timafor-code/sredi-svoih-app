import type { EventItem } from '@/types/event';
import type { EventOccurrence } from '@/types/eventOccurrence';

export type EventTemporalState = 'past' | 'upcoming';

export type OccurrenceRegistrationState =
  | 'not_required'
  | 'past'
  | 'not_started'
  | 'open'
  | 'closed'
  | 'always_open';

export const OCCURRENCE_REGISTRATION_STATE_LABELS: Record<
  OccurrenceRegistrationState,
  string
> = {
  not_required: 'Регистрация не требуется',
  past: 'Сеанс прошёл',
  not_started: 'Регистрация ещё не началась',
  open: 'Регистрация открыта',
  closed: 'Регистрация закрыта',
  always_open: 'Регистрация открыта',
};

const INACTIVE_OCCURRENCE_STATUSES = new Set([
  'cancelled',
  'archived',
  'hidden',
  'inactive',
]);

function parseTime(value: string | null | undefined): number | null {
  if (!value) return null;
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? null : time;
}

export function isOccurrencePast(
  occurrence: Pick<EventOccurrence, 'startsAt' | 'endsAt'>,
  now: number = Date.now(),
): boolean {
  const boundary = parseTime(occurrence.endsAt) ?? parseTime(occurrence.startsAt);
  return boundary !== null && boundary < now;
}

export function isOccurrenceInactiveStatus(status: string | null | undefined): boolean {
  return Boolean(status && INACTIVE_OCCURRENCE_STATUSES.has(status));
}

export function isOccurrenceActive(
  occurrence: Pick<EventOccurrence, 'startsAt' | 'endsAt' | 'status'>,
  now: number = Date.now(),
): boolean {
  if (isOccurrenceInactiveStatus(occurrence.status)) {
    return false;
  }
  return !isOccurrencePast(occurrence, now);
}

export function hasFutureActiveOccurrences(
  occurrences: ReadonlyArray<EventOccurrence> | null | undefined,
  now: number = Date.now(),
): boolean {
  if (!occurrences || occurrences.length === 0) {
    return false;
  }
  return occurrences.some((occurrence) => isOccurrenceActive(occurrence, now));
}

export function getOccurrenceRegistrationState(
  occurrence: Pick<
    EventOccurrence,
    'startsAt' | 'endsAt' | 'status' | 'registrationOpensAt' | 'registrationClosesAt'
  >,
  now: number = Date.now(),
  eventRegistrationMode?: string | null,
): OccurrenceRegistrationState {
  if (eventRegistrationMode === 'none') {
    return 'not_required';
  }

  if (isOccurrencePast(occurrence, now)) {
    return 'past';
  }

  const opensAt = parseTime(occurrence.registrationOpensAt);
  const closesAt = parseTime(occurrence.registrationClosesAt);

  if (opensAt !== null && now < opensAt) {
    return 'not_started';
  }

  if (closesAt !== null && now > closesAt) {
    return 'closed';
  }

  if (opensAt === null && closesAt === null) {
    return 'always_open';
  }

  return 'open';
}

export function getOccurrenceRegistrationStateLabel(
  state: OccurrenceRegistrationState,
): string {
  return OCCURRENCE_REGISTRATION_STATE_LABELS[state];
}

type EventTimingInfo = Pick<EventItem, 'startsAt' | 'endsAt'> & {
  isPermanent?: boolean | null;
};

export function getEventTemporalState(
  event: EventTimingInfo,
  occurrences?: ReadonlyArray<EventOccurrence> | null,
  now: number = Date.now(),
): EventTemporalState {
  if (hasFutureActiveOccurrences(occurrences, now)) {
    return 'upcoming';
  }

  if (event.isPermanent) {
    return 'upcoming';
  }

  const endsAt = parseTime(event.endsAt);
  if (endsAt !== null) {
    return endsAt < now ? 'past' : 'upcoming';
  }

  const startsAt = parseTime(event.startsAt);
  if (startsAt !== null) {
    return startsAt < now ? 'past' : 'upcoming';
  }

  return 'upcoming';
}

export function isEventPast(
  event: EventTimingInfo,
  occurrences?: ReadonlyArray<EventOccurrence> | null,
  now: number = Date.now(),
): boolean {
  return getEventTemporalState(event, occurrences, now) === 'past';
}

export function getEventEarliestUpcomingTime(
  event: Pick<EventItem, 'startsAt'>,
  occurrences?: ReadonlyArray<EventOccurrence> | null,
  now: number = Date.now(),
): number | null {
  if (occurrences && occurrences.length > 0) {
    const futureTimes = occurrences
      .filter((occurrence) => isOccurrenceActive(occurrence, now))
      .map((occurrence) => parseTime(occurrence.startsAt))
      .filter((value): value is number => value !== null && value >= now)
      .sort((left, right) => left - right);

    if (futureTimes.length > 0) {
      return futureTimes[0];
    }
  }

  return parseTime(event.startsAt);
}
