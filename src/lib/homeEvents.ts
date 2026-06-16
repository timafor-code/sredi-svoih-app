import {
  getEffectiveEventStartsAt,
  isEventPast,
  parseEventTime,
} from '@/lib/eventTime';
import type { EventItem } from '@/types/event';

function getHomeEventStartTime(event: EventItem): number | null {
  return parseEventTime(getEffectiveEventStartsAt(event));
}

export function selectHomeEvent(events: EventItem[], now: number = Date.now()): EventItem | null {
  const candidates: Array<{ event: EventItem; startsAt: number }> = [];

  events.forEach((event) => {
    const startsAt = getHomeEventStartTime(event);

    if (startsAt === null || isEventPast(event, null, now)) {
      return;
    }

    candidates.push({ event, startsAt });
  });

  candidates.sort((first, second) => {
    if (first.startsAt !== second.startsAt) {
      return first.startsAt - second.startsAt;
    }

    return first.event.title.localeCompare(second.event.title, 'ru');
  });

  return candidates[0]?.event ?? null;
}
