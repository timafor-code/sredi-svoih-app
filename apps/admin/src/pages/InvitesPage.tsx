import { mockInvites } from "../data/mockAdmin";
import { Badge } from "../components/ui/Badge";
import { GlassCard } from "../components/ui/GlassCard";

export function InvitesPage() {
  return (
    <div className="page-stack">
      <section className="page-header">
        <Badge tone="gold">mock</Badge>
        <h1>Приглашения</h1>
        <p>Коды ниже статичны и нужны только для проверки визуального shell.</p>
      </section>

      <section className="card-grid card-grid--two" aria-label="Invite codes">
        {mockInvites.map((invite) => (
          <GlassCard className="invite-card" key={invite.code} elevated>
            <code>{invite.code}</code>
            <div>
              <Badge tone={invite.role === "event_manager" ? "gold" : "muted"}>{invite.role}</Badge>
              <span>{invite.usage}</span>
            </div>
          </GlassCard>
        ))}
      </section>
    </div>
  );
}
