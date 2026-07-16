import { apiBaseUrl } from "./apiClient";
import { getCurrentAdminContext } from "./adminAuthService";
import type { AdminAuthContext } from "../types/auth";

export type AdminHealthCheckStatus = "ok" | "warning" | "error" | "skipped";
export type AdminHealthCheckId = "api-configured" | "session-exists" | "membership-exists" | "current-role" | "selected-community";
export type AdminHealthCheckResult = { id: AdminHealthCheckId; label: string; status: AdminHealthCheckStatus; description: string };
export type AdminHealthReport = { checkedAt: string; summaryStatus: AdminHealthCheckStatus; checks: AdminHealthCheckResult[] };

function fromContext(context: AdminAuthContext): AdminHealthCheckResult[] {
  return [
    { id: "session-exists", label: "Session exists", status: context.isAuthenticated ? "ok" : "warning", description: context.isAuthenticated ? "Authenticated API session is available." : "No API session was found." },
    { id: "membership-exists", label: "Membership exists", status: context.membership ? "ok" : "warning", description: context.membership ? "Community membership is available." : "No community membership was returned." },
    { id: "current-role", label: "Current role", status: context.role ? "ok" : "warning", description: context.role ? `Current role: ${context.role}.` : "No role was returned." },
    { id: "selected-community", label: "Selected community", status: context.membership?.community_id ? "ok" : "warning", description: context.membership?.community_id ? "Selected community is available." : "No selected community was returned." },
  ];
}

export async function runAdminHealthCheck(): Promise<AdminHealthReport> {
  const checks: AdminHealthCheckResult[] = [{ id: "api-configured", label: "API configured", status: apiBaseUrl ? "ok" : "error", description: apiBaseUrl ? "VITE_API_URL is configured." : "VITE_API_URL is required." }];
  if (apiBaseUrl) checks.push(...fromContext(await getCurrentAdminContext()));
  return { checkedAt: new Date().toISOString(), checks, summaryStatus: checks.some((check) => check.status === "error") ? "error" : checks.some((check) => check.status === "warning") ? "warning" : "ok" };
}
