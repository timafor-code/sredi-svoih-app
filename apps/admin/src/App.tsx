import { useCallback, useEffect, useState } from "react";

import { AdminLayout } from "./components/layout/AdminLayout";
import { AdminAuthProvider } from "./context/AdminAuthContext";
import { canRoleOpenSection, isFutureSection } from "./data/navigation";
import { useAdminAuth } from "./store/useAdminAuth";
import type { AdminRole } from "./types/auth";
import type { AdminSection } from "./types/admin";
import { ConfigMissingPage } from "./pages/ConfigMissingPage";
import { EventsPage } from "./pages/EventsPage";
import { FuturePage } from "./pages/FuturePage";
import { ImportReviewPage } from "./pages/ImportReviewPage";
import { InvitesPage } from "./pages/InvitesPage";
import { LoginPage } from "./pages/LoginPage";
import { MembersPage } from "./pages/MembersPage";
import { NoAccessPage } from "./pages/NoAccessPage";
import { OverviewPage } from "./pages/OverviewPage";
import { RegistrationsPage } from "./pages/RegistrationsPage";
import { SettingsPage } from "./pages/SettingsPage";

export default function App() {
  return (
    <AdminAuthProvider>
      <AdminApp />
    </AdminAuthProvider>
  );
}

function AdminApp() {
  const auth = useAdminAuth();
  const [activeSection, setActiveSection] = useState<AdminSection>("overview");
  const [importReviewRefreshSignal, setImportReviewRefreshSignal] = useState(0);
  const role = auth.role ?? "member";

  const handleImportReviewRefresh = useCallback(() => {
    setImportReviewRefreshSignal((current) => current + 1);
  }, []);

  useEffect(() => {
    if (role !== "member" && !canRoleOpenSection(role, activeSection)) {
      setActiveSection("overview");
    }
  }, [activeSection, role]);

  if (auth.configMissing) {
    return <ConfigMissingPage />;
  }

  if (auth.loading && !auth.session) {
    return <AuthStatusScreen />;
  }

  if (!auth.isAuthenticated) {
    return <LoginPage />;
  }

  if (!auth.canAccessAdmin) {
    return <NoAccessPage />;
  }

  const page = renderPage(activeSection, role, importReviewRefreshSignal);

  return (
    <AdminLayout
      activeSection={activeSection}
      membership={auth.membership}
      onImportReviewRefresh={handleImportReviewRefresh}
      onSectionChange={setActiveSection}
      onSignOut={auth.signOut}
      profile={auth.profile}
      role={role}
      sessionEmail={auth.session?.user.email ?? null}
    >
      {page}
    </AdminLayout>
  );
}

function AuthStatusScreen() {
  return (
    <main className="auth-screen">
      <div className="auth-loading">Загружаем доступ...</div>
    </main>
  );
}

function renderPage(
  activeSection: AdminSection,
  role: AdminRole,
  importReviewRefreshSignal: number,
) {
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
      return <ImportReviewPage refreshSignal={importReviewRefreshSignal} />;
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
