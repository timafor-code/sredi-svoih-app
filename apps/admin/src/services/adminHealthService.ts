import { getCurrentAdminContext, getCurrentSession } from "./adminAuthService";
import { listRegistrationEvents } from "./adminEventsService";
import { listImportItemsNeedingReview } from "./adminImportReviewService";
import { listAdminUsers } from "./adminMembersService";
import { isSupabaseConfigured, requireSupabaseClient } from "./supabaseClient";
import type { AdminAuthContext, AdminMembership, AdminRole } from "../types/auth";

export type AdminHealthCheckStatus = "ok" | "warning" | "error" | "skipped";

export type AdminHealthCheckId =
  | "supabase-configured"
  | "session-exists"
  | "membership-exists"
  | "current-role"
  | "selected-community"
  | "events-service"
  | "import-review-service"
  | "registrations-service"
  | "members-service";

export type AdminHealthCheckResult = {
  id: AdminHealthCheckId;
  label: string;
  status: AdminHealthCheckStatus;
  description: string;
};

export type AdminHealthReport = {
  checkedAt: string;
  summaryStatus: AdminHealthCheckStatus;
  checks: AdminHealthCheckResult[];
};

type CheckInput = Omit<AdminHealthCheckResult, "label">;

const CHECK_LABELS: Record<AdminHealthCheckId, string> = {
  "supabase-configured": "Supabase configured",
  "session-exists": "Session exists",
  "membership-exists": "Membership exists",
  "current-role": "Current role",
  "selected-community": "Selected community",
  "events-service": "Events",
  "import-review-service": "Import review",
  "registrations-service": "Registrations",
  "members-service": "Members",
};

export async function runAdminHealthCheck(): Promise<AdminHealthReport> {
  const checks: AdminHealthCheckResult[] = [];

  const pushCheck = (check: CheckInput) => {
    checks.push({
      ...check,
      label: CHECK_LABELS[check.id],
    });
  };

  if (!isSupabaseConfigured) {
    pushCheck({
      id: "supabase-configured",
      status: "error",
      description: "Browser Supabase configuration is incomplete on this host.",
    });
    pushSkippedAuthChecks(pushCheck, "Skipped until browser Supabase config is present.");
    pushSkippedServiceChecks(pushCheck, "Skipped until browser Supabase config is present.");
    return buildHealthReport(checks);
  }

  pushCheck({
    id: "supabase-configured",
    status: "ok",
    description: "Browser Supabase configuration is present. Secret values are not inspected.",
  });

  const session = await readCurrentSession(pushCheck);
  if (!session) {
    pushSkippedContextChecks(pushCheck, "Skipped until an authenticated session exists.");
    pushSkippedServiceChecks(pushCheck, "Skipped until an authenticated session exists.");
    return buildHealthReport(checks);
  }

  const context = await readCurrentContext(pushCheck);
  if (!context) {
    pushCheck({
      id: "current-role",
      status: "skipped",
      description: "Skipped because the current admin context could not be read.",
    });
    pushCheck({
      id: "selected-community",
      status: "skipped",
      description: "Skipped because the current admin context could not be read.",
    });
    pushSkippedServiceChecks(pushCheck, "Skipped because the current admin context is unavailable.");
    return buildHealthReport(checks);
  }

  pushMembershipChecks(pushCheck, context);

  if (!context.canAccessAdmin || !isAdminOrEventManager(context.role)) {
    pushSkippedServiceChecks(pushCheck, "Skipped because the current role cannot access admin read layers.");
    return buildHealthReport(checks);
  }

  const serviceChecks = await Promise.all([
    checkEventsService(),
    checkImportReviewService(),
    checkRegistrationsService(),
    checkMembersService(context.role, context.membership),
  ]);

  serviceChecks.forEach(pushCheck);
  return buildHealthReport(checks);
}

async function readCurrentSession(
  pushCheck: (check: CheckInput) => void,
): Promise<unknown | null> {
  try {
    const session = await getCurrentSession();

    if (!session) {
      pushCheck({
        id: "session-exists",
        status: "warning",
        description: "No authenticated browser session was found.",
      });
      return null;
    }

    pushCheck({
      id: "session-exists",
      status: "ok",
      description: "Authenticated session is available.",
    });
    return session;
  } catch (error) {
    pushCheck({
      id: "session-exists",
      status: "error",
      description: describeSafeError(error, "Could not read the authenticated session."),
    });
    return null;
  }
}

async function readCurrentContext(
  pushCheck: (check: CheckInput) => void,
): Promise<AdminAuthContext | null> {
  try {
    return await getCurrentAdminContext();
  } catch (error) {
    pushCheck({
      id: "membership-exists",
      status: "error",
      description: describeSafeError(
        error,
        "Could not read profile and active membership with the authenticated client.",
      ),
    });
    return null;
  }
}

function pushMembershipChecks(
  pushCheck: (check: CheckInput) => void,
  context: AdminAuthContext,
) {
  const membership = context.membership;

  if (!membership) {
    pushCheck({
      id: "membership-exists",
      status: "warning",
      description: "No active community membership was returned for this session.",
    });
    pushCheck({
      id: "current-role",
      status: "skipped",
      description: "Skipped because no active membership role was returned.",
    });
    pushCheck({
      id: "selected-community",
      status: "skipped",
      description: "Skipped because no active membership was returned.",
    });
    return;
  }

  pushCheck({
    id: "membership-exists",
    status: membership.status === "active" ? "ok" : "warning",
    description:
      membership.status === "active"
        ? "Active community membership is available."
        : "Membership was returned, but it is not active.",
  });

  pushCheck({
    id: "current-role",
    status: isAdminOrEventManager(context.role) ? "ok" : "warning",
    description: context.role
      ? `Current role: ${context.role}.`
      : "No admin role was returned for this session.",
  });

  pushCheck({
    id: "selected-community",
    status: membership.community_id ? "ok" : "warning",
    description: membership.community_id
      ? `Selected community: ${getCommunityLabel(membership)}.`
      : "No selected community was returned with the active membership.",
  });
}

