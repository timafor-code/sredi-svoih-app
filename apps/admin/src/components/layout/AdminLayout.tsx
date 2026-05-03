import type { ReactNode } from "react";

import { getSectionTitle } from "../../data/navigation";
import type { AdminMembership, AdminProfile, AdminRole } from "../../types/auth";
import type { AdminSection } from "../../types/admin";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";

type AdminLayoutProps = {
  activeSection: AdminSection;
  children: ReactNode;
  membership: AdminMembership | null;
  profile: AdminProfile | null;
  role: AdminRole;
  onSectionChange: (section: AdminSection) => void;
  onSignOut: () => void;
  sessionEmail: string | null;
};

export function AdminLayout({
  activeSection,
  children,
  membership,
  profile,
  role,
  onSectionChange,
  onSignOut,
  sessionEmail,
}: AdminLayoutProps) {
  const sectionTitle = getSectionTitle(activeSection);

  return (
    <div className="admin-layout">
      <Sidebar
        activeSection={activeSection}
        membership={membership}
        onSectionChange={onSectionChange}
        profile={profile}
        role={role}
      />
      <div className="admin-layout__main">
        <Topbar
          onImportClick={() => onSectionChange("import")}
          onSignOut={onSignOut}
          profile={profile}
          role={role}
          sectionTitle={sectionTitle}
          sessionEmail={sessionEmail}
        />
        <main className="admin-layout__content">{children}</main>
      </div>
    </div>
  );
}
