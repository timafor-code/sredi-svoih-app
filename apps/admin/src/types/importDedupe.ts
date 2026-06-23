export const ADMIN_IMPORT_DEDUPE_STATUSES = [
  "new",
  "duplicate",
  "possible_duplicate",
  "updated_existing",
  "linked_existing",
  "manual_override_skipped",
  "error",
] as const;

export const ADMIN_IMPORT_DEDUPE_MATCHED_BY = [
  "source_external_id",
  "canonical_url",
  "title_starts_at",
  "content_hash",
  "linked_event_id",
] as const;

export type AdminImportDedupeStatus = (typeof ADMIN_IMPORT_DEDUPE_STATUSES)[number];
export type AdminImportDedupeMatchedBy = (typeof ADMIN_IMPORT_DEDUPE_MATCHED_BY)[number];

export type AdminImportDedupe = {
  version: 1;
  status: AdminImportDedupeStatus;
  reason: string | null;
  matchedBy: AdminImportDedupeMatchedBy[];
  matchedEventId: string | null;
  matchedImportItemId: string | null;
  manualOverride: boolean;
  contentHash: string | null;
  canonicalSourceUrl: string | null;
  sourceExternalId: string | null;
  checkedAt: string | null;
};
