import { Badge } from "../components/ui/Badge";
import { EmptyState } from "../components/ui/EmptyState";

export function InvitesPage() {
  return (
    <div className="page-stack page-stack--center">
      <EmptyState
        description="Invite backend и UI выдачи кодов не входят в beta v1. Beta-доступ выдаётся вручную владельцем или админом через Supabase Auth, profiles и community_memberships."
        title="Приглашения"
      >
        <Badge tone="blue">позже</Badge>
      </EmptyState>
    </div>
  );
}
