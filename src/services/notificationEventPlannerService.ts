import { isRecurringEventKind } from '@/lib/eventTime';
import {
  getRegistrationTimezone,
  isRegistrationUpcomingOrCurrent,
} from '@/lib/registrationGroups';
import type { Event, EventItem, EventRegistration } from '@/types/event';
import type {
  NotificationScheduleBuildInput,
  NotificationScheduleItem,
  NotificationScheduleMetadata,
} from '@/types/notification';

type EventReminderEvent = Event | EventItem;

export type EventReminderSource = {
  event: EventReminderEvent | undefined;
  eventStartsAt: Date;
  eventStartsAtIso: string;
  eventTitle: string;
  occurrenceId: string | null;
  registration: EventRegistration;
  reminderOffsetHours: number;
  timezone: string | null;
  triggerAt: Date;
};

export type NormalizeEventReminderSourcesInput = Pick<
  NotificationScheduleBuildInput,
  'events' | 'myRegistrations' | 'now'
> & {
  limit?: number;
};

export type BuildEventNotificationCandidateInput = Pick<
  NotificationScheduleBuildInput,
  'timezone'
> & {
  reminderSource: EventReminderSource;
};

const EVENT_CANDIDATE_LIMIT = 3;
const HOUR_MS = 60 * 60 * 1000;
const PRIMARY_REMINDER_OFFSET_HOURS = 24;
const FALLBACK_REMINDER_OFFSET_HOURS = 2;
const NO_REGISTRATIONS_REASON = 'Event reminders require loaded active registrations.';
const NO_EVENT_REMINDERS_REASON =
  'Event reminders require upcoming active registrations with future reminder windows.';

function isValidDate(value: Date | null | undefined): value is Date {
  return value instanceof Date && Number.isFinite(value.getTime());
}

function parseNow(value: NotificationScheduleBuildInput['now']): Date {
  if (value instanceof Date && isValidDate(value)) {
    return value;
  }

  if (typeof value === 'string' && value.trim()) {
    const parsed = new Date(value);

    if (isValidDate(parsed)) {
      return parsed;
    }
  }

  return new Date();
}

function parseDate(value: string | null | undefined): Date | null {
  if (!value) {
    return null;
  }

  const date = new Date(value);

  return isValidDate(date) ? date : null;
}

function normalizeTimezone(value: string | null | undefined): string | null {
  return value?.trim() || null;
}

function buildEventIndex(events: readonly EventReminderEvent[] = []): Map<string, EventReminderEvent> {
  return new Map(events.map((event) => [event.id, event]));
}

function getRegistrationEvent(
  registration: EventRegistration,
  eventsById: Map<string, EventReminderEvent>,
): EventReminderEvent | undefined {
  return registration.event ?? eventsById.get(registration.eventId);
}

function canUseEventForReminder(event: EventReminderEvent | undefined): boolean {
  return event?.status !== 'cancelled' && event?.status !== 'archived';
}

function hasOccurrenceModel(event: EventReminderEvent | undefined): boolean {
  return Boolean(
    event?.hasOccurrences === true
    || event?.nextOccurrence
    || isRecurringEventKind(event?.eventKind)
    || event?.isPermanent === true,
  );
}

function getOccurrenceStartsAt(
  registration: EventRegistration,
  event: EventReminderEvent | undefined,
): string | null {
  if (!registration.occurrenceId) {
    return null;
  }

  if (registration.occurrence?.startsAt) {
    return registration.occurrence.startsAt;
  }

  if (event?.nextOccurrence?.id === registration.occurrenceId) {
    return event.effectiveStartsAt ?? event.nextOccurrence.startsAt;
  }

  return null;
}

function getEventLevelStartsAt(
  registration: EventRegistration,
  event: EventReminderEvent | undefined,
): string | null {
  if (registration.occurrenceId || hasOccurrenceModel(event)) {
    return null;
  }

  return event?.effectiveStartsAt
    ?? event?.startsAt
    ?? registration.event?.effectiveStartsAt
    ?? registration.event?.startsAt
    ?? null;
}

function getReminderStartsAt(
  registration: EventRegistration,
  event: EventReminderEvent | undefined,
): string | null {
  return getOccurrenceStartsAt(registration, event) ?? getEventLevelStartsAt(registration, event);
}

function getReminderTriggerAt(eventStartsAt: Date, now: Date): { offsetHours: number; triggerAt: Date } | null {
  const primaryTriggerAt = new Date(eventStartsAt.getTime() - PRIMARY_REMINDER_OFFSET_HOURS * HOUR_MS);

  if (primaryTriggerAt.getTime() > now.getTime()) {
    return {
      offsetHours: PRIMARY_REMINDER_OFFSET_HOURS,
      triggerAt: primaryTriggerAt,
    };
  }

  const fallbackTriggerAt = new Date(eventStartsAt.getTime() - FALLBACK_REMINDER_OFFSET_HOURS * HOUR_MS);

  if (fallbackTriggerAt.getTime() > now.getTime()) {
    return {
      offsetHours: FALLBACK_REMINDER_OFFSET_HOURS,
      triggerAt: fallbackTriggerAt,
    };
  }

  return null;
}

