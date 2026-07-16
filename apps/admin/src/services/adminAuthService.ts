import { apiBaseUrl } from "./apiClient";
import * as adminAuthApiService from "./adminAuthApiService";
import type { AdminAuthContext, AdminAuthSession } from "../types/auth";

export function isAdminAuthConfigured(): boolean {
  return Boolean(apiBaseUrl);
}

export function getAdminAuthConfigurationError(): string | null {
  return apiBaseUrl ? null : "VITE_API_URL is required before using web-admin.";
}

export async function getCurrentSession(): Promise<AdminAuthSession | null> {
  return adminAuthApiService.getCurrentSession();
}

export async function signInWithPassword(email: string, password: string): Promise<void> {
  await adminAuthApiService.signInWithPassword(email, password);
}

export async function signOut(): Promise<void> {
  await adminAuthApiService.signOut();
}

export async function getCurrentAdminContext(): Promise<AdminAuthContext> {
  return adminAuthApiService.getCurrentAdminContext();
}

export function subscribeToAdminSessionExpiry(listener: () => void): () => void {
  return adminAuthApiService.subscribeToAdminSessionExpiry(listener);
}
