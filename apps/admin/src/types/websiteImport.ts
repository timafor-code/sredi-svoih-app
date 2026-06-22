export type AdminWebsiteImportMode = "apply_review_only";

export type AdminWebsiteImportPayload = {
  mode: AdminWebsiteImportMode;
};

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

export type AdminWebsiteImportErrorResponse = {
  ok?: false;
  mode?: AdminWebsiteImportMode | string;
  error?: string | null;
  code?: string | null;
  message?: string | null;
  parserErrors?: AdminWebsiteImportParserError[] | null;
  summary?: AdminWebsiteImportSummary | null;
  runId?: string | null;
  runFinalized?: boolean | null;
  [key: string]: unknown;
};

export type AdminWebsiteImportResponse =
  | AdminWebsiteImportSuccessResponse
  | AdminWebsiteImportErrorResponse;
