// @ts-nocheck
import {
  jsonResponse,
  preflightResponse,
  requireAdminImportAccess,
} from "../_shared/adminAuth.ts";
import {
  createImportRunClient,
  ImportRunClientError,
  toSafeImportRunError,
} from "../_shared/importRunClient.ts";
import { mirrorEventImageToStorage } from "../_shared/eventImageMirror.ts";
import {
  normalizeDryRunOptions,
  parseWebsiteEventsDryRun,
  toSafeParserError,
} from "../_shared/websiteEventsParser.ts";

const APPLY_REVIEW_ONLY_MODE = "apply_review_only";

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") {
    return preflightResponse(request);
  }

  if (request.method !== "POST") {
    return jsonResponse(request, 405, {
      ok: false,
      code: "method_not_allowed",
      message: "Use POST for admin website import health.",
    });
  }

  const access = await requireAdminImportAccess(request);

  if (!access.ok) {
    return jsonResponse(request, access.status, access.body);
  }

  const bodyResult = await readJsonBody(request);

  if (!bodyResult.ok) {
    return jsonResponse(request, 400, {
      ok: false,
      code: "invalid_json",
      message: bodyResult.message,
    });
  }

  const mode = normalizeMode(bodyResult.body.mode);

  if (!mode) {
    return jsonResponse(request, 400, {
      ok: false,
      code: "invalid_mode",
      message: "mode must be health, dry-run, or apply_review_only.",
    });
  }

  if (mode === "dry-run") {
    try {
      const result = await parseWebsiteEventsDryRun(bodyResult.body);

      return jsonResponse(request, 200, {
        ok: true,
        mode,
        userRole: access.userRole,
        communityId: access.communityId,
        parser: {
          name: result.parserName,
          version: result.parserVersion,
        },
        sourceUrl: result.sourceUrl,
        options: {
          limit: result.options.limit,
          maxLimit: result.options.maxLimit,
          fetchDetails: result.options.fetchDetails,
          detailFetchConcurrency: result.options.detailFetchConcurrency,
          requestTimeoutMs: result.options.requestTimeoutMs,
          overallTimeoutMs: result.options.overallTimeoutMs,
          assumeYear: result.options.assumeYear,
        },
        summary: result.summary,
      });
    } catch (error) {
      const safeError = toSafeParserError(error, "dry_run_failed");

      return jsonResponse(request, statusForParserError(safeError.code), {
        ok: false,
        mode,
        code: safeError.code,
        message: safeError.message,
        parserErrors: [safeError],
      });
    }
  }

  if (mode === APPLY_REVIEW_ONLY_MODE) {
    return await handleApplyReviewOnly(request, bodyResult.body, access);
  }

  return jsonResponse(request, 200, {
    ok: true,
    mode: "health",
    userRole: access.userRole,
    communityId: access.communityId,
  });
});

async function readJsonBody(request: Request) {
  const rawBody = await request.text();

  if (!rawBody.trim()) {
    return { ok: true, body: {} };
  }

  try {
    const parsed = JSON.parse(rawBody);

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {
        ok: false,
        message: "Request body must be a JSON object.",
      };
    }

    return { ok: true, body: parsed };
  } catch {
    return {
      ok: false,
      message: "Request body must be valid JSON.",
    };
  }
}

