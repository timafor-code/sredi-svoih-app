import { importReviewItems } from "../data/mockAdmin";
import { Badge } from "../components/ui/Badge";
import { GlassCard } from "../components/ui/GlassCard";

export function ImportReviewPage() {
  return (
    <div className="page-stack">
      <section className="page-header">
        <Badge tone="red">review</Badge>
        <h1>Импорт с сайта</h1>
        <p>Будущий flow: website → event_import_items → review → events.</p>
      </section>

      <div className="import-flow" aria-label="Flow импорта">
        <span>website</span>
        <span>event_import_items</span>
        <span>review</span>
        <span>events</span>
      </div>

      <section className="card-grid card-grid--three" aria-label="Проверка импорта">
        {importReviewItems.map((item) => (
          <GlassCard className="issue-card" key={item.title} elevated>
            <Badge tone={item.tone}>{item.title}</Badge>
            <h2>{item.source}</h2>
            <p>{item.detail}</p>
          </GlassCard>
        ))}
      </section>
    </div>
  );
}
