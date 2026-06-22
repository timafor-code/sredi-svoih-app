import { Badge } from "../components/ui/Badge";
import { GlassCard } from "../components/ui/GlassCard";
import { canRoleOpenSection, getNavigationItem } from "../data/navigation";
import { useAdminAuth } from "../store/useAdminAuth";
import type { AdminSection } from "../types/admin";
import type { AdminProfile, AdminRole } from "../types/auth";

const quickLinkSections: Array<{
  section: AdminSection;
  note: string;
}> = [
  {
    section: "events",
    note: "Список событий и базовое редактирование через текущий beta flow.",
  },
  {
    section: "categories",
    note: "Категории событий в рамках текущей community.",
  },
  {
    section: "import",
    note: "Review очереди импорта; сам импорт пока запускается вне browser-admin.",
  },
];

const testingItems = [
  "Вход и выход для active admin и active event_manager.",
  "Роль, community и membership текущей сессии отображаются без подмены моками.",
  "event_manager видит только разрешённые разделы и не видит admin-only shortcuts.",
  "Очередь import review доступна для проверки результатов CLI/dev импорта.",
];

const notProductionItems = [
  "Overview не является analytics dashboard и не показывает KPI, графики или прогнозы.",
  "Импорт с сайта в Phase 1 выполняется владельцем проекта через CLI/dev flow.",
  "Beta staging предназначен для закрытой проверки доступа и основных admin flows.",
];

const roleNotes: Record<AdminRole, string> = {
  admin: "Полный beta-доступ к admin разделам.",
  event_manager: "Доступ к событиям, категориям, import review и регистрациям без admin-only разделов.",
  member: "Нет доступа к web-admin beta.",
};

export function OverviewPage() {
  const auth = useAdminAuth();
  const role = auth.role ?? auth.membership?.role ?? "member";
  const userLabel = getUserLabel(auth.profile, auth.session?.user.email ?? null);
  const userEmail = auth.profile?.email ?? auth.session?.user.email ?? "email не найден";
  const communityId = auth.membership?.community_id ?? "community не выбрана";
  const membershipStatus = auth.membership?.status ?? "membership не найдена";
  const quickLinks = quickLinkSections
    .filter((link) => canRoleOpenSection(role, link.section))
    .map((link) => ({
      ...link,
      label: getNavigationItem(link.section)?.label ?? link.section,
    }));

  return (
    <div className="page-stack">
      <section className="page-header">
        <Badge tone="blue">server beta v1</Badge>
        <h1>Обзор</h1>
        <p>
          Стартовая страница beta без fake dashboard: здесь показан текущий доступ,
          роль и community активной Supabase session.
        </p>
      </section>

      <section className="overview-identity-grid" aria-label="Текущий доступ">
        <GlassCard className="overview-fact-card" elevated>
          <span>Текущий user</span>
          <strong>{userLabel}</strong>
          <p>{userEmail}</p>
        </GlassCard>

        <GlassCard className="overview-fact-card" elevated>
          <span>Role</span>
          <strong>{role}</strong>
          <p>{roleNotes[role]}</p>
        </GlassCard>

        <GlassCard className="overview-fact-card" elevated>
          <span>Community</span>
          <strong title={communityId}>{communityId}</strong>
          <p>{membershipStatus}</p>
        </GlassCard>
      </section>

      <section className="content-grid content-grid--wide-left">
        <GlassCard className="overview-panel">
          <div className="section-title">
            <h2>Быстрые ссылки</h2>
            <Badge tone="gold">role-based</Badge>
          </div>
          <p className="overview-helper">
            Откройте эти разделы через левое меню. Список фильтруется по текущей роли.
          </p>
          <ul className="overview-link-list">
            {quickLinks.map((link) => (
              <li key={link.section}>
                <strong>{link.label}</strong>
                <span>{link.note}</span>
              </li>
            ))}
          </ul>
        </GlassCard>

        <GlassCard className="overview-panel overview-panel--note">
          <div className="section-title">
            <h2>Что пока не production</h2>
            <Badge tone="red">beta</Badge>
          </div>
          <ul className="soft-list">
            {notProductionItems.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </GlassCard>
      </section>

      <section className="content-grid">
        <GlassCard className="overview-panel">
          <div className="section-title">
            <h2>Что тестировать</h2>
            <Badge tone="green">manual</Badge>
          </div>
          <ul className="soft-list">
            {testingItems.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </GlassCard>
      </section>
    </div>
  );
}

function getUserLabel(profile: AdminProfile | null, email: string | null): string {
  const fullName = [profile?.first_name, profile?.last_name].filter(Boolean).join(" ").trim();

  return (
    profile?.display_name ??
    profile?.full_name ??
    (fullName || null) ??
    profile?.email ??
    email ??
    "Пользователь"
  );
}
