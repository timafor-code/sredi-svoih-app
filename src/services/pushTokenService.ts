import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import type {
  DeviceTokenRow,
  ExpoPushTokenStatusResult,
  PushTokenEnvironment,
  PushTokenPlatform,
  PushTokenRegistrationResult,
  PushTokenRegistrationStatus,
  PushTokenRuntimeInfo,
  UpsertMyDeviceTokenInput,
} from '@/types/pushToken';
import { sanitizeExpoPushTokenErrorText } from '@/types/pushToken';
import {
  deactivateMyDeviceTokenViaApi,
  upsertMyDeviceTokenViaApi,
} from './deviceTokenApiService';
import { getSession } from './authService';

type NotificationPermissionStatus = 'granted' | 'denied' | 'undetermined' | 'unknown';

const AUTH_REQUIRED_ERROR = 'auth_required';

type GetExpoPushTokenStatusOptions = {
  requestPermissions?: boolean;
};

function normalizeNotificationPermissionStatus(status: unknown): NotificationPermissionStatus {
  if (typeof status !== 'string') {
    return 'unknown';
  }

  switch (status.toLowerCase()) {
    case 'granted':
      return 'granted';
    case 'denied':
      return 'denied';
    case 'undetermined':
      return 'undetermined';
    default:
      return 'unknown';
  }
}

function normalizePlatform(platform: string): PushTokenPlatform {
  if (platform === 'ios' || platform === 'android' || platform === 'web') {
    return platform;
  }

  return 'unknown';
}

function normalizeEnvironment(value: unknown): PushTokenEnvironment | null {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim().toLowerCase();

  if (
    normalized === 'development' ||
    normalized === 'preview' ||
    normalized === 'production' ||
    normalized === 'unknown'
  ) {
    return normalized;
  }

  return null;
}

function getConstantsRecord(): Record<string, unknown> {
  return Constants as unknown as Record<string, unknown>;
}

function getNestedString(value: unknown, path: readonly string[]): string | null {
  let current = value;

  for (const key of path) {
    if (!current || typeof current !== 'object' || !(key in current)) {
      return null;
    }

    current = (current as Record<string, unknown>)[key];
  }

  return typeof current === 'string' && current.trim().length > 0 ? current.trim() : null;
}

function getEasProjectId(): string | null {
  const constants = getConstantsRecord();

  return (
    getNestedString(constants.easConfig, ['projectId']) ??
    getNestedString(constants.expoConfig, ['extra', 'eas', 'projectId'])
  );
}

function getAppVersion(): string | null {
  const constants = getConstantsRecord();

  return (
    getNestedString(constants, ['nativeAppVersion']) ??
    getNestedString(constants.expoConfig, ['version'])
  );
}

function getBuildVersion(): string | null {
  const constants = getConstantsRecord();
  const nativeBuildVersion = getNestedString(constants, ['nativeBuildVersion']);

  if (nativeBuildVersion) {
    return nativeBuildVersion;
  }

  if (Platform.OS === 'ios') {
    return getNestedString(constants.platform, ['ios', 'buildNumber']);
  }

  if (Platform.OS === 'android') {
    const versionCode = getNestedString(constants.platform, ['android', 'versionCode']);

    if (versionCode) {
      return versionCode;
    }

    const androidPlatform = constants.platform && typeof constants.platform === 'object'
      ? (constants.platform as Record<string, unknown>).android
      : null;
    const numericVersionCode = androidPlatform && typeof androidPlatform === 'object'
      ? (androidPlatform as Record<string, unknown>).versionCode
      : null;

    return typeof numericVersionCode === 'number' ? String(numericVersionCode) : null;
  }

  return null;
}

function getPushEnvironment(): PushTokenEnvironment {
  const configuredEnvironment = normalizeEnvironment(process.env.EXPO_PUBLIC_PUSH_ENV);

  if (configuredEnvironment) {
    return configuredEnvironment;
  }

  return __DEV__ ? 'development' : 'production';
}

function getPushTokenRuntimeInfo(): PushTokenRuntimeInfo {
  const constants = getConstantsRecord();
  const executionEnvironment = typeof Constants.executionEnvironment === 'string'
    ? Constants.executionEnvironment
    : 'unknown';
  const appOwnership = typeof constants.appOwnership === 'string' ? constants.appOwnership : null;

  return {
    appVersion: getAppVersion(),
    buildVersion: getBuildVersion(),
    executionEnvironment,
    isExpoGo:
      executionEnvironment === 'storeClient' ||
      appOwnership === 'expo' ||
      constants.expoGoConfig != null,
    platform: normalizePlatform(Platform.OS),
    projectId: getEasProjectId(),
    pushEnvironment: getPushEnvironment(),
  };
}

