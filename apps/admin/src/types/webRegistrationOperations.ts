export type WebRegistrationConflictStatus = "open" | "resolved";

export type AdminWebRegistrationOperationsSummary = {
  activeEmailVerificationIntents: number;
  openIdentityConflicts: number;
  openPrivacyRequests: number;
  overduePrivacyRequests: number;
};

export type AdminWebRegistrationIdentityConflict = {
  id: string;
  registrationIntentId: string;
  category: "email_phone_different_users";
  status: WebRegistrationConflictStatus;
  emailUserId: string | null;
  phoneUserId: string | null;
  eventId: string;
  occurrenceId: string | null;
  intentStatus: string;
  createdAt: string;
  resolvedAt: string | null;
};

export type ListWebRegistrationIdentityConflictsParams = {
  status: WebRegistrationConflictStatus;
  limit: number;
  offset: number;
};

export type UpdateWebRegistrationIdentityConflictInput = {
  status: WebRegistrationConflictStatus;
};
