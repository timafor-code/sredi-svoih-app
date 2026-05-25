import { CandleLightingEvent, HebrewCalendar, flags } from '@hebcal/core';
import type { Location } from '@hebcal/core';

import { addDays, formatRuTime, formatRuWeekdayDayMonth } from '@/lib/dates';
import { getHebrewDate, getHebrewDateLabel, getUpcomingHoliday, getWeeklyParsha } from '@/lib/hebcal';
import {
  FALLBACK_ZMANIM_CITY,
  getDailyZmanim,
  getHebcalLocation,
  getPrayerWindows,
} from '@/lib/zmanim';
import type {
  NotificationCategory,
  NotificationScheduleBuildInput,
  NotificationScheduleItem,
  NotificationScheduleMetadata,
  NotificationScheduleStatus,
} from '@/types/notification';

type HebcalNotificationCategory = Extract<
  NotificationCategory,
  'candles' | 'holidays' | 'prayers' | 'shabbat' | 'weekly'
>;

type HebcalPlanningContext = {
  city: string;
  location: Location;
  now: Date;
  timezone: string;
};

type ScheduleItemDraft = {
  body: string;
  category: HebcalNotificationCategory;
  metadata?: NotificationScheduleMetadata;
  reason: string | null;
  status: NotificationScheduleStatus;
  title: string;
  triggerAt: Date | null;
};

const HEBCAL_NOTIFICATION_CATEGORIES: readonly HebcalNotificationCategory[] = [
  'prayers',
  'shabbat',
  'holidays',
  'candles',
  'weekly',
];

const CANDLE_REMINDER_OFFSET_MINUTES = 60;
const PRE_SHABBAT_REMINDER_OFFSET_HOURS = 8;
const HOUR_MS = 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;
const CANDLE_LOOKAHEAD_DAYS = 60;
const HOLIDAY_REMINDER_HOUR = 9;
const CANDLE_EVENT_GRACE_MS = 60 * 1000;

export function isHebcalNotificationCategory(
  category: NotificationCategory,
): category is HebcalNotificationCategory {
  return (HEBCAL_NOTIFICATION_CATEGORIES as readonly NotificationCategory[]).includes(category);
}

function isValidDate(value: Date | null | undefined): value is Date {
  return value instanceof Date && Number.isFinite(value.getTime());
}

