// @ts-nocheck
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.8";
import {
  normalizeSourceUrl,
  WEBSITE_EVENTS_PARSER_NAME,
} from "./websiteEventsParser.ts";

const EVENT_SOURCE_TYPE = "website_scrape";

const KNOWN_IMPORT_ERROR_CODES = new Set([
  "unauthenticated",
  "import_source_not_found",
  "import_source_forbidden",
  "import_already_running",
  "import_mode_unsupported",
  "import_run_not_found",
  "import_run_not_open",
  "import_item_status_invalid",
  "import_item_raw_payload_invalid",
  "import_item_parsed_starts_at_invalid",
  "import_item_linked_event_invalid",
  "import_item_linked_event_forbidden",
  "import_final_status_invalid",
  "import_summary_invalid",
  "import_source_lookup_failed",
  "supabase_env_not_configured",
  "missing_authorization",
]);

export class ImportRunClientError extends Error {
  constructor(code, message, status = 500, options = {}) {
    super(message);
    this.name = "ImportRunClientError";
    this.code = code;
    this.status = status;
    this.cause = options.cause;
  }
}

export function createImportRunClient(request: Request) {
  const authorization = request.headers.get("authorization")?.trim();

  if (!authorization) {
    throw new ImportRunClientError(
      "missing_authorization",
      "Authorization header is required.",
      401,
    );
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")?.trim();
  const supabaseKey =
    Deno.env.get("SUPABASE_ANON_KEY")?.trim() ??
    Deno.env.get("SUPABASE_PUBLISHABLE_KEY")?.trim();

  if (!supabaseUrl || !supabaseKey) {
    throw new ImportRunClientError(
      "supabase_env_not_configured",
      "Supabase URL and anon/publishable key are required.",
      500,
    );
  }

  const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
    global: {
      headers: {
        Authorization: authorization,
      },
    },
  });

  return {
    async resolveWebsiteImportSource(options = {}) {
      return await resolveWebsiteImportSource(supabase, options);
    },
    async beginImportRun(sourceId) {
      return await callRpc(supabase, "admin_begin_import_run", {
        payload: {
          sourceId,
          mode: "apply_review_only",
        },
      });
    },
    async upsertImportItem(runId, payload) {
      return await callRpc(supabase, "admin_upsert_import_item", {
        p_run_id: runId,
        payload,
      });
    },
    async finalizeImportRun(runId, payload) {
      return await callRpc(supabase, "admin_finalize_import_run", {
        p_run_id: runId,
        payload,
      });
    },
  };
}

export function toSafeImportRunError(error, fallbackCode = "import_rpc_failed") {
  if (error instanceof ImportRunClientError) {
    return {
      code: error.code,
      message: error.message,
      status: error.status,
    };
  }

  const code = readImportErrorCode(error, fallbackCode);

  return {
    code,
    message: messageForImportError(code),
    status: statusForImportError(code),
  };
}

async function resolveWebsiteImportSource(supabase, options = {}) {
  let query = supabase
    .from("event_import_sources")
    .select("id, community_id, url, parser_name, source_type, is_active, created_at")
    .eq("parser_name", WEBSITE_EVENTS_PARSER_NAME)
    .eq("source_type", EVENT_SOURCE_TYPE)
    .eq("is_active", true)
    .order("created_at", { ascending: true })
    .limit(20);

  if (options.communityId) {
    query = query.eq("community_id", options.communityId);
  }

  const { data, error } = await query;

  if (error) {
    throw new ImportRunClientError(
      "import_source_lookup_failed",
      "Could not resolve the website import source.",
      500,
      { cause: error },
    );
  }

  const sources = Array.isArray(data) ? data : [];
  const exactSource = options.sourceUrl
    ? sources.find((source) => sourceUrlMatches(source.url, options.sourceUrl))
    : null;
  const source = exactSource ?? sources[0] ?? null;

  if (!source?.id) {
    throw new ImportRunClientError(
      "import_source_not_found",
      "No active website import source is configured for this community.",
      404,
    );
  }

  return {
    sourceId: source.id,
    communityId: source.community_id ?? null,
    sourceUrl: source.url ?? null,
  };
}

async function callRpc(supabase, fnName, args) {
  const { data, error } = await supabase.rpc(fnName, args);

  if (error) {
    const safe = toSafeImportRunError(error);
    throw new ImportRunClientError(safe.code, safe.message, safe.status, {
      cause: error,
    });
  }

  return data;
}

function sourceUrlMatches(value, expected) {
  if (!value || !expected) {
    return false;
  }

  try {
    return normalizeSourceUrl(value) === expected;
  } catch {
    return false;
  }
}

function readImportErrorCode(error, fallbackCode) {
  const candidates = [
    error?.message,
    error?.details,
    error?.hint,
    error?.code,
  ].filter(Boolean);

  for (const candidate of candidates) {
    const text = String(candidate).trim();

    if (KNOWN_IMPORT_ERROR_CODES.has(text)) {
      return text;
    }

    const match = text.match(/\b(?:unauthenticated|import_[a-z0-9_]+)\b/u);

    if (match && KNOWN_IMPORT_ERROR_CODES.has(match[0])) {
      return match[0];
    }
  }

  return fallbackCode;
}

function statusForImportError(code) {
  if (code === "unauthenticated" || code === "missing_authorization") {
    return 401;
  }

  if (
    code === "import_source_forbidden" ||
    code === "import_item_linked_event_forbidden"
  ) {
    return 403;
  }

  if (code === "import_already_running") {
    return 409;
  }

  if (code === "import_source_not_found" || code === "import_run_not_found") {
    return 404;
  }

  if (
    code === "import_mode_unsupported" ||
    code === "import_item_status_invalid" ||
    code === "import_item_raw_payload_invalid" ||
    code === "import_item_parsed_starts_at_invalid" ||
    code === "import_item_linked_event_invalid" ||
    code === "import_final_status_invalid" ||
    code === "import_summary_invalid"
  ) {
    return 400;
  }

  if (code === "import_run_not_open") {
    return 409;
  }

  return 500;
}

function messageForImportError(code) {
  if (code === "import_already_running") {
    return "An import run is already in progress. Wait for it to finish before starting another one.";
  }

  if (code === "import_source_not_found") {
    return "No active website import source is configured for this community.";
  }

  if (code === "import_source_forbidden") {
    return "You do not have access to this import source.";
  }

  if (code === "import_run_not_open") {
    return "The import run is not open for item writes.";
  }

  if (code === "import_mode_unsupported") {
    return "Only apply_review_only imports are supported.";
  }

  if (code === "import_source_lookup_failed") {
    return "Could not resolve the website import source.";
  }

  if (code.startsWith("import_item_")) {
    return "Could not write an import item.";
  }

  if (code.startsWith("import_final_") || code === "import_summary_invalid") {
    return "Could not finalize the import run.";
  }

  if (code === "supabase_env_not_configured") {
    return "Supabase URL and anon/publishable key are required.";
  }

  if (code === "missing_authorization" || code === "unauthenticated") {
    return "A valid user session token is required.";
  }

  return "Import write operation failed.";
}
