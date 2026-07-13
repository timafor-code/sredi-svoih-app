import type {
  ContactVisibilityUpdateInput,
  ProfileContactVisibility,
  ProfileContactVisibilityRow,
} from '@/types/contact';
import { isMobileApiProviderEnabled } from './apiClient';
import * as contactVisibilityApiService from './contactVisibilityApiService';
import { supabase } from './supabaseClient';

const AUTH_REQUIRED_ERROR = 'auth_required';

type SupabaseRpcError = {
  code?: string;
  message: string;
};

async function assertAuthenticated(): Promise<void> {
  const { data, error } = await supabase.auth.getSession();

  if (error) {
    throw new Error(error.message);
  }

  if (!data.session) {
    throw new Error(AUTH_REQUIRED_ERROR);
  }
}

function normalizeRpcError(error: SupabaseRpcError): Error {
  if (error.code === '28000' || error.message.toLowerCase().includes('auth required')) {
    return new Error(AUTH_REQUIRED_ERROR);
  }

  return new Error(error.message);
}

function normalizeRpcRow(data: unknown): ProfileContactVisibilityRow {
  const row = Array.isArray(data) ? data[0] : data;

  if (!row) {
    throw new Error('contact_visibility_empty');
  }

  return row as ProfileContactVisibilityRow;
}

function mapProfileContactVisibilityRow(
  row: ProfileContactVisibilityRow,
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

function toRpcArgs(input: ContactVisibilityUpdateInput) {
  return {
    p_birthday_reminders_enabled: input.birthdayRemindersEnabled,
    p_share_birth_date: input.shareBirthDate,
    p_share_city: input.shareCity,
    p_share_email: input.shareEmail,
    p_share_hebrew_birth_date: input.shareHebrewBirthDate,
    p_share_hebrew_name: input.shareHebrewName,
    p_share_phone: input.sharePhone,
    p_show_in_community_directory: input.showInCommunityDirectory,
  };
}

export async function getMyContactVisibility(): Promise<ProfileContactVisibility> {
  if (isMobileApiProviderEnabled('contacts')) {
    return contactVisibilityApiService.getMyContactVisibility();
  }

  await assertAuthenticated();

  const { data, error } = await supabase.rpc('get_my_contact_visibility');

  if (error) {
    throw normalizeRpcError(error);
  }

  return mapProfileContactVisibilityRow(normalizeRpcRow(data));
}

export async function upsertMyContactVisibility(
  input: ContactVisibilityUpdateInput,
): Promise<ProfileContactVisibility> {
  if (isMobileApiProviderEnabled('contacts')) {
    return contactVisibilityApiService.upsertMyContactVisibility(input);
  }

  await assertAuthenticated();

  const { data, error } = await supabase.rpc('upsert_my_contact_visibility', toRpcArgs(input));

  if (error) {
    throw normalizeRpcError(error);
  }

  return mapProfileContactVisibilityRow(normalizeRpcRow(data));
}