async function handleApplyReviewOnly(request: Request, body, access) {
  let parserOptions;

  try {
    // Validate sourceUrl and parser options before opening a DB run. The parser
    // re-validates before fetch, but this keeps invalid requests write-free.
    parserOptions = normalizeDryRunOptions(body);
  } catch (error) {
    const safeError = toSafeParserError(error, "apply_review_options_invalid");

    return jsonResponse(request, statusForParserError(safeError.code), {
      ok: false,
      mode: APPLY_REVIEW_ONLY_MODE,
      error: safeError.code,
      message: safeError.message,
      parserErrors: [safeError],
    });
  }

  let importClient;
  let source;

  try {
    importClient = createImportRunClient(request);
    source = await importClient.resolveWebsiteImportSource({
      communityId: access.communityId,
      sourceUrl: parserOptions.sourceUrl,
    });
  } catch (error) {
    const safeError = toSafeImportRunError(error);

    return jsonResponse(request, safeError.status, {
      ok: false,
      mode: APPLY_REVIEW_ONLY_MODE,
      error: safeError.code,
      message: safeError.message,
    });
  }

  let run = null;

  try {
    run = await importClient.beginImportRun(source.sourceId);
  } catch (error) {
    const safeError = toSafeImportRunError(error);

    if (safeError.code === "import_already_running") {
      return jsonResponse(request, 409, {
        ok: false,
        error: "import_already_running",
        message: safeError.message,
      });
    }

    return jsonResponse(request, safeError.status, {
      ok: false,
      mode: APPLY_REVIEW_ONLY_MODE,
      error: safeError.code,
      message: safeError.message,
    });
  }

  let summary = null;

  try {
    const result = await parseWebsiteEventsDryRun(parserOptions);
    summary = createApplySummary(result);

    for (const itemResult of result.items) {
      await mirrorImportItemImage(itemResult, {
        authorization: request.headers.get("authorization")?.trim() ?? null,
        communityId: access.communityId ?? source.communityId,
        requestTimeoutMs: result.options.requestTimeoutMs,
      });

      const payload = buildImportItemPayload(itemResult);
      const upserted = await importClient.upsertImportItem(run.runId, payload);

      summary.itemsWrittenCount += 1;

      if (upserted?.action === "updated") {
        summary.itemsUpdatedCount += 1;
      } else {
        summary.itemsInsertedCount += 1;
      }

      if (payload.status === "error") {
        summary.itemErrorCount += 1;
      } else {
        summary.itemsNewCount += 1;
      }
    }

    const finalized = await importClient.finalizeImportRun(run.runId, {
      status: "success",
      foundCount: summary.foundCount,
      createdCount: summary.itemsInsertedCount,
      updatedCount: summary.itemsUpdatedCount,
      error: summary.itemErrorCount > 0
        ? `Completed with ${summary.itemErrorCount} item error(s).`
        : null,
    });

    return jsonResponse(request, 200, {
      ok: true,
      mode: APPLY_REVIEW_ONLY_MODE,
      userRole: access.userRole,
      communityId: access.communityId,
      source: {
        sourceId: source.sourceId,
        sourceUrl: source.sourceUrl,
      },
      run: {
        runId: finalized?.runId ?? run.runId,
        status: finalized?.status ?? "success",
        startedAt: finalized?.startedAt ?? run.startedAt ?? null,
        finishedAt: finalized?.finishedAt ?? null,
      },
      parser: {
        name: result.parserName,
        version: result.parserVersion,
      },
      sourceUrl: result.sourceUrl,
      options: {
        limit: result.options.limit,
        maxLimit: result.options.maxLimit,
        fetchDetails: result.options.fetchDetails,
        detailFetchConcurrency: result.options.detailFetchConcurrency,
        requestTimeoutMs: result.options.requestTimeoutMs,
        overallTimeoutMs: result.options.overallTimeoutMs,
        assumeYear: result.options.assumeYear,
      },
      summary,
    });
  } catch (error) {
    const safeError = toSafeApplyError(error);
    const finalized = await finalizeRunAsFailed(
      importClient,
      run.runId,
      safeError,
      summary,
    );

    return jsonResponse(request, safeError.status, {
      ok: false,
      mode: APPLY_REVIEW_ONLY_MODE,
      error: safeError.code,
      message: safeError.message,
      runId: run.runId,
      runFinalized: Boolean(finalized),
    });
  }
}

function normalizeMode(
  value: unknown,
): "health" | "dry-run" | "apply_review_only" | null {
  if (value === undefined || value === null || value === "") {
    return "health";
  }

  const mode = String(value).trim().toLowerCase();

  if (mode === "health") {
    return "health";
  }

  if (mode === "dry-run" || mode === "dry_run" || mode === "dryrun") {
    return "dry-run";
  }

  if (
    mode === "apply_review_only" ||
    mode === "apply-review-only" ||
    mode === "applyreviewonly"
  ) {
    return APPLY_REVIEW_ONLY_MODE;
  }

  return null;
}

function createApplySummary(result) {
  const summary = {
    foundCount: result.foundCount,
    requestedCount: result.summary?.requestedCount ?? result.items.length,
    parsedCount: result.parsedCount,
    parserErrorCount: result.errorCount,
    itemErrorCount: 0,
    itemsWrittenCount: 0,
    itemsInsertedCount: 0,
    itemsUpdatedCount: 0,
    itemsNewCount: 0,
    confidentCount: 0,
    partialCount: 0,
    recurringRuleCount: 0,
    noneCount: 0,
    parserErrors: result.summary?.parserErrors ?? [],
  };

  for (const { item } of result.items) {
    if (item.dateConfidence === "confident") {
      summary.confidentCount += 1;
    } else if (item.dateConfidence === "partial") {
      summary.partialCount += 1;
    } else if (item.dateConfidence === "recurring_rule") {
      summary.recurringRuleCount += 1;
    } else {
      summary.noneCount += 1;
    }
  }

  return summary;
}

