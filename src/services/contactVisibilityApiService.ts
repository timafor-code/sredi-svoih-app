import type {
  ApiProfileContactVisibilityResponse,
  ApiProfileContactVisibilityUpdateRequest,
} from '@/types/api';
import type {
  ContactVisibilityUpdateInput,
  ProfileContactVisibility,
} from '@/types/contact';

import { apiClient, ApiClientError } from './apiClient';

const AUTH_REQUIRED_ERROR = 'auth_required';

function normalizeApiContactVisibilityError(error: ApiClientError): Error {
  if (error.status === 401 || error.code === 'unauthenticated') {
    return new Error(AUTH_REQUIRED_ERROR);
  }

  return new Error(error.message);
}

function mapApiProfileContactVisibility(
  row: ApiProfileContactVisibilityResponse,
): ProfileContactVisibility {
  return {
    birthdayRemindersEnabled: row.birthday_reminders_enabled,
    createdAt: row.created_at,
    shareBirthDate: row.share_birth_date,
    shareCity: row.share_city,
    shareEmail: row.share_email,
    shareHebrewBirthDate: row.share_hebrew_birth_date,
    shareHebrewName: row.share_hebrew_name,
    sharePhone: row.share_phone,
    showInCommunityDirectory: row.show_in_community_directory,
    updatedAt: row.updated_at,
    userId: row.user_id,
  };
}

function toApiVisibilityUpdateRequest(
  input: ContactVisibilityUpdateInput,
): ApiProfileContactVisibilityUpdateRequest {
  return {
    birthday_reminders_enabled: input.birthdayRemindersEnabled,
    share_birth_date: input.shareBirthDate,
    share_city: input.shareCity,
    share_email: input.shareEmail,
    share_hebrew_birth_date: input.shareHebrewBirthDate,
    share_hebrew_name: input.shareHebrewName,
    share_phone: input.sharePhone,
    show_in_community_directory: input.showInCommunityDirectory,
  };
}

async function withContactVisibilityApiErrors<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof ApiClientError) {
      throw normalizeApiContactVisibilityError(error);
    }

    throw error;
  }
}

export async function getMyContactVisibility(): Promise<ProfileContactVisibility> {
  return withContactVisibilityApiErrors(async () => {
    const response = await apiClient.get<ApiProfileContactVisibilityResponse | null>(
      '/me/contact-visibility',
    );

    if (!response) {
      throw new Error('contact_visibility_empty');
    }

    return mapApiProfileContactVisibility(response);
  });
}

export async function upsertMyContactVisibility(
  input: ContactVisibilityUpdateInput,
): Promise<ProfileContactVisibility> {
  return withContactVisibilityApiErrors(async () => {
    const response = await apiClient.put<
      ApiProfileContactVisibilityResponse | null,
      ApiProfileContactVisibilityUpdateRequest
    >(
      '/me/contact-visibility',
      toApiVisibilityUpdateRequest(input),
    );

    if (!response) {
      throw new Error('contact_visibility_empty');
    }

    return mapApiProfileContactVisibility(response);
  });
}
