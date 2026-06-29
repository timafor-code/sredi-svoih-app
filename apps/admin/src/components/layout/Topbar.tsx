import type { AdminProfile, AdminRole } from "../../types/auth";
import { Button } from "../ui/Button";

type TopbarProps = {
  sectionTitle: string;
  profile: AdminProfile | null;
  role: AdminRole;
  onCreateEvent: () => void;
  onSignOut: () => void;
  sessionEmail: string | null;
};

export function Topbar({
  sectionTitle,
  profile,
  role,
  onCreateEvent,
  onSignOut,
  sessionEmail,
}: TopbarProps) {
  const userLabel = getProfileLabel(profile, sessionEmail);

  return (
    <header className="topbar">
      <div className="topbar__breadcrumbs" aria-label="Хлебные крошки">
        <span>Admin Center</span>
        <span className="topbar__separator">/</span>
        <strong>{sectionTitle}</strong>
      </div>

      <label className="topbar__search">
        <span aria-hidden="true">⌕</span>
        <input aria-label="Глобальный поиск" placeholder="Поиск по админке" readOnly />
      </label>

      <div className="topbar__actions">
        <Button onClick={onCreateEvent} variant="success">
          Создать событие
        </Button>
        <div className="topbar__user" title={userLabel}>
          <strong>{userLabel}</strong>
          <span>{role}</span>
        </div>
        <Button onClick={onSignOut} variant="ghost">
          Выйти
        </Button>
      </div>
    </header>
  );
}

function getProfileLabel(profile: AdminProfile | null, sessionEmail: string | null): string {
  const fullName = [profile?.first_name, profile?.last_name].filter(Boolean).join(" ").trim();

  return (
    profile?.display_name ??
    profile?.full_name ??
    (fullName || null) ??
    profile?.email ??
    sessionEmail ??
    "Пользователь"
  );
}