function getEventTitle(registration: EventRegistration, event: EventReminderEvent | undefined): string {
  return event?.title ?? registration.event?.title ?? 'Событие';
}

function formatEventReminderDateTime(date: Date, timezone: string | null): string {
  const options: Intl.DateTimeFormatOptions = {
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    month: 'short',
  };

  if (timezone) {
    options.timeZone = timezone;
  }

  try {
    return new Intl.DateTimeFormat('ru-RU', options).format(date);
  } catch {
    delete options.timeZone;
    return new Intl.DateTimeFormat('ru-RU', options).format(date);
  }
}

function createNeedsDataItem(
  input: NotificationScheduleBuildInput,
  reason: string,
): NotificationScheduleItem {
  return {
    id: 'notification-schedule-preview:events:needs_data',
    body: reason,
    category: 'events',
    deliveryKind: 'local',
    metadata: {
      privacySafe: true,
    },
    reason,
    relatedEntityId: null,
    relatedEntityType: null,
    source: 'registrations',
    status: 'needs_data',
    timezone: input.timezone?.trim() || null,
    title: 'Напоминание о событии',
    triggerAt: null,
  };
}

function buildEventMetadata(reminderSource: EventReminderSource): NotificationScheduleMetadata {
  const metadata: NotificationScheduleMetadata = {
    eventId: reminderSource.registration.eventId,
    eventStartsAt: reminderSource.eventStartsAtIso,
    eventTitle: reminderSource.eventTitle,
    privacySafe: true,
    registrationId: reminderSource.registration.id,
    reminderOffsetHours: reminderSource.reminderOffsetHours,
  };

  if (reminderSource.occurrenceId) {
    metadata.occurrenceId = reminderSource.occurrenceId;
  }

  return metadata;
}

export function normalizeEventReminderSources({
  events = [],
  limit = EVENT_CANDIDATE_LIMIT,
  myRegistrations = [],
  now,
}: NormalizeEventReminderSourcesInput = {}): EventReminderSource[] {
  const nowDate = parseNow(now);
  const nowTime = nowDate.getTime();
  const eventsById = buildEventIndex(events);

  return Array.from(myRegistrations)
    .filter((registration) => isRegistrationUpcomingOrCurrent(registration, nowTime))
    .map((registration) => {
      const event = getRegistrationEvent(registration, eventsById);

      if (!canUseEventForReminder(event)) {
        return null;
      }

      const startsAt = parseDate(getReminderStartsAt(registration, event));

      if (!startsAt) {
        return null;
      }

      const reminder = getReminderTriggerAt(startsAt, nowDate);

      if (!reminder) {
        return null;
      }

      return {
        event,
        eventStartsAt: startsAt,
        eventStartsAtIso: startsAt.toISOString(),
        eventTitle: getEventTitle(registration, event),
        occurrenceId: registration.occurrenceId,
        registration,
        reminderOffsetHours: reminder.offsetHours,
        timezone: normalizeTimezone(getRegistrationTimezone(registration) ?? event?.timezone),
        triggerAt: reminder.triggerAt,
      };
    })
    .filter((item): item is EventReminderSource => Boolean(item))
    .sort((first, second) => {
      const startsAtDiff = first.eventStartsAt.getTime() - second.eventStartsAt.getTime();

      if (startsAtDiff !== 0) {
        return startsAtDiff;
      }

      return first.registration.id.localeCompare(second.registration.id);
    })
    .slice(0, limit);
}

export function buildEventNotificationCandidate({
  reminderSource,
  timezone,
}: BuildEventNotificationCandidateInput): NotificationScheduleItem {
  const itemTimezone = reminderSource.timezone ?? timezone?.trim() ?? null;
  const startsAtLabel = formatEventReminderDateTime(reminderSource.eventStartsAt, itemTimezone);

  return {
    id: `notification-schedule-preview:events:candidate:${reminderSource.registration.id}:${reminderSource.reminderOffsetHours}`,
    body: `Скоро: ${reminderSource.eventTitle}, ${startsAtLabel}.`,
    category: 'events',
    deliveryKind: 'local',
    metadata: buildEventMetadata(reminderSource),
    reason: null,
    relatedEntityId: reminderSource.registration.id,
    relatedEntityType: 'event_registration',
    source: 'registrations',
    status: 'candidate',
    timezone: itemTimezone,
    title: 'Напоминание о событии',
    triggerAt: reminderSource.triggerAt.toISOString(),
  };
}

export function buildEventNotificationCandidates(
  input: NotificationScheduleBuildInput,
): NotificationScheduleItem[] {
  const registrations = input.myRegistrations ?? [];

  if (registrations.length === 0) {
    return [createNeedsDataItem(input, NO_REGISTRATIONS_REASON)];
  }

  const candidates = normalizeEventReminderSources({
    events: input.events,
    limit: EVENT_CANDIDATE_LIMIT,
    myRegistrations: registrations,
    now: input.now,
  }).map((reminderSource) => buildEventNotificationCandidate({
    reminderSource,
    timezone: input.timezone,
  }));

  return candidates.length > 0 ? candidates : [createNeedsDataItem(input, NO_EVENT_REMINDERS_REASON)];
}
