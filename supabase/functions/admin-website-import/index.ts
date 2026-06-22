// @ts-nocheck
import {
  jsonResponse,
  preflightResponse,
  requireAdminImportAccess,
} from "../_shared/adminAuth.ts";

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

  return jsonResponse(request, 200, {
    ok: true,
    mode: "health",
    userRole: access.userRole,
    communityId: access.communityId,
  });
});
