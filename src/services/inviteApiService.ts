import { apiClient } from './apiClient';
import type {
  ApiAcceptInviteResponse,
  ApiCommunityMembershipSummary,
  ApiCurrentUserResponse,
} from '@/types/api';
import type { CommunityMembership } from './inviteService';

function mapMembership(
  membership: ApiCommunityMembershipSummary,
  userId: string,
): CommunityMembership {
  return {
    id: membership.id,
    community_id: membership.community_id,
    user_id: userId,
    role: membership.role as CommunityMembership['role'],
    status: membership.status as CommunityMembership['status'],
    invited_by: null,
    joined_at: membership.joined_at,
    created_at: membership.created_at,
  };
}

export async function acceptInvite(code: string): Promise<CommunityMembership> {
  const inviteCode = code.trim();
  if (!inviteCode) throw new Error('Введите код приглашения.');

  const response = await apiClient.post<ApiAcceptInviteResponse, { invite_code: string }>(
    '/auth/accept-invite',
    { invite_code: inviteCode },
  );
  const currentUser = await apiClient.get<ApiCurrentUserResponse>('/auth/me');
  return mapMembership(response.membership, currentUser.user.id);
}

export async function loadMyMembership(): Promise<CommunityMembership | null> {
  const currentUser = await apiClient.get<ApiCurrentUserResponse>('/auth/me');
  const membership = currentUser.memberships
    .filter((item) => item.status === 'active')
    .sort((first, second) => (second.joined_at ?? second.created_at).localeCompare(first.joined_at ?? first.created_at))[0];

  return membership ? mapMembership(membership, currentUser.user.id) : null;
}