function parseNow(value: NotificationScheduleBuildInput['now']) {
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

function resolvePlanningContext(input: NotificationScheduleBuildInput): HebcalPlanningContext {
  const now = parseNow(input.now);
  const city = input.city?.trim() || input.location?.getShortName() || FALLBACK_ZMANIM_CITY;
  const location = input.location ?? getHebcalLocation(city);
  const timezone = input.timezone?.trim() || location.getTzid();

  return {
    city,
    location,
    now,
    timezone,
  };
}

function buildMetadata(
  context: HebcalPlanningContext,
  metadata?: NotificationScheduleMetadata,
): NotificationScheduleMetadata {
  return {
    city: context.city,
    hebcalLocationName: context.location.getName(),
    timezone: context.timezone,
    ...metadata,
  };
}

function createHebcalScheduleItem(
  context: HebcalPlanningContext,
  draft: ScheduleItemDraft,
): NotificationScheduleItem {
  const triggerAt = draft.triggerAt?.toISOString() ?? null;

  return {
    id: triggerAt
      ? `notification-schedule-preview:${draft.category}:candidate:${triggerAt}`
      : `notification-schedule-preview:${draft.category}:${draft.status}`,
    body: draft.body,
    category: draft.category,
    deliveryKind: 'local',
    metadata: buildMetadata(context, draft.metadata),
    reason: draft.reason,
    relatedEntityId: null,
    relatedEntityType: null,
    source: 'hebcal',
    status: draft.status,
    timezone: context.timezone,
    title: draft.title,
    triggerAt,
  };
}

function createNeedsDataItem(
  context: HebcalPlanningContext,
  category: HebcalNotificationCategory,
  title: string,
  reason: string,
): NotificationScheduleItem {
  return createHebcalScheduleItem(context, {
    body: reason,
    category,
    reason,
    status: 'needs_data',
    title,
    triggerAt: null,
  });
}

function subtractMinutes(date: Date, minutes: number) {
  return new Date(date.getTime() - minutes * MINUTE_MS);
}

function subtractHours(date: Date, hours: number) {
  return new Date(date.getTime() - hours * HOUR_MS);
}

function isSameZonedDay(left: Date, right: Date, timezone: string) {
  return left.toLocaleDateString('en-CA', { timeZone: timezone })
    === right.toLocaleDateString('en-CA', { timeZone: timezone });
}

function formatShortDateTime(date: Date, timezone: string) {
  return `${formatRuWeekdayDayMonth(date, timezone)} в ${formatRuTime(date, timezone)}`;
}

function getCandleLightingEvents(context: HebcalPlanningContext) {
  return HebrewCalendar.calendar({
    candlelighting: true,
    end: addDays(context.now, CANDLE_LOOKAHEAD_DAYS),
    havdalahMins: 42,
    location: context.location,
    start: context.now,
  }).filter((event): event is CandleLightingEvent => {
    return event instanceof CandleLightingEvent
      && event.eventTime.getTime() >= context.now.getTime() - CANDLE_EVENT_GRACE_MS;
  });
}

function isCandleLightingAtTzeis(event: CandleLightingEvent) {
  return (event.getFlags() & flags.LIGHT_CANDLES_TZEIS) !== 0;
}

function isFridayCandleLighting(event: CandleLightingEvent) {
  return event.getDate().getDay() === 5;
}

function findCandleLightingEvent(
  context: HebcalPlanningContext,
  options: {
    fridayOnly?: boolean;
    offsetMinutes?: number;
    skipTzeisLighting?: boolean;
  } = {},
) {
  const offsetMinutes = options.offsetMinutes ?? CANDLE_REMINDER_OFFSET_MINUTES;

  return getCandleLightingEvents(context).find((event) => {
    if (options.skipTzeisLighting !== false && isCandleLightingAtTzeis(event)) {
      return false;
    }

    if (options.fridayOnly && !isFridayCandleLighting(event)) {
      return false;
    }

    return subtractMinutes(event.eventTime, offsetMinutes).getTime() > context.now.getTime();
  }) ?? null;
}

export function buildCandleLightingCandidate(
  input: NotificationScheduleBuildInput,
): NotificationScheduleItem {
  const context = resolvePlanningContext(input);
  const event = findCandleLightingEvent(context, {
    offsetMinutes: CANDLE_REMINDER_OFFSET_MINUTES,
    skipTzeisLighting: true,
  });

  if (!event) {
    return createNeedsDataItem(
      context,
      'candles',
      'Зажигание свечей',
      'No safe upcoming candle lighting reminder was found for the selected city and timezone.',
    );
  }

  const triggerAt = subtractMinutes(event.eventTime, CANDLE_REMINDER_OFFSET_MINUTES);
  const eventDay = isSameZonedDay(event.eventTime, context.now, context.timezone)
    ? 'Сегодня'
    : formatRuWeekdayDayMonth(event.eventTime, context.timezone);

  return createHebcalScheduleItem(context, {
    body: `${eventDay} зажигание свечей в ${event.eventTimeStr}.`,
    category: 'candles',
    metadata: {
      candleLightingAt: event.eventTime.toISOString(),
      hebrewDateRu: getHebrewDateLabel(event.getDate()),
      reminderOffsetMinutes: CANDLE_REMINDER_OFFSET_MINUTES,
      skipsLightingAtTzeis: true,
    },
    reason: null,
    status: 'candidate',
    title: 'Зажигание свечей',
    triggerAt,
  });
}

export function buildShabbatCandidate(
  input: NotificationScheduleBuildInput,
): NotificationScheduleItem {
  const context = resolvePlanningContext(input);
  const event = findCandleLightingEvent(context, {
    fridayOnly: true,
    offsetMinutes: PRE_SHABBAT_REMINDER_OFFSET_HOURS * 60,
    skipTzeisLighting: true,
  });

  if (!event) {
    return createNeedsDataItem(
      context,
      'shabbat',
      'Шаббат',
      'No upcoming Friday candle lighting time was found for the selected city and timezone.',
    );
  }

  const triggerAt = subtractHours(event.eventTime, PRE_SHABBAT_REMINDER_OFFSET_HOURS);

  return createHebcalScheduleItem(context, {
    body: `Подготовка к Шаббату: свечи ${formatShortDateTime(event.eventTime, context.timezone)}.`,
    category: 'shabbat',
    metadata: {
      candleLightingAt: event.eventTime.toISOString(),
      hebrewDateRu: getHebrewDateLabel(event.getDate()),
      reminderOffsetHours: PRE_SHABBAT_REMINDER_OFFSET_HOURS,
    },
    reason: null,
    status: 'candidate',
    title: 'Шаббат',
    triggerAt,
  });
}

function setLocalReminderTime(date: Date, hour: number) {
  const reminderAt = new Date(date);
  reminderAt.setHours(hour, 0, 0, 0);
  return reminderAt;
}

function moveSaturdayReminderToFriday(reminderAt: Date) {
  if (reminderAt.getDay() !== 6) {
    return reminderAt;
  }

  return setLocalReminderTime(addDays(reminderAt, -1), HOLIDAY_REMINDER_HOUR);
}

function getHolidayReminderAt(holidayDate: Date) {
  const dayBefore = setLocalReminderTime(addDays(holidayDate, -1), HOLIDAY_REMINDER_HOUR);
  return moveSaturdayReminderToFriday(dayBefore);
}

export function buildHolidayCandidate(
  input: NotificationScheduleBuildInput,
): NotificationScheduleItem {
  const context = resolvePlanningContext(input);
  let cursor = context.now;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const holiday = getUpcomingHoliday(
      getHebrewDate(cursor, context.location),
      context.location.getIsrael(),
    );

    if (!holiday) {
      break;
    }

    const triggerAt = getHolidayReminderAt(holiday.date);

    if (triggerAt.getTime() > context.now.getTime()) {
      return createHebcalScheduleItem(context, {
        body: `Ближайшая значимая дата: ${holiday.nameRu}, ${holiday.hebrewDateRu}.`,
        category: 'holidays',
        metadata: {
          holidayAt: holiday.date.toISOString(),
          holidayNameEn: holiday.nameEn,
          holidayNameHe: holiday.nameHe,
          holidayNameRu: holiday.nameRu,
        },
        reason: null,
        status: 'candidate',
        title: 'Праздник',
        triggerAt,
      });
    }

    cursor = addDays(holiday.date, 1);
  }

  return createNeedsDataItem(
    context,
    'holidays',
    'Праздники',
    'No upcoming holiday reminder could be calculated with the available Hebcal data.',
  );
}

