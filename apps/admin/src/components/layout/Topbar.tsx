import { adminRoles } from "../../data/navigation";
import type { AdminRole } from "../../types/admin";
import { Button } from "../ui/Button";

type TopbarProps = {
  sectionTitle: string;
  role: AdminRole;
  onImportClick: () => void;
  onRoleChange: (role: AdminRole) => void;
};

export function Topbar({ sectionTitle, role, onImportClick, onRoleChange }: TopbarProps) {
  const handleCreateEvent = () => {
    window.alert("Будет добавлено позже");
  };

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
        <Button onClick={handleCreateEvent} variant="primary">
          Создать событие
        </Button>
        <Button onClick={onImportClick} variant="secondary">
          Проверить импорт
        </Button>
        <label className="role-select">
          <span>Роль</span>
          <select
            aria-label="Роль прототипа"
            onChange={(event) => onRoleChange(event.target.value as AdminRole)}
            value={role}
          >
            {adminRoles.map((adminRole) => (
              <option key={adminRole} value={adminRole}>
                {adminRole}
              </option>
            ))}
          </select>
        </label>
      </div>
    </header>
  );
}
