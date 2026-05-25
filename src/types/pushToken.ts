export type PushTokenPlatform = 'ios' | 'android' | 'web' | 'unknown';

export type PushTokenEnvironment = 'development' | 'preview' | 'production' | 'unknown';

export type PushTokenRegistrationStatus =
  | 'idle'
  | 'available'
  | 'registered'
  | 'not_authenticated'
  | 'notifications_permission_not_granted'
  | 'missing_project_id'
  | 'push_token_unavailable_in_current_runtime'
  | 'registration_failed'
  | 'unknown_error';

export type DeviceTokenRow = {
  id: string;
  user_id: string;
  platform: PushTokenPlatform;
  push_provider: 'expo';
  expo_push_token: string;
  device_id: string | null;
  app_version: string | null;
  build_version: string | null;
  environment: PushTokenEnvironment;
  is_active: boolean;
  last_seen_at: string;
  created_at: string;
  updated_at: string;
};

export type PushTokenRuntimeInfo = {
  appVersion: string | null;
  buildVersion: string | null;
  executionEnvironment: string;
  isExpoGo: boolean;
  platform: PushTokenPlatform;
  projectId: string | null;
  pushEnvironment: PushTokenEnvironment;
};

export type ExpoPushTokenStatusResult = {
  error?: string;
  expoPushToken?: string;
  runtime: PushTokenRuntimeInfo;
  status: PushTokenRegistrationStatus;
};

export type PushTokenRegistrationResult = {
  error?: string;
  expoPushToken?: string;
  ok: boolean;
  row?: DeviceTokenRow | null;
  runtime: PushTokenRuntimeInfo;
  status: PushTokenRegistrationStatus;
};

export type UpsertMyDeviceTokenInput = {
  appVersion?: string | null;
  buildVersion?: string | null;
  deviceId?: string | null;
  environment?: PushTokenEnvironment;
  expoPushToken: string;
  platform?: PushTokenPlatform;
};
