import { GlassCard } from "../components/ui/GlassCard";

export function ConfigMissingPage() {
  return (
    <main className="auth-screen">
      <GlassCard className="config-card" elevated>
        <div className="auth-kicker">Supabase</div>
        <h1>Не настроено подключение к Supabase</h1>
        <p>Создайте apps/admin/.env.local на основе apps/admin/.env.example</p>
      </GlassCard>
    </main>
  );
}
