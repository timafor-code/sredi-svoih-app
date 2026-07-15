export type CommunityMembershipRole = 'member' | 'event_manager' | 'admin' | 'rabbi';
export type CommunityMembershipStatus = 'pending' | 'active' | 'suspended' | 'left';

export type CommunityMembership = {
  id: string;
  community_id: string;
  user_id: string;
  role: CommunityMembershipRole;
  status: CommunityMembershipStatus;
  invited_by: string | null;
  joined_at: string | null;
  created_at: string;
};

export { acceptInvite, loadMyMembership } from './inviteApiService';
