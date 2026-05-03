import { getVisibleNavigationGroups } from "../../data/navigation";
import type { AdminMembership, AdminProfile, AdminRole } from "../../types/auth";
import type { AdminSection } from "../../types/admin";
import { Badge } from "../ui/Badge";

type SidebarProps = {
  activeSection: AdminSection;
  membership: AdminMembership | null;
  profile: AdminProfile | null;
  role: AdminRole;
  onSectionChange: (section: AdminSection) => void;
};

export function Sidebar({ activeSection, membership, profile, role, onSectionChange }: SidebarProps) {
  const groups = getVisibleNavigationGroups(role);
  const userInitials = getUserInitials(profile);

  return (
    <aside className="sidebar" aria-label="Навигация Admin Center">
      <div className="sidebar__brand">
        <div className="sidebar__logo" aria-hidden="true">
          СС
        </div>
        <div>
          <strong>Среди Своих</strong>
          <span>Admin Center</span>
        </div>
      </div>

      <nav className="sidebar__nav">
        {groups.length === 0 ? (
          <div className="sidebar__locked">
            <span>Нет доступа</span>
            <p>Выберите роль администратора или менеджера событий.</p>
          </div>
        ) : (
          groups.map((group) => (
            <div className="sidebar__group" key={group.label}>
              <div className="sidebar__group-label">{group.label}</div>
              {group.items.map((item) => (
                <button
                  aria-current={activeSection === item.section ? "page" : undefined}
                  className={[
                    "sidebar__item",
                    activeSection === item.section ? "sidebar__item--active" : "",
                    item.isFuture ? "sidebar__item--future" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  key={item.section}
                  onClick={() => onSectionChange(item.section)}
                  type="button"
                >
                  <span className="sidebar__item-icon" aria-hidden="true">
                    {item.icon}
                  </span>
                  <span className="sidebar__item-label">{item.label}</span>
                  {item.badge ? <span className="sidebar__item-badge">{item.badge}</span> : null}
                  {item.isFuture ? <Badge tone="blue">позже</Badge> : null}
                </button>
              ))}
            </div>
          ))
        )}
      </nav>

      <div className="sidebar__footer">
        <span>Община</span>
        <strong className="sidebar__community" title={membership?.community_id ?? undefined}>
          {membership?.community_id ?? "Не выбрана"}
        </strong>
        <div className="sidebar__user">
          <div className="sidebar__avatar" aria-hidden="true">
            {userInitials}
          </div>
          <div>
            <strong>{role}</strong>
            <span>{membership?.status ?? "нет active membership"}</span>
          </div>
        </div>
      </div>
    </aside>
  );
}

function getUserInitials(profile: AdminProfile | null): string {
  const name =
    profile?.display_name ??
    profile?.full_name ??
    [profile?.first_name, profile?.last_name].filter(Boolean).join(" ").trim();
  const source = name || profile?.email || "AD";
  const parts = source.trim().split(/\s+/).filter(Boolean);

  if (parts.length >= 2) {
    return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  }

  return source.slice(0, 2).toUpperCase();
}
