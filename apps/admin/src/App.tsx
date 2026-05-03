import { useEffect, useState } from "react";

import { AdminLayout } from "./components/layout/AdminLayout";
import { canRoleOpenSection, isFutureSection } from "./data/navigation";
import type { AdminRole, AdminSection } from "./types/admin";
import { EventsPage } from "./pages/EventsPage";
import { FuturePage } from "./pages/FuturePage";
import { ImportReviewPage } from "./pages/ImportReviewPage";
import { InvitesPage } from "./pages/InvitesPage";
import { MembersPage } from "./pages/MembersPage";
import { NoAccessPage } from "./pages/NoAccessPage";
import { OverviewPage } from "./pages/OverviewPage";
import { RegistrationsPage } from "./pages/RegistrationsPage";
import { SettingsPage } from "./pages/SettingsPage";

export default function App() {
  const [activeSection, setActiveSection] = useState<AdminSection>("overview");
  const [role, setRole] = useState<AdminRole>("admin");

  useEffect(() => {
    if (role !== "member" && !canRoleOpenSection(role, activeSection)) {
      setActiveSection("overview");
    }
  }, [activeSection, role]);

  const page = renderPage(activeSection, role);

  return (
    <AdminLayout
      activeSection={activeSection}
      onRoleChange={setRole}
      onSectionChange={setActiveSection}
      role={role}
    >
      {page}
    </AdminLayout>
  );
}

function renderPage(activeSection: AdminSection, role: AdminRole) {
  if (role === "member" || !canRoleOpenSection(role, activeSection)) {
    return <NoAccessPage />;
  }

  if (isFutureSection(activeSection)) {
    return <FuturePage section={activeSection} />;
  }

  switch (activeSection) {
    case "overview":
      return <OverviewPage />;
    case "events":
      return <EventsPage />;
    case "import":
      return <ImportReviewPage />;
    case "registrations":
      return <RegistrationsPage />;
    case "members":
      return <MembersPage />;
    case "invites":
      return <InvitesPage />;
    case "settings":
      return <SettingsPage />;
    default:
      return <FuturePage section={activeSection} />;
  }
}
