export const PRIVACY_REQUEST_TYPES = ['data_export', 'deletion', 'correction', 'other'] as const;
export const PRIVACY_REQUEST_STATUSES = [
  'open',
  'reviewed',
  'resolved',
  'rejected',
  'closed',
] as const;
export const PRIVACY_ERASURE_LIFECYCLE_STATES = ['deletion_pending', 'cancelled'] as const;

export type PrivacyRequestType = (typeof PRIVACY_REQUEST_TYPES)[number];
export type PrivacyRequestStatus = (typeof PRIVACY_REQUEST_STATUSES)[number];
export type PrivacyErasureLifecycleState = (typeof PRIVACY_ERASURE_LIFECYCLE_STATES)[number];

export type PrivacyAccessAccepted = {
  accepted: true;
};

export type PrivacySession = {
  privacySessionToken: string;
  tokenType: 'bearer';
  scope: 'privacy_self_service';
  expiresAt: string;
};

export type PrivacyErasureLifecycle = {
  requestId: string;
  state: PrivacyErasureLifecycleState;
  processingStoppedAt: string;
  cancelledAt: string | null;
  registrationsRequireReregistrationAfterCancel: true;
};

export type CreatePrivacyRequestInput = {
  communityId?: string | null;
  message?: string | null;
  requestType: PrivacyRequestType;
};

export type PrivacyRequest = {
  communityId: string | null;
  createdAt: string;
  id: string;
  message: string | null;
  requestType: PrivacyRequestType;
  resolvedAt: string | null;
  resolutionNote: string | null;
  status: PrivacyRequestStatus;
  updatedAt: string;
};
