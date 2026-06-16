import {
  getEffectiveEventStartsAt,
  isEventPast,
  parseEventTime,
} from '@/lib/eventTime';
import type { EventItem } from '@/types/event';

type HomeEventCandidate = {
  event: EventItem;
  startsAt: number;
};

function getHomeEventStartTime(event: EventItem): number | null {
  return parseEventTime(getEffectiveEventStartsAt(event));
}

function getHomeEventCandidate(event: EventItem, now: number): HomeEventCandidate | null {
  const startsAt = getHomeEventStartTime(event);

  if (startsAt === null || isEventPast(event, null, now)) {
    return null;
  }

  return { event, startsAt };
}

function sortHomeEventCandidates(candidates: HomeEventCandidate[]): HomeEventCandidate[] {
  return [...candidates].sort((first, second) => {
    if (first.startsAt !== second.startsAt) {
      return first.startsAt - second.startsAt;
    }

    return first.event.title.localeCompare(second.event.title, 'ru');
  });
}

export function selectHomeEvent(events: EventItem[], now: number = Date.now()): EventItem | null {
  const candidates: HomeEventCandidate[] = [];

  events.forEach((event) => {
    const candidate = getHomeEventCandidate(event, now);

    if (!candidate) {
      return;
    }

    candidates.push(candidate);
  });

  return sortHomeEventCandidates(candidates)[0]?.event ?? null;
}

export function selectHomeShabbatEvent(events: EventItem[], now: number = Date.now()): EventItem | null {
  const candidates: HomeEventCandidate[] = [];

  events.forEach((event) => {
    if (event.eventKind !== 'shabbat' || event.registrationMode === 'none') {
      return;
    }

    const candidate = getHomeEventCandidate(event, now);

    if (!candidate) {
      return;
    }

    candidates.push(candidate);
  });

  const sortedCandidates = sortHomeEventCandidates(candidates);

  return sortedCandidates.find(({ event }) => event.nextOccurrence?.registrationState === 'open')?.event
    ?? sortedCandidates.find(({ event }) => event.nextOccurrence?.registrationState === 'not_yet_open')?.event
    ?? sortedCandidates[0]?.event
    ?? null;
}
