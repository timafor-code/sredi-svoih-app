// Shared v1 dedupe contract types for admin event import.
//
// Single source of truth for the shape of:
//   event_import_items.raw_payload.importReview.dedupe
//
// See docs/admin-import-dedupe-contract.md.
//
// Type-only module: it exports types only, has no runtime code, and is NOT
// wired into the importer, Edge Function, or UI. Keep it in sync with the
// dedupe contract doc. Both the current CLI importer
// (scripts/importWebsiteEvents.mjs) and the future API import worker are
// expected to write this same shape; the review queue reads it from
// raw_payload.importReview.dedupe rather than from table status columns.
//
// Boundary (do not change as part of this contract):
//   - Do not extend event_import_items.status (stays: new | linked | ignored | error).
//   - Do not extend event_import_runs.status (stays: started | success | failed).
//   - Dedupe state lives only in raw_payload.importReview.dedupe.

/** Allowed dedupe status values. Dedupe state in JSON, NOT a table status. */
export type ImportDedupeStatus =
  | 'new'
  | 'duplicate'
  | 'possible_duplicate'
  | 'updated_existing'
  | 'linked_existing'
  | 'manual_override_skipped'
  | 'error';

/** Allowed signals describing how a match was found. */
export type ImportDedupeMatchedBy =
  | 'source_external_id'
  | 'canonical_url'
  | 'title_starts_at'
  | 'content_hash'
  | 'linked_event_id';

/** v1 dedupe contract stored at raw_payload.importReview.dedupe. */
export interface ImportDedupeV1 {
  /** Contract version. Always 1 for this contract. */
  version: 1;
  /** Outcome of the dedupe check for this item. */
  status: ImportDedupeStatus;
  /** Human-readable explanation of the chosen status. */
  reason: string;
  /** Signals by which a match was found. Empty array when status is "new". */
  matchedBy: ImportDedupeMatchedBy[];
  /** Matched existing events.id, or null when no event matched. */
  matchedEventId: string | null;
  /** Matched existing event_import_items.id, or null when none matched. */
  matchedImportItemId: string | null;
  /** True when the matched event is protected by events.manual_override. */
  manualOverride: boolean;
  /** Stable hash of normalized card content. */
  contentHash: string | null;
  /** Normalized canonical source URL. */
  canonicalSourceUrl: string | null;
  /** Stable external source key (slug for website scrape). */
  sourceExternalId: string | null;
  /** ISO 8601 (UTC) timestamp of when the dedupe check ran. */
  checkedAt: string;
}
