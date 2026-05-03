import { nextSteps, overviewKpis } from "../data/mockAdmin";
import { Badge } from "../components/ui/Badge";
import { GlassCard } from "../components/ui/GlassCard";

export function OverviewPage() {
  return (
    <div className="page-stack">
      <section className="page-header">
        <Badge tone="red">visual shell</Badge>
        <h1>Обзор</h1>
        <p>Каркас web-админки перенесён из утверждённого прототипа в React-компоненты.</p>
      </section>

      <section className="kpi-grid" aria-label="Показатели">
        {overviewKpis.map((kpi) => (
          <GlassCard className={`kpi-card kpi-card--${kpi.tone}`} key={kpi.label} elevated>
            <span>{kpi.label}</span>
            <strong>{kpi.value}</strong>
            <p>{kpi.meta}</p>
          </GlassCard>
        ))}
      </section>

      <section className="content-grid content-grid--wide-left">
        <GlassCard>
          <div className="section-title">
            <h2>Следующие шаги</h2>
            <Badge tone="gold">roadmap</Badge>
          </div>
          <ul className="soft-list">
            {nextSteps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ul>
        </GlassCard>

        <GlassCard className="reference-card">
          <span>Full UX source of truth</span>
          <strong>HTML-прототип</strong>
          <code>docs/prototype/admin-events-center.html</code>
        </GlassCard>
      </section>
    </div>
  );
}
