import { mockMembers } from "../data/mockAdmin";
import { Badge } from "../components/ui/Badge";
import { GlassCard } from "../components/ui/GlassCard";

const roleTone = {
  admin: "red",
  event_manager: "gold",
  member: "muted",
} as const;

export function MembersPage() {
  return (
    <div className="page-stack">
      <section className="page-header">
        <Badge tone="red">admin</Badge>
        <h1>Участники</h1>
        <p>Mock-список ролей для визуальной проверки доступа в shell.</p>
      </section>

      <GlassCard className="table-panel" elevated>
        <div className="data-table data-table--members" role="table" aria-label="Участники">
          <div className="data-table__row data-table__row--head" role="row">
            <span role="columnheader">Участник</span>
            <span role="columnheader">Email</span>
            <span role="columnheader">Роль</span>
            <span role="columnheader">Статус</span>
          </div>
          {mockMembers.map((member) => (
            <div className="data-table__row" key={member.email} role="row">
              <strong role="cell">{member.name}</strong>
              <span role="cell">{member.email}</span>
              <span role="cell">
                <Badge tone={roleTone[member.role]}>{member.role}</Badge>
              </span>
              <span role="cell">{member.status}</span>
            </div>
          ))}
        </div>
      </GlassCard>
    </div>
  );
}
