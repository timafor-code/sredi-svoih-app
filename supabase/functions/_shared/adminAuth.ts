// @ts-nocheck
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.8";

const ADMIN_ROLES = new Set(["admin", "event_manager"]);
const ALLOWED_METHODS = "POST, OPTIONS";
const ALLOWED_HEADERS = "authorization, x-client-info, apikey, content-type";

export function corsHeaders(request: Request): Headers {
  const headers = new Headers({
    "Access-Control-Allow-Methods": ALLOWED_METHODS,
    "Access-Control-Allow-Headers": ALLOWED_HEADERS,
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  });

  const configuredOrigin = getAdminWebOrigin();
  const requestOrigin = request.headers.get("origin");

  if (configuredOrigin && requestOrigin === configuredOrigin) {
    headers.set("Access-Control-Allow-Origin", configuredOrigin);
  }

  return headers;
}

export function preflightResponse(request: Request): Response {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(request),
  });
}

export function jsonResponse(
  request: Request,
  status: number,
  body: Record<string, unknown>,
): Response {
  const headers = corsHeaders(request);
  headers.set("Content-Type", "application/json; charset=utf-8");

  return new Response(JSON.stringify(body), {
    status,
    headers,
  });
}

export async function requireAdminImportAccess(request: Request) {
  const corsConfigError = getCorsConfigError();

  if (corsConfigError) {
    return {
      ok: false,
      status: 500,
      body: {
        ok: false,
        code: "cors_not_configured",
        message: corsConfigError,
      },
    };
  }

  const authorization = request.headers.get("authorization")?.trim();

  if (!authorization) {
    return {
      ok: false,
      status: 401,
      body: {
        ok: false,
        code: "missing_authorization",
        message: "Authorization header is required.",
      },
    };
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")?.trim();
  const supabaseKey =
    Deno.env.get("SUPABASE_ANON_KEY")?.trim() ??
    Deno.env.get("SUPABASE_PUBLISHABLE_KEY")?.trim();

  if (!supabaseUrl || !supabaseKey) {
    return {
      ok: false,
      status: 500,
      body: {
        ok: false,
        code: "supabase_env_not_configured",
        message: "Supabase URL and anon/publishable key are required.",
      },
    };
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

  const { data: userData, error: userError } = await supabase.auth.getUser();
  const user = userData?.user ?? null;

  if (userError || !user) {
    return {
      ok: false,
      status: 401,
      body: {
        ok: false,
        code: "invalid_session",
        message: "A valid user session token is required.",
      },
    };
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id")
    .eq("id", user.id)
    .maybeSingle();

  if (profileError) {
    return {
      ok: false,
      status: 500,
      body: {
        ok: false,
        code: "profile_lookup_failed",
        message: "Could not read the current profile.",
      },
    };
  }

  const membershipUserId = profile?.id ?? user.id;
  const { data: membership, error: membershipError } = await supabase
    .from("community_memberships")
    .select("community_id, role, status, joined_at, created_at")
    .eq("user_id", membershipUserId)
    .eq("status", "active")
    .in("role", Array.from(ADMIN_ROLES))
    .order("joined_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (membershipError) {
    return {
      ok: false,
      status: 500,
      body: {
        ok: false,
        code: "membership_lookup_failed",
        message: "Could not read the current membership.",
      },
    };
  }

  if (
    !membership ||
    membership.status !== "active" ||
    !ADMIN_ROLES.has(membership.role)
  ) {
    return {
      ok: false,
      status: 403,
      body: {
        ok: false,
        code: "admin_access_required",
        message: "Active admin or event manager access is required.",
      },
    };
  }

  return {
    ok: true,
    userId: user.id,
    userRole: membership.role,
    communityId:
      typeof membership.community_id === "string" ? membership.community_id : null,
  };
}

function getAdminWebOrigin(): string | null {
  const configuredOrigin = Deno.env.get("ADMIN_WEB_ORIGIN")?.trim() ?? "";

  if (!configuredOrigin || configuredOrigin.includes("*")) {
    return null;
  }

  return configuredOrigin;
}

function getCorsConfigError(): string | null {
  const configuredOrigin = Deno.env.get("ADMIN_WEB_ORIGIN")?.trim() ?? "";

  if (!configuredOrigin) {
    return "ADMIN_WEB_ORIGIN must be set to the exact admin SPA origin.";
  }

  if (configuredOrigin.includes("*")) {
    return "ADMIN_WEB_ORIGIN must not use a wildcard origin.";
  }

  return null;
}