async function checkEventsService(): Promise<CheckInput> {
  try {
    const supabase = requireSupabaseClient();
    const { error } = await supabase
      .from("events")
      .select("id", { head: true })
      .limit(1);

    if (error) {
      throw error;
    }

    return {
      id: "events-service",
      status: "ok",
      description: "Authenticated read access to events is available.",
    };
  } catch (error) {
    return {
      id: "events-service",
      status: "error",
      description: describeSafeError(error, "Events read layer is not available."),
    };
  }
}

async function checkImportReviewService(): Promise<CheckInput> {
  try {
    await listImportItemsNeedingReview(1);

    return {
      id: "import-review-service",
      status: "ok",
      description: "Import review RPC is available for the current role.",
    };
  } catch (error) {
    return {
      id: "import-review-service",
      status: "error",
      description: describeSafeError(error, "Import review RPC is not available."),
    };
  }
}

async function checkRegistrationsService(): Promise<CheckInput> {
  try {
    await listRegistrationEvents();

    return {
      id: "registrations-service",
      status: "ok",
      description: "Registration summary RPC is available for the current role.",
    };
  } catch (error) {
    return {
      id: "registrations-service",
      status: "error",
      description: describeSafeError(error, "Registrations RPC is not available."),
    };
  }
}

async function checkMembersService(
  role: AdminRole | null,
  membership: AdminMembership | null,
): Promise<CheckInput> {
  if (role !== "admin") {
    return {
      id: "members-service",
      status: "skipped",
      description: "Skipped for non-admin roles; this is expected for event_manager.",
    };
  }

  if (!membership?.community_id) {
    return {
      id: "members-service",
      status: "skipped",
      description: "Skipped because no selected community was returned.",
    };
  }

  try {
    await listAdminUsers({
      communityId: membership.community_id,
      search: null,
      membershipStatus: "all",
      role: "all",
      limit: 1,
      offset: 0,
    });

    return {
      id: "members-service",
      status: "ok",
      description: "Admin-only members RPC is available for this admin session.",
    };
  } catch (error) {
    return {
      id: "members-service",
      status: "error",
      description: describeSafeError(error, "Admin-only members RPC is not available."),
    };
  }
}

function pushSkippedAuthChecks(
  pushCheck: (check: CheckInput) => void,
  description: string,
) {
  (["session-exists", "membership-exists", "current-role", "selected-community"] as const)
    .forEach((id) => {
      pushCheck({
        id,
        status: "skipped",
        description,
      });
    });
}

function pushSkippedContextChecks(
  pushCheck: (check: CheckInput) => void,
  description: string,
) {
  (["membership-exists", "current-role", "selected-community"] as const).forEach((id) => {
    pushCheck({
      id,
      status: "skipped",
      description,
    });
  });
}

function pushSkippedServiceChecks(
  pushCheck: (check: CheckInput) => void,
  description: string,
) {
  (
    [
      "events-service",
      "import-review-service",
      "registrations-service",
      "members-service",
    ] as const
  ).forEach((id) => {
    pushCheck({
      id,
      status: "skipped",
      description,
    });
  });
}

function buildHealthReport(checks: AdminHealthCheckResult[]): AdminHealthReport {
  return {
    checkedAt: new Date().toISOString(),
    summaryStatus: getSummaryStatus(checks),
    checks,
  };
}

function getSummaryStatus(checks: AdminHealthCheckResult[]): AdminHealthCheckStatus {
  if (checks.some((check) => check.status === "error")) {
    return "error";
  }

  if (checks.some((check) => check.status === "warning")) {
    return "warning";
  }

  if (checks.every((check) => check.status === "skipped")) {
    return "skipped";
  }

  return "ok";
}

function getCommunityLabel(membership: AdminMembership): string {
  return (
    firstNonEmpty(
      membership.community?.name,
      membership.community_name,
      membership.community_id,
      membership.community?.id,
    ) ?? "community selected"
  );
}

function firstNonEmpty(...values: Array<string | null | undefined>): string | null {
  for (const value of values) {
    const trimmed = value?.trim();

    if (trimmed) {
      return trimmed;
    }
  }

  return null;
}

function isAdminOrEventManager(role: AdminRole | null): boolean {
  return role === "admin" || role === "event_manager";
}

function describeSafeError(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : String(error ?? "");
  const normalized = message.toLowerCase();

  if (
    normalized.includes("permission denied") ||
    normalized.includes("access denied") ||
    normalized.includes("not authorized") ||
    normalized.includes("row-level security") ||
    normalized.includes("insufficient privilege")
  ) {
    return "Access denied for the current role/session.";
  }

  if (
    normalized.includes("not found") ||
    normalized.includes("could not find the function") ||
    normalized.includes("rpc") ||
    normalized.includes("schema cache")
  ) {
    return "Backend endpoint is not available in this Supabase project.";
  }

  if (
    normalized.includes("failed to fetch") ||
    normalized.includes("network") ||
    normalized.includes("connection")
  ) {
    return "Request failed. Check the staging Supabase URL and network access.";
  }

  return fallback;
}
