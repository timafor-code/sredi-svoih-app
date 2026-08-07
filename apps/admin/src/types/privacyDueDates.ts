export type AdminPrivacyRequestType =
  | "data_export"
  | "deletion"
  | "correction"
  | "other";

export type AdminPrivacyRequestStatus =
  | "open"
  | "reviewed"
  | "resolved"
  | "rejected"
  | "closed";

export type AdminPrivacyDueDateItem = {
  id: string;
  requestType: AdminPrivacyRequestType;
  status: AdminPrivacyRequestStatus;
  createdAt: string;
  dueAt: string | null;
};

export type AdminPrivacyDueDateFilter = "all" | "overdue";

export type ListAdminPrivacyDueDatesParams = {
  filter: AdminPrivacyDueDateFilter;
};