export function buildWeeklyParshaCandidate(
  input: NotificationScheduleBuildInput,
): NotificationScheduleItem {
  const context = resolvePlanningContext(input);
  const events = getCandleLightingEvents(context).filter((event) => {
    if (isCandleLightingAtTzeis(event) || !isFridayCandleLighting(event)) {
      return false;
    }

    return subtractHours(event.eventTime, PRE_SHABBAT_REMINDER_OFFSET_HOURS).getTime() > context.now.getTime();
  });

  for (const event of events) {
    const parsha = getWeeklyParsha(getHebrewDate(event.eventTime, context.location), context.location.getIsrael());

    if (!parsha) {
      continue;
    }

    const triggerAt = subtractHours(event.eventTime, PRE_SHABBAT_REMINDER_OFFSET_HOURS);

    return createHebcalScheduleItem(context, {
      body: `Недельная глава: ${parsha.ru}.`,
      category: 'weekly',
      metadata: {
        candleLightingAt: event.eventTime.toISOString(),
        parshaDate: parsha.date.toISOString(),
        parshaEn: parsha.en,
        parshaHe: parsha.he,
        parshaRu: parsha.ru,
        reminderOffsetHours: PRE_SHABBAT_REMINDER_OFFSET_HOURS,
      },
      reason: null,
      status: 'candidate',
      title: 'Недельная глава',
      triggerAt,
    });
  }

  return createNeedsDataItem(
    context,
    'weekly',
    'Недельная глава',
    'No upcoming weekly parsha reminder could be calculated with the available Hebcal data.',
  );
}

export function buildPrayerCandidate(
  input: NotificationScheduleBuildInput,
): NotificationScheduleItem {
  const context = resolvePlanningContext(input);
  const today = getDailyZmanim({ city: context.city, date: context.now });
  const futureWindows = getPrayerWindows(today, context.now)
    .filter((window) => isValidDate(window.start) && window.start.getTime() > context.now.getTime())
    .sort((left, right) => left.start.getTime() - right.start.getTime());
  const nextWindow = futureWindows[0];

  if (nextWindow) {
    return createHebcalScheduleItem(context, {
      body: `Ближайшая молитва: ${nextWindow.title} в ${formatRuTime(nextWindow.start, context.timezone)}.`,
      category: 'prayers',
      metadata: {
        prayerWindowId: nextWindow.id,
        prayerWindowTitle: nextWindow.title,
      },
      reason: null,
      status: 'candidate',
      title: 'Молитва',
      triggerAt: nextWindow.start,
    });
  }

  const tomorrow = addDays(context.now, 1);
  const tomorrowDaily = getDailyZmanim({ city: context.city, date: tomorrow });
  const tomorrowWindow = getPrayerWindows(tomorrowDaily, tomorrow)
    .filter((window) => isValidDate(window.start))
    .sort((left, right) => left.start.getTime() - right.start.getTime())[0];

  if (tomorrowWindow) {
    return createHebcalScheduleItem(context, {
      body: `Ближайшая молитва: ${tomorrowWindow.title} в ${formatRuTime(tomorrowWindow.start, context.timezone)}.`,
      category: 'prayers',
      metadata: {
        prayerWindowId: tomorrowWindow.id,
        prayerWindowTitle: tomorrowWindow.title,
      },
      reason: null,
      status: 'candidate',
      title: 'Молитва',
      triggerAt: tomorrowWindow.start,
    });
  }

  return createNeedsDataItem(
    context,
    'prayers',
    'Молитва',
    'Prayer reminders require dedicated prayer window planner in a later PR.',
  );
}

export function buildHebcalNotificationCandidate(
  category: HebcalNotificationCategory,
  input: NotificationScheduleBuildInput,
): NotificationScheduleItem {
  switch (category) {
    case 'candles':
      return buildCandleLightingCandidate(input);
    case 'holidays':
      return buildHolidayCandidate(input);
    case 'prayers':
      return buildPrayerCandidate(input);
    case 'shabbat':
      return buildShabbatCandidate(input);
    case 'weekly':
      return buildWeeklyParshaCandidate(input);
  }
}

export function buildHebcalNotificationCandidates(
  input: NotificationScheduleBuildInput,
): NotificationScheduleItem[] {
  return HEBCAL_NOTIFICATION_CATEGORIES.map((category) => buildHebcalNotificationCandidate(category, input));
}
