import type { AdminSection } from "./admin";

export const ADMIN_FEEDBACK_SEVERITIES = ["note", "issue", "blocker", "idea"] as const;

export type AdminFeedbackSeverity = (typeof ADMIN_FEEDBACK_SEVERITIES)[number];

export type AdminFeedbackEntityContext = {
  entityType: string;
  entityId: string;
};

export type CreateAdminFeedbackInput = {
  section: AdminSection;
  url?: string | null;
  userAgent?: string | null;
  severity: AdminFeedbackSeverity;
  message: string;
  entity?: AdminFeedbackEntityContext | null;
};

export type AdminFeedbackSubmitResult = {
  id: string;
  status: string;
  createdAt: string;
};
