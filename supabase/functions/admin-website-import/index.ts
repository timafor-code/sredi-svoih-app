// @ts-nocheck
import {
  jsonResponse,
  preflightResponse,
  requireAdminImportAccess,
} from "../_shared/adminAuth.ts";
import {
  parseWebsiteEventsDryRun,
  toSafeParserError,
} from "../_shared/websiteEventsParser.ts";

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
      message: "mode must be either health or dry-run.",
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

function normalizeMode(value: unknown): "health" | "dry-run" | null {
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

  return null;
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
