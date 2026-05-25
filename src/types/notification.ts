import type { Location } from '@hebcal/core';

import type { CommunityContact, LocalIphoneContact } from './contact';
import type { Event, EventItem, EventRegistration } from './event';
import type { ProfileNotificationPreferences } from './profile';

export const NOTIFICATION_CATEGORIES = [
  'prayers',
  'shabbat',
  'holidays',
  'candles',
  'events',
  'birthdays',
  'weekly',
  'news',
] as const;

export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];

export type NotificationSource =
  | 'hebcal'
  | 'community_contacts'
  | 'iphone_contacts'
  | 'events'
  | 'registrations'
  | 'manual'
  | 'unknown';

export type NotificationDeliveryKind = 'local' | 'remote_future';

export type NotificationScheduleStatus =
  | 'candidate'
  | 'disabled_by_preferences'
  | 'unsupported_in_this_pr'
  | 'needs_data'
  | 'skipped';

export type NotificationScheduleMetadata = Record<string, unknown>;

export type NotificationScheduleItem = {
  id: string;
  category: NotificationCategory;
  source: NotificationSource;
  deliveryKind: NotificationDeliveryKind;
  status: NotificationScheduleStatus;
  title: string;
  body: string;
  triggerAt: string | null;
  timezone: string | null;
  relatedEntityType: string | null;
  relatedEntityId: string | null;
  reason: string | null;
  metadata?: NotificationScheduleMetadata;
};

export type NotificationScheduleBuildInput = {
  city?: string | null;
  communityContacts?: readonly CommunityContact[];
  events?: readonly (Event | EventItem)[];
  location?: Location | null;
  localContacts?: readonly LocalIphoneContact[];
  myRegistrations?: readonly EventRegistration[];
  now?: string | Date;
  preferences?: ProfileNotificationPreferences | null;
  timezone?: string | null;
};

export type NotificationScheduleBuildResult = {
  items: NotificationScheduleItem[];
  enabledCategoryCount: number;
  disabledCategoryCount: number;
  candidateCount: number;
  unsupportedCount: number;
  needsDataCount: number;
  skippedCount: number;
};