async function mirrorImportItemImage(result, options = {}) {
  const item = result.item;
  const mirror = await mirrorEventImageToStorage({
    imageUrl: item.imageUrl,
    communityId: options.communityId,
    sourceExternalId: item.sourceExternalId,
    sourceUrl: item.sourceUrl,
    requestTimeoutMs: options.requestTimeoutMs,
    authorization: options.authorization,
  });

  applyImageMirrorMetadata(item, mirror);
}

function applyImageMirrorMetadata(item, mirror) {
  const rawPayload = ensureJsonObject(item.rawPayload);
  const importReview = ensureJsonObject(
    item.importReview ?? rawPayload.importReview,
  );

  importReview.imageMirror = mirror;
  item.importReview = importReview;
  rawPayload.importReview = importReview;
  item.rawPayload = rawPayload;

  if (mirror.status !== "stored" || !mirror.publicUrl) {
    return;
  }

  const originalUrl = mirror.originalUrl ?? item.imageUrl ?? null;
  item.imageUrl = mirror.publicUrl;
  rawPayload.imageUrl = mirror.publicUrl;
  rawPayload.image_url = mirror.publicUrl;

  const detail = ensureJsonObject(rawPayload.detail);
  detail.imageUrl = mirror.publicUrl;
  detail.image_url = mirror.publicUrl;

  if (originalUrl) {
    detail.original_image_url = originalUrl;
  }

  rawPayload.detail = detail;

  const parsed = ensureJsonObject(rawPayload.parsed);
  parsed.imageUrl = mirror.publicUrl;
  parsed.image_url = mirror.publicUrl;
  rawPayload.parsed = parsed;
}

function buildImportItemPayload(result) {
  const item = result.item;
  const rawPayload = cloneJsonObject(item.rawPayload);
  const importReview = cloneJsonObject(
    item.importReview ?? rawPayload.importReview,
  );

  if (Object.keys(importReview).length > 0) {
    rawPayload.importReview = importReview;
  }

  if (result.error) {
    const safeError = toSafeParserError(result.error, "detail_parse_failed");
    rawPayload.import_status = "error";
    rawPayload.import_error = safeError.message;
    rawPayload.parse_error = safeError;
  }

  const dedupeStatus = rawPayload.importReview?.dedupe?.status ?? null;

  return {
    externalId: item.sourceExternalId ?? null,
    sourceUrl: item.sourceUrl ?? null,
    rawPayload,
    parsedTitle: item.title ?? null,
    parsedStartsAt: item.startsAt ?? null,
    parsedLocation: item.parsedLocation ?? null,
    status: result.error || dedupeStatus === "error" ? "error" : "new",
  };
}

function ensureJsonObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value;
}

function cloneJsonObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return { ...value };
}

async function finalizeRunAsFailed(importClient, runId, safeError, summary) {
  try {
    return await importClient.finalizeImportRun(runId, {
      status: "failed",
      error: formatRunError(safeError),
      ...(summary
        ? {
          foundCount: summary.foundCount,
          createdCount: summary.itemsInsertedCount,
          updatedCount: summary.itemsUpdatedCount,
        }
        : {}),
    });
  } catch {
    return null;
  }
}

function toSafeApplyError(error) {
  if (error instanceof ImportRunClientError) {
    return toSafeImportRunError(error);
  }

  const parserError = toSafeParserError(error, "apply_review_only_failed");

  return {
    code: parserError.code,
    message: parserError.message,
    status: statusForParserError(parserError.code),
  };
}

function formatRunError(safeError) {
  return `${safeError.code}: ${safeError.message}`.slice(0, 300);
}

function statusForParserError(code: string): number {
  if (code.startsWith("invalid_")) {
    return 400;
  }

  if (
    code === "http_error" ||
    code === "fetch_failed" ||
    code === "request_timeout" ||
    code === "overall_timeout"
  ) {
    return 502;
  }

  return 500;
}
