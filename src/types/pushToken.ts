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
  /**
   * Legacy Supabase RPCs return the owner and raw token. The Python API
   * deliberately omits both PII fields from its response.
   */
  user_id?: string;
  platform: PushTokenPlatform;
  push_provider: 'expo';
  expo_push_token?: string;
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

export type ApiDeviceTokenResponse = {
  app_version: string | null;
  build_version: string | null;
  created_at: string;
  device_id: string | null;
  environment: string;
  id: string;
  is_active: boolean;
  last_seen_at: string;
  platform: string;
  push_provider: string;
  updated_at: string;
};

const EXPO_PUSH_TOKEN_PATTERN = /(?:ExponentPushToken|ExpoPushToken)\[[^\]]+\]/g;

function requiredApiString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Device token API response is missing ${field}.`);
  }

  return value;
}

function nullableApiString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function normalizeApiPlatform(value: unknown): PushTokenPlatform {
  if (value === 'ios' || value === 'android' || value === 'web') {
    return value;
  }

  return 'unknown';
}

function normalizeApiEnvironment(value: unknown): PushTokenEnvironment {
  if (
    value === 'development'
    || value === 'preview'
    || value === 'production'
    || value === 'unknown'
  ) {
    return value;
  }

  return 'unknown';
}

export function mapApiDeviceTokenResponse(response: ApiDeviceTokenResponse): DeviceTokenRow {
  if (response.push_provider !== 'expo') {
    throw new Error('Device token API response has an invalid push provider.');
  }

  if (typeof response.is_active !== 'boolean') {
    throw new Error('Device token API response has an invalid active state.');
  }

  return {
    app_version: nullableApiString(response.app_version),
    build_version: nullableApiString(response.build_version),
    created_at: requiredApiString(response.created_at, 'created_at'),
    device_id: nullableApiString(response.device_id),
    environment: normalizeApiEnvironment(response.environment),
    id: requiredApiString(response.id, 'id'),
    is_active: response.is_active,
    last_seen_at: requiredApiString(response.last_seen_at, 'last_seen_at'),
    platform: normalizeApiPlatform(response.platform),
    push_provider: 'expo',
    updated_at: requiredApiString(response.updated_at, 'updated_at'),
  };
}

export function sanitizeExpoPushTokenErrorText(
  error: unknown,
  knownToken?: string | null,
): string {
  const rawMessage = error instanceof Error ? error.message : String(error);
  const withoutTokenPattern = rawMessage.replace(EXPO_PUSH_TOKEN_PATTERN, '[redacted push token]');

  if (!knownToken) {
    return withoutTokenPattern;
  }

  return withoutTokenPattern.split(knownToken).join('[redacted push token]');
}
