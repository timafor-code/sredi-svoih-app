import { ApiClientError, apiClient } from './apiClient';
import type {
  ApiDeviceTokenResponse,
  DeviceTokenRow,
  PushTokenEnvironment,
  PushTokenPlatform,
  UpsertMyDeviceTokenInput,
} from '@/types/pushToken';
import { mapApiDeviceTokenResponse } from '@/types/pushToken';

type ApiDeviceTokenRegisterRequest = {
  app_version: string | null;
  build_version: string | null;
  device_id: string | null;
  environment: PushTokenEnvironment;
  expo_push_token: string;
  platform: PushTokenPlatform;
};

const deviceTokenIdsByExpoPushToken = new Map<string, string>();

function normalizeApiError(error: unknown): Error {
  if (error instanceof ApiClientError) {
    if (error.status === 401) {
      return new Error('auth_required');
    }

    if (error.status === 403) {
      return new Error('device_token_request_forbidden');
    }

    if (error.status === 422) {
      return new Error('device_token_request_invalid');
    }
  }

  return new Error('device_token_api_request_failed');
}

function toRegisterRequest(input: UpsertMyDeviceTokenInput): ApiDeviceTokenRegisterRequest {
  const expoPushToken = input.expoPushToken.trim();

  if (!expoPushToken) {
    throw new Error('device_token_empty');
  }

  return {
    app_version: input.appVersion?.trim() || null,
    build_version: input.buildVersion?.trim() || null,
    device_id: input.deviceId?.trim() || null,
    environment: input.environment ?? 'development',
    expo_push_token: expoPushToken,
    platform: input.platform ?? 'unknown',
  };
}

export async function upsertMyDeviceTokenViaApi(
  input: UpsertMyDeviceTokenInput,
): Promise<DeviceTokenRow> {
  const payload = toRegisterRequest(input);

  try {
    const response = await apiClient.post<ApiDeviceTokenResponse, ApiDeviceTokenRegisterRequest>(
      '/me/device-tokens',
      payload,
    );
    const row = mapApiDeviceTokenResponse(response);

    // Kept only in process memory so the existing token-based deactivation
    // facade can call the API's id-based endpoint without persisting PII.
    deviceTokenIdsByExpoPushToken.set(payload.expo_push_token, row.id);

    return row;
  } catch (error) {
    throw normalizeApiError(error);
  }
}

export async function deactivateMyDeviceTokenViaApi(
  expoPushToken: string,
): Promise<DeviceTokenRow> {
  const normalizedToken = expoPushToken.trim();
  const tokenId = deviceTokenIdsByExpoPushToken.get(normalizedToken);

  if (!tokenId) {
    throw new Error('device_token_deactivation_unavailable');
  }

  try {
    const response = await apiClient.delete<ApiDeviceTokenResponse>(
      `/me/device-tokens/${encodeURIComponent(tokenId)}`,
    );
    const row = mapApiDeviceTokenResponse(response);

    deviceTokenIdsByExpoPushToken.delete(normalizedToken);

    return row;
  } catch (error) {
    throw normalizeApiError(error);
  }
}
