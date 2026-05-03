import type { ReactNode } from "react";

import { getSectionTitle } from "../../data/navigation";
import type { AdminRole, AdminSection } from "../../types/admin";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";

type AdminLayoutProps = {
  activeSection: AdminSection;
  children: ReactNode;
  role: AdminRole;
  onRoleChange: (role: AdminRole) => void;
  onSectionChange: (section: AdminSection) => void;
};

export function AdminLayout({
  activeSection,
  children,
  role,
  onRoleChange,
  onSectionChange,
}: AdminLayoutProps) {
  const sectionTitle = role === "member" ? "Нет доступа" : getSectionTitle(activeSection);

  return (
    <div className="admin-layout">
      <Sidebar activeSection={activeSection} onSectionChange={onSectionChange} role={role} />
      <div className="admin-layout__main">
        <Topbar
          onImportClick={() => onSectionChange("import")}
          onRoleChange={onRoleChange}
          role={role}
          sectionTitle={sectionTitle}
        />
        <main className="admin-layout__content">{children}</main>
      </div>
    </div>
  );
}
