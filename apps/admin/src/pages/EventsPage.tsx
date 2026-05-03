import { mockEvents } from "../data/mockAdmin";
import { Badge } from "../components/ui/Badge";
import { GlassCard } from "../components/ui/GlassCard";

export function EventsPage() {
  return (
    <div className="page-stack">
      <section className="page-header">
        <Badge tone="green">mock</Badge>
        <h1>События</h1>
        <p>Реальный список событий будет подключён к Supabase в отдельном PR.</p>
      </section>

      <GlassCard className="table-panel" elevated>
        <div className="table-panel__header">
          <h2>Список событий</h2>
          <Badge tone="glass">static preview</Badge>
        </div>
        <div className="data-table" role="table" aria-label="События">
          <div className="data-table__row data-table__row--head" role="row">
            <span role="columnheader">Название</span>
            <span role="columnheader">Дата</span>
            <span role="columnheader">Категория</span>
            <span role="columnheader">Статусы</span>
          </div>
          {mockEvents.map((event) => (
            <div className="data-table__row" key={event.title} role="row">
              <strong role="cell">{event.title}</strong>
              <span role="cell">{event.date}</span>
              <span role="cell">{event.category}</span>
              <span className="badge-row" role="cell">
                {event.badges.map((badge) => (
                  <Badge key={badge.label} tone={badge.tone}>
                    {badge.label}
                  </Badge>
                ))}
              </span>
            </div>
          ))}
        </div>
      </GlassCard>
    </div>
  );
}
