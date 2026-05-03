import { communitySettings } from "../data/mockAdmin";
import { Badge } from "../components/ui/Badge";
import { GlassCard } from "../components/ui/GlassCard";

export function SettingsPage() {
  return (
    <div className="page-stack">
      <section className="page-header">
        <Badge tone="glass">mock</Badge>
        <h1>Настройки</h1>
        <p>Базовые настройки общины будут сохранены в production-контуре позже.</p>
      </section>

      <GlassCard className="settings-list" elevated>
        {communitySettings.map((setting) => (
          <div className="settings-list__row" key={setting.label}>
            <span>{setting.label}</span>
            <strong>{setting.value}</strong>
          </div>
        ))}
      </GlassCard>
    </div>
  );
}