async function getRemoteNotificationPermissionStatus(
  shouldRequest: boolean,
): Promise<NotificationPermissionStatus> {
  if (typeof Notifications.getPermissionsAsync !== 'function') {
    return 'unknown';
  }

  const currentPermission = await Notifications.getPermissionsAsync();
  const currentStatus = normalizeNotificationPermissionStatus(currentPermission?.status);

  if (currentStatus === 'granted' || !shouldRequest) {
    return currentStatus;
  }

  if (typeof Notifications.requestPermissionsAsync !== 'function') {
    return currentStatus;
  }

  const nextPermission = await Notifications.requestPermissionsAsync({
    ios: {
      allowAlert: true,
      allowBadge: false,
      allowSound: false,
    },
  });

  return normalizeNotificationPermissionStatus(nextPermission?.status);
}

function getErrorMessage(error: unknown): string {
  return sanitizeExpoPushTokenErrorText(error);
}

function getExpoTokenErrorStatus(message: string): PushTokenRegistrationStatus {
  const normalized = message.toLowerCase();

  if (normalized.includes('projectid') || normalized.includes('project id')) {
    return 'missing_project_id';
  }

  return 'push_token_unavailable_in_current_runtime';
}

async function assertAuthenticatedForDeviceProvider(): Promise<void> {
  const session = await getSession();

  if (!session) {
    throw new Error(AUTH_REQUIRED_ERROR);
  }
}

export async function getExpoPushTokenStatus(
  options: GetExpoPushTokenStatusOptions = {},
): Promise<ExpoPushTokenStatusResult> {
  const runtime = getPushTokenRuntimeInfo();

  if (runtime.platform === 'web' || runtime.platform === 'unknown' || runtime.isExpoGo) {
    return {
      runtime,
      status: 'push_token_unavailable_in_current_runtime',
    };
  }

  if (!runtime.projectId) {
    return {
      runtime,
      status: 'missing_project_id',
    };
  }

  if (typeof Notifications.getExpoPushTokenAsync !== 'function') {
    return {
      runtime,
      status: 'push_token_unavailable_in_current_runtime',
    };
  }

  try {
    const permissionStatus = await getRemoteNotificationPermissionStatus(
      options.requestPermissions === true,
    );

    if (permissionStatus !== 'granted') {
      return {
        runtime,
        status: 'notifications_permission_not_granted',
      };
    }

    const expoPushToken = await Notifications.getExpoPushTokenAsync({
      projectId: runtime.projectId,
    });
    const token = typeof expoPushToken?.data === 'string' ? expoPushToken.data.trim() : '';

    if (!token) {
      return {
        runtime,
        status: 'push_token_unavailable_in_current_runtime',
      };
    }

    return {
      expoPushToken: token,
      runtime,
      status: 'available',
    };
  } catch (error) {
    const message = getErrorMessage(error);

    return {
      error: message,
      runtime,
      status: getExpoTokenErrorStatus(message),
    };
  }
}

export async function upsertMyDeviceToken(
  input: UpsertMyDeviceTokenInput,
): Promise<DeviceTokenRow> {
  await assertAuthenticatedForDeviceProvider();

  return upsertMyDeviceTokenViaApi(input);
}

export async function deactivateMyDeviceToken(
  expoPushToken: string,
): Promise<DeviceTokenRow | null> {
  await assertAuthenticatedForDeviceProvider();

  return deactivateMyDeviceTokenViaApi(expoPushToken);
}

export async function registerCurrentDeviceForPush(): Promise<PushTokenRegistrationResult> {
  const runtime = getPushTokenRuntimeInfo();

  try {
    await assertAuthenticatedForDeviceProvider();
  } catch (error) {
    return {
      error: getErrorMessage(error),
      ok: false,
      runtime,
      status: 'not_authenticated',
    };
  }

  const tokenStatus = await getExpoPushTokenStatus({ requestPermissions: true });

  if (tokenStatus.status !== 'available' || !tokenStatus.expoPushToken) {
    return {
      error: tokenStatus.error,
      ok: false,
      runtime: tokenStatus.runtime,
      status: tokenStatus.status,
    };
  }

  try {
    const row = await upsertMyDeviceToken({
      appVersion: tokenStatus.runtime.appVersion,
      buildVersion: tokenStatus.runtime.buildVersion,
      environment: tokenStatus.runtime.pushEnvironment,
      expoPushToken: tokenStatus.expoPushToken,
      platform: tokenStatus.runtime.platform,
    });

    return {
      expoPushToken: tokenStatus.expoPushToken,
      ok: true,
      row,
      runtime: tokenStatus.runtime,
      status: 'registered',
    };
  } catch (error) {
    return {
      error: getErrorMessage(error),
      expoPushToken: tokenStatus.expoPushToken,
      ok: false,
      runtime: tokenStatus.runtime,
      status: 'registration_failed',
    };
  }
}
