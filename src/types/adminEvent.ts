import type {
  Event,
  EventRegistrationMode,
  EventStatus,
  EventVisibility,
} from './event';

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export type JsonObject = { [key: string]: JsonValue };

export type AdminImportItemStatus = 'new' | 'linked' | 'ignored' | 'error';

export interface AdminImportReview {
  dateConfidence?: string | null;
  dateStatus?: string | null;
  reason?: string | null;
  rawDateText?: string | null;
  rawTimeText?: string | null;
  inferred?: boolean | null;
  assumedYear?: number | null;
  suggestedStartsAt?: string | null;
  parserVersion?: string | null;
  reviewNeeded?: boolean | null;
  needsReview?: boolean | null;
  draftEventCreated?: boolean | null;
  draftEventId?: string | null;
}

export interface AdminImportItem {
  id: string;
  sourceId: string;
  runId: string | null;
  externalId: string | null;
  sourceUrl: string | null;
  rawPayload: JsonValue;
  importReview: AdminImportReview | null;
  parsedTitle: string | null;
  parsedStartsAt: string | null;
  parsedLocation: string | null;
  linkedEventId: string | null;
  status: AdminImportItemStatus | string | null;
  createdAt: string;
  sourceName: string | null;
  communityId: string | null;
}

export interface AdminEventPayload {
  communityId?: string | null;
  title?: string | null;
  subtitle?: string | null;
  shortDescription?: string | null;
  description?: string | null;
  startsAt?: string | null;
  endsAt?: string | null;
  timezone?: string | null;
  locationName?: string | null;
  address?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  imageUrl?: string | null;
  category?: string | null;
  audience?: string | null;
  visibility?: EventVisibility | null;
  status?: EventStatus | null;
  sourceUrl?: string | null;
  sourceExternalId?: string | null;
  registrationMode?: EventRegistrationMode | null;
  registrationUrl?: string | null;
  capacity?: number | null;
  waitlistEnabled?: boolean | null;
  requiresApproval?: boolean | null;
  priceAmount?: number | null;
  priceCurrency?: string | null;
}

export type AdminEventMutationResult = Event;
