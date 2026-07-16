import {
  isRecurringEventKind,
  selectNextFutureOccurrence,
} from '@/lib/eventTime';
import { listEventOccurrences } from '@/services/eventOccurrencesService';
import type { Event } from '@/types/event';

import * as eventsApiService from './eventsApiService';

function shouldLoadOccurrences(event: Event): boolean {
  return isRecurringEventKind(event.eventKind) || event.isPermanent === true;
}

async function applyEffectiveOccurrence(
  event: Event,
  now: number,
  excludeRecurringWithoutFuture: boolean,
): Promise<Event | null> {
  if (!shouldLoadOccurrences(event)) return event;

  try {
    const occurrences = await listEventOccurrences(event.id);
    const nextOccurrence = selectNextFutureOccurrence(occurrences, now);
    const hasOccurrences = occurrences.length > 0 || isRecurringEventKind(event.eventKind);

    if (nextOccurrence) {
      return {
        ...event,
        nextOccurrence,
        effectiveStartsAt: nextOccurrence.startsAt,
        effectiveEndsAt: nextOccurrence.endsAt,
        hasOccurrences,
      };
    }

    if (excludeRecurringWithoutFuture && hasOccurrences) return null;

    return {
      ...event,
      nextOccurrence: null,
      effectiveStartsAt: null,
      effectiveEndsAt: null,
      hasOccurrences,
    };
  } catch (error) {
    if (__DEV__) {
      console.warn('[events] failed to load event occurrences', {
        eventId: event.id,
        eventKind: event.eventKind,
        message: error instanceof Error ? error.message : String(error),
      });
    }

    return excludeRecurringWithoutFuture && !shouldLoadOccurrences(event) ? null : event;
  }
}

export async function listPublishedEvents(): Promise<Event[]> {
  const now = Date.now();
  const events = await eventsApiService.listPublishedEvents();
  const resolvedEvents = await Promise.all(
    events.map((event) => applyEffectiveOccurrence(event, now, true)),
  );

  return resolvedEvents.filter((event): event is Event => event !== null);
}

export async function getEventById(id: string): Promise<Event | null> {
  const event = await eventsApiService.getEventById(id);
  return event ? applyEffectiveOccurrence(event, Date.now(), false) : null;
}
