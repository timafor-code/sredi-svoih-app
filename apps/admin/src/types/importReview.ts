import type { AdminEvent, AdminEventMutationInput } from "./events";
import type { AdminImportDedupe } from "./importDedupe";

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export type JsonObject = { [key: string]: JsonValue };

export const ADMIN_IMPORT_ITEM_STATUSES = ["new", "linked", "ignored", "error"] as const;
export const ADMIN_IMPORT_DATE_QUALITIES = [
  "confident",
  "partial",
  "recurring_rule",
  "none",
] as const;

export type AdminImportItemStatus = (typeof ADMIN_IMPORT_ITEM_STATUSES)[number];
export type AdminImportDateQuality = (typeof ADMIN_IMPORT_DATE_QUALITIES)[number];

export type AdminImportReviewRow = {
  id: string;
  source_id: string;
  run_id: string | null;
  external_id: string | null;
  source_url: string | null;
  raw_payload: JsonValue | null;
  parsed_title: string | null;
  parsed_starts_at: string | null;
  parsed_location: string | null;
  linked_event_id: string | null;
  status: AdminImportItemStatus | string | null;
  created_at: string;
  source_name: string | null;
  community_id: string | null;
};

export type AdminImportReview = {
  [key: string]: unknown;
  dateConfidence?: AdminImportDateQuality | string | null;
  dateStatus?: string | null;
  reason?: string | null;
  notes?: string | null;
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
  draftSkipReason?: string | null;
  dedupe?: AdminImportDedupe | null;
};

export type AdminImportAdminReview = {
  [key: string]: unknown;
  ignoredAt?: string | null;
  ignoredBy?: string | null;
  ignoreReason?: string | null;
};

export type AdminImportReviewItem = {
  id: string;
  sourceId: string;
  runId: string | null;
  externalId: string | null;
  sourceUrl: string | null;
  parsedTitle: string | null;
  parsedStartsAt: string | null;
  parsedLocation: string | null;
  rawPayload: JsonValue;
  status: AdminImportItemStatus | string | null;
  createdAt: string;
  linkedEventId: string | null;
  importReview: AdminImportReview | null;
  adminReview: AdminImportAdminReview | null;
  sourceName: string | null;
  communityId: string | null;
};

export type AdminPublishImportItemPayload = AdminEventMutationInput & {
  manualOverride?: boolean;
  sourceUrl?: string | null;
};

export type AdminPublishImportItemResult = {
  event: AdminEvent | null;
  importItem: AdminImportReviewItem | null;
  linkedEventId: string | null;
  raw: unknown;
};
