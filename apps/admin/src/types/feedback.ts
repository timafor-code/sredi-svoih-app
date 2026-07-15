import type { AdminSection } from "./admin";

export const ADMIN_FEEDBACK_SEVERITIES = ["note", "issue", "blocker", "idea"] as const;
export const ADMIN_FEEDBACK_STATUSES = ["open", "reviewed", "resolved", "closed"] as const;

export type AdminFeedbackSeverity = (typeof ADMIN_FEEDBACK_SEVERITIES)[number];
export type AdminFeedbackStatus = (typeof ADMIN_FEEDBACK_STATUSES)[number];

export type AdminFeedbackEntityContext = {
  entityType: string;
  entityId: string;
};

export type CreateAdminFeedbackInput = {
  section: AdminSection;
  communityId?: string | null;
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

export type AdminFeedbackRow = {
  id: string;
  community_id: string;
  user_id: string;
  section: string;
  entity_type: string | null;
  entity_id: string | null;
  severity: AdminFeedbackSeverity | string;
  message: string;
  status: AdminFeedbackStatus | string;
  url: string | null;
  user_agent: string | null;
  created_at: string;
  updated_at: string | null;
  resolved_at: string | null;
  resolved_by: string | null;
  total_count: number | string | null;
};

export type AdminFeedbackItem = {
  id: string;
  communityId: string;
  userId: string;
  section: string;
  entityType: string | null;
  entityId: string | null;
  severity: AdminFeedbackSeverity;
  message: string;
  status: AdminFeedbackStatus;
  url: string | null;
  userAgent: string | null;
  createdAt: string;
  updatedAt: string | null;
  resolvedAt: string | null;
  resolvedBy: string | null;
  totalCount: number | null;
};

export type AdminFeedbackListFilters = {
  status?: AdminFeedbackStatus | "all" | null;
  severity?: AdminFeedbackSeverity | "all" | null;
  section?: string | null;
  limit?: number | null;
  offset?: number | null;
};

export type AdminFeedbackListResponse = {
  items: AdminFeedbackItem[];
  totalCount: number;
  limit: number;
  offset: number;
};

export type AdminFeedbackStatusUpdateInput = {
  id: string;
  status: AdminFeedbackStatus;
};

export type AdminFeedbackStatusUpdateResponse = Omit<AdminFeedbackItem, "totalCount">;
