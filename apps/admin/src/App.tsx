import { useCallback, useEffect, useState } from "react";

import { AdminLayout } from "./components/layout/AdminLayout";
import { AdminAuthProvider } from "./context/AdminAuthContext";
import { canRoleOpenSection, isFutureSection } from "./data/navigation";
import { useAdminAuth } from "./store/useAdminAuth";
import type { AdminRole } from "./types/auth";
import type { AdminSection } from "./types/admin";
import type { AdminEvent } from "./types/events";
import { CategoriesPage } from "./pages/CategoriesPage";
import { ConfigMissingPage } from "./pages/ConfigMissingPage";
import { CreateEventPage } from "./pages/CreateEventPage";
import { EditEventPage } from "./pages/EditEventPage";
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
  const [isCreatingEvent, setIsCreatingEvent] = useState(false);
  const [editingEvent, setEditingEvent] = useState<AdminEvent | null>(null);
  const [eventsRefreshSignal, setEventsRefreshSignal] = useState(0);
  const [importReviewRefreshSignal, setImportReviewRefreshSignal] = useState(0);
  const role = auth.role ?? "member";

  const handleSectionChange = useCallback((section: AdminSection) => {
    setActiveSection(section);
    setIsCreatingEvent(false);
    setEditingEvent(null);
  }, []);

  const handleCreateEvent = useCallback(() => {
    setActiveSection("events");
    setIsCreatingEvent(true);
    setEditingEvent(null);
  }, []);

  const handleEventCreated = useCallback(() => {
    setEventsRefreshSignal((current) => current + 1);
  }, []);

  const handleImportEventCreated = useCallback(() => {
    setEventsRefreshSignal((current) => current + 1);
  }, []);

  const handleEditEvent = useCallback((event: AdminEvent) => {
    setActiveSection("events");
    setIsCreatingEvent(false);
    setEditingEvent(event);
  }, []);

  const handleEventSaved = useCallback((event: AdminEvent) => {
    setEditingEvent(event);
    setEventsRefreshSignal((current) => current + 1);
  }, []);

  const handleBackToEventsList = useCallback(() => {
    setIsCreatingEvent(false);
    setEditingEvent(null);
  }, []);

  const handleOpenEventsList = useCallback(() => {
    setActiveSection("events");
    setIsCreatingEvent(false);
    setEditingEvent(null);
  }, []);

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

  const page = renderPage(
    activeSection,
    role,
    isCreatingEvent,
    editingEvent,
    eventsRefreshSignal,
    importReviewRefreshSignal,
    handleCreateEvent,
    handleEventCreated,
    handleEditEvent,
    handleEventSaved,
    handleBackToEventsList,
    handleImportEventCreated,
    handleOpenEventsList,
  );

  return (
    <AdminLayout
      activeSection={activeSection}
      membership={auth.membership}
      onCreateEvent={handleCreateEvent}
      onImportReviewRefresh={handleImportReviewRefresh}
      onSectionChange={handleSectionChange}
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
  isCreatingEvent: boolean,
  editingEvent: AdminEvent | null,
  eventsRefreshSignal: number,
  importReviewRefreshSignal: number,
  onCreateEvent: () => void,
  onEventCreated: () => void,
  onEditEvent: (event: AdminEvent) => void,
  onEventSaved: (event: AdminEvent) => void,
  onBackToEventsList: () => void,
  onImportEventCreated: (event: AdminEvent) => void,
  onOpenEventsList: () => void,
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
      if (isCreatingEvent) {
        return (
          <CreateEventPage onBackToList={onBackToEventsList} onCreated={onEventCreated} />
        );
      }

      if (editingEvent) {
        return (
          <EditEventPage
            event={editingEvent}
            onBackToList={onBackToEventsList}
            onSaved={onEventSaved}
          />
        );
      }

      return (
        <EventsPage
          onCreateEvent={onCreateEvent}
          onEditEvent={onEditEvent}
          refreshSignal={eventsRefreshSignal}
        />
      );
    case "categories":
      return <CategoriesPage />;
    case "import":
      return (
        <ImportReviewPage
          onEventCreated={onImportEventCreated}
          onOpenEvent={onEditEvent}
          onOpenEventsList={onOpenEventsList}
          refreshSignal={importReviewRefreshSignal}
        />
      );
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
