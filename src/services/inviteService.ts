import { supabase } from './supabaseClient';

export type CommunityMembershipRole = 'member' | 'event_manager' | 'admin';

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

const MEMBERSHIP_FIELDS = `
  id,
  community_id,
  user_id,
  role,
  status,
  invited_by,
  joined_at,
  created_at
`;

export async function acceptInvite(code: string): Promise<CommunityMembership> {
  const inviteCode = code.trim();

  if (!inviteCode) {
    throw new Error('Введите код приглашения.');
  }

  const { data, error } = await supabase.rpc('accept_invite', {
    invite_code: inviteCode,
  });

  if (error) {
    throw new Error(error.message);
  }

  return data as CommunityMembership;
}

export async function loadMyMembership(): Promise<CommunityMembership | null> {
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();

  if (sessionError) {
    throw new Error(sessionError.message);
  }

  const userId = sessionData.session?.user.id;

  if (!userId) {
    return null;
  }

  const { data, error } = await supabase
    .from('community_memberships')
    .select(MEMBERSHIP_FIELDS)
    .eq('user_id', userId)
    .eq('status', 'active')
    .order('joined_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return data as CommunityMembership | null;
}
