export type AdminWebsiteImportMode = "apply_review_only";

export type AdminWebsiteImportParserError = {
  code?: string | null;
  message?: string | null;
  details?: string | null;
  field?: string | null;
  [key: string]: unknown;
};

export type AdminWebsiteImportSummary = {
  foundCount?: number | null;
  requestedCount?: number | null;
  parsedCount?: number | null;
  parserErrorCount?: number | null;
  itemErrorCount?: number | null;
  itemsWrittenCount?: number | null;
  itemsInsertedCount?: number | null;
  itemsUpdatedCount?: number | null;
  itemsNewCount?: number | null;
  dedupeCheckedCount?: number | null;
  itemsSkippedCount?: number | null;
  itemsSkippedExistingImportItemCount?: number | null;
  itemsSkippedExistingEventCount?: number | null;
  itemsLinkedExistingEventCount?: number | null;
  itemsPossibleDuplicateEventCount?: number | null;
  itemsManualOverrideEventCount?: number | null;
  confidentCount?: number | null;
  partialCount?: number | null;
  recurringRuleCount?: number | null;
  noneCount?: number | null;
  parserErrors?: AdminWebsiteImportParserError[] | null;
  [key: string]: unknown;
};

export type AdminWebsiteImportRunInfo = {
  runId?: string | null;
  status?: string | null;
  startedAt?: string | null;
  finishedAt?: string | null;
};

export type AdminWebsiteImportSourceInfo = {
  sourceId?: string | null;
  sourceUrl?: string | null;
};

export type AdminWebsiteImportParserInfo = {
  name?: string | null;
  version?: string | null;
};

export type AdminWebsiteImportSuccessResponse = {
  ok: true;
  mode?: AdminWebsiteImportMode | string;
  userRole?: string | null;
  communityId?: string | null;
  source?: AdminWebsiteImportSourceInfo | null;
  run?: AdminWebsiteImportRunInfo | null;
  parser?: AdminWebsiteImportParserInfo | null;
  sourceUrl?: string | null;
  summary?: AdminWebsiteImportSummary | null;
  [key: string]: unknown;
};

export const ADMIN_IMPORT_RUN_STATUSES = ["started", "success", "failed"] as const;

export type AdminImportRunStatus = (typeof ADMIN_IMPORT_RUN_STATUSES)[number];

export type AdminImportRunHistoryParams = {
  limit?: number;
};

export type AdminApiImportRunResponse = {
  id: string;
  source_id: string;
  community_id: string;
  source_key: string;
  source_title: string | null;
  source_url: string | null;
  mode: string;
  status: string | null;
  started_at: string;
  finished_at: string | null;
  found_count: number | string | null;
  parsed_count: number | string | null;
  created_count: number | string | null;
  updated_count: number | string | null;
  error: string | null;
  summary: Record<string, unknown> | null;
  parser_metadata: Record<string, unknown> | null;
  debug_metadata: Record<string, unknown> | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type AdminImportRun = {
  id: string;
  sourceId: string;
  sourceName: string | null;
  status: AdminImportRunStatus;
  startedAt: string;
  finishedAt: string | null;
  foundCount: number;
  createdCount: number;
  updatedCount: number;
  error: string | null;
  createdAt: string;
};

export type AdminImportRunHistoryResponse = AdminImportRun[];
