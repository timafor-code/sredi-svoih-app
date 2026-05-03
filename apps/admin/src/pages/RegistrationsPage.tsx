import { registrationPreview } from "../data/mockAdmin";
import { Badge } from "../components/ui/Badge";
import { GlassCard } from "../components/ui/GlassCard";

export function RegistrationsPage() {
  return (
    <div className="page-stack">
      <section className="page-header">
        <Badge tone="blue">mock</Badge>
        <h1>Регистрации</h1>
        <p>Здесь появится очередь заявок и выбранные варианты участия.</p>
      </section>

      <GlassCard className="registration-card" elevated>
        <div className="registration-card__head">
          <div>
            <span>{registrationPreview.eventTitle}</span>
            <h2>{registrationPreview.person}</h2>
          </div>
          <Badge tone="gold">{registrationPreview.status}</Badge>
        </div>
        <div className="option-list">
          {registrationPreview.options.map((option) => (
            <div className="option-list__item" key={option}>
              {option}
            </div>
          ))}
        </div>
      </GlassCard>
    </div>
  );
}
