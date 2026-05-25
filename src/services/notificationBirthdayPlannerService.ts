import { contactsService } from '@/services/contactsService';
import type { BirthdayOccurrence, CommunityContact, ContactSource, LocalIphoneContact } from '@/types/contact';
import type {
  NotificationScheduleBuildInput,
  NotificationScheduleItem,
  NotificationScheduleMetadata,
  NotificationSource,
} from '@/types/notification';
import { DEFAULT_NOTIFICATION_PREFERENCES } from '@/types/profile';

type BirthdayRelatedEntityType = 'community_contact' | 'iphone_contact';

export type BirthdayReminderSource = {
  birthday: BirthdayOccurrence;
  contactSource: ContactSource;
  notificationSource: NotificationSource;
  relatedEntityId: string | null;
  relatedEntityType: BirthdayRelatedEntityType | null;
};

export type NormalizeBirthdayReminderSourcesInput = Pick<
  NotificationScheduleBuildInput,
  'communityContacts' | 'localContacts' | 'now'
> & {
  limit?: number;
};

export type BuildBirthdayNotificationCandidateInput = Pick<
  NotificationScheduleBuildInput,
  'preferences' | 'timezone'
> & {
  reminderSource: BirthdayReminderSource;
};

const BIRTHDAY_CANDIDATE_LIMIT = 3;
const DEFAULT_BIRTHDAY_REMINDER_HOUR = DEFAULT_NOTIFICATION_PREFERENCES.birthdaysReminderHour ?? 9;
const NO_CONTACTS_REASON =
  'Birthday reminders require visible community contacts or loaded local iPhone contacts.';
const NO_BIRTHDAY_DATES_REASON =
  'Birthday reminders require visible birthday dates from community contacts or loaded local iPhone contacts.';

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

function parseDateOnly(value: string): Date | null {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const day = Number(match[3]);
  const date = new Date(year, month, day);

  if (date.getFullYear() !== year || date.getMonth() !== month || date.getDate() !== day) {
    return null;
  }

  return date;
}

function getBirthdayReminderHour(input: Pick<NotificationScheduleBuildInput, 'preferences'>): number {
  return input.preferences?.birthdaysReminderHour ?? DEFAULT_BIRTHDAY_REMINDER_HOUR;
}

function getBirthdayReminderAt(nextDateGregorian: string, reminderHour: number): Date | null {
  const date = parseDateOnly(nextDateGregorian);
  if (!date) return null;

  date.setHours(reminderHour, 0, 0, 0);
  return date;
}

function normalizeNotificationSource(source: ContactSource): NotificationSource {
  if (source === 'community') return 'community_contacts';
  if (source === 'iphone') return 'iphone_contacts';
  return 'unknown';
}

function normalizeRelatedEntityType(source: ContactSource): BirthdayRelatedEntityType | null {
  if (source === 'community') return 'community_contact';
  if (source === 'iphone') return 'iphone_contact';
  return null;
}

function createNeedsDataItem(
  input: NotificationScheduleBuildInput,
  reason: string,
): NotificationScheduleItem {
  return {
    id: 'notification-schedule-preview:birthdays:needs_data',
    body: reason,
    category: 'birthdays',
    deliveryKind: 'local',
    metadata: {
      privacySafe: true,
    },
    reason,
    relatedEntityId: null,
    relatedEntityType: null,
    source: 'unknown',
    status: 'needs_data',
    timezone: input.timezone?.trim() || null,
    title: 'День рождения',
    triggerAt: null,
  };
}

function buildBirthdayBody(birthday: BirthdayOccurrence) {
  const when = birthday.daysUntil === 0 ? 'сегодня' : birthday.when;

  return `У ${birthday.displayName} день рождения ${when}.`;
}

function buildBirthdayMetadata(
  reminderSource: BirthdayReminderSource,
  reminderHour: number,
): NotificationScheduleMetadata {
  const { birthday, contactSource } = reminderSource;

  return {
    contactSource,
    daysUntil: birthday.daysUntil,
    displayName: birthday.displayName,
    gregorianDate: birthday.birthDateGregorian,
    hebrewDateLabel: birthday.nextDateHebrew.label,
    nextGregorianDate: birthday.nextDateGregorian,
    privacySafe: true,
    reminderHour,
  };
}

export function normalizeBirthdayReminderSources({
  communityContacts = [],
  limit = BIRTHDAY_CANDIDATE_LIMIT,
  localContacts = [],
  now,
}: NormalizeBirthdayReminderSourcesInput = {}): BirthdayReminderSource[] {
  return contactsService
    .getUpcomingBirthdays({
      communityContacts: Array.from(communityContacts) as CommunityContact[],
      fromDate: parseNow(now),
      limit,
      localContacts: Array.from(localContacts) as LocalIphoneContact[],
    })
    .map((birthday) => ({
      birthday,
      contactSource: birthday.source,
      notificationSource: normalizeNotificationSource(birthday.source),
      relatedEntityId: birthday.contactId || null,
      relatedEntityType: normalizeRelatedEntityType(birthday.source),
    }));
}

export function buildBirthdayNotificationCandidate({
  preferences,
  reminderSource,
  timezone,
}: BuildBirthdayNotificationCandidateInput): NotificationScheduleItem | null {
  const reminderHour = getBirthdayReminderHour({ preferences });
  const triggerAt = getBirthdayReminderAt(reminderSource.birthday.nextDateGregorian, reminderHour);
  if (!triggerAt) return null;

  return {
    id: `notification-schedule-preview:birthdays:candidate:${reminderSource.birthday.contactId}:${reminderSource.birthday.nextDateGregorian}`,
    body: buildBirthdayBody(reminderSource.birthday),
    category: 'birthdays',
    deliveryKind: 'local',
    metadata: buildBirthdayMetadata(reminderSource, reminderHour),
    reason: null,
    relatedEntityId: reminderSource.relatedEntityId,
    relatedEntityType: reminderSource.relatedEntityType,
    source: reminderSource.notificationSource,
    status: 'candidate',
    timezone: timezone?.trim() || null,
    title: 'День рождения',
    triggerAt: triggerAt.toISOString(),
  };
}

export function buildBirthdayNotificationCandidates(
  input: NotificationScheduleBuildInput,
): NotificationScheduleItem[] {
  const communityContacts = input.communityContacts ?? [];
  const localContacts = input.localContacts ?? [];

  if (communityContacts.length === 0 && localContacts.length === 0) {
    return [createNeedsDataItem(input, NO_CONTACTS_REASON)];
  }

  const candidates = normalizeBirthdayReminderSources({
    communityContacts,
    limit: BIRTHDAY_CANDIDATE_LIMIT,
    localContacts,
    now: input.now,
  })
    .map((reminderSource) => buildBirthdayNotificationCandidate({
      reminderSource,
      preferences: input.preferences,
      timezone: input.timezone,
    }))
    .filter((item): item is NotificationScheduleItem => Boolean(item));

  return candidates.length > 0 ? candidates : [createNeedsDataItem(input, NO_BIRTHDAY_DATES_REASON)];
}
