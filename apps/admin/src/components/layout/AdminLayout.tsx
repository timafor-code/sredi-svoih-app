import { type ReactNode, useCallback, useState } from "react";

import { getSectionTitle } from "../../data/navigation";
import type { AdminMembership, AdminProfile, AdminRole } from "../../types/auth";
import type { AdminSection } from "../../types/admin";
import { AdminFeedbackButton } from "../feedback/AdminFeedbackButton";
import { AdminFeedbackDialog } from "../feedback/AdminFeedbackDialog";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";

type AdminLayoutProps = {
  activeSection: AdminSection;
  children: ReactNode;
  membership: AdminMembership | null;
  profile: AdminProfile | null;
  role: AdminRole;
  onCreateEvent: () => void;
  onImportReviewRefresh: () => void;
  onSectionChange: (section: AdminSection) => void;
  onSignOut: () => void;
  sessionEmail: string | null;
};

export function AdminLayout({
  activeSection,
  children,
  membership,
  onCreateEvent,
  onImportReviewRefresh,
  profile,
  role,
  onSectionChange,
  onSignOut,
  sessionEmail,
}: AdminLayoutProps) {
  const sectionTitle = getSectionTitle(activeSection);
  const [isFeedbackDialogOpen, setIsFeedbackDialogOpen] = useState(false);
  const canSubmitFeedback = role === "admin" || role === "event_manager";
  const openFeedbackDialog = useCallback(() => {
    setIsFeedbackDialogOpen(true);
  }, []);
  const closeFeedbackDialog = useCallback(() => {
    setIsFeedbackDialogOpen(false);
  }, []);

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
          isImportSection={activeSection === "import"}
          onCreateEvent={onCreateEvent}
          onOpenImportReview={() => onSectionChange("import")}
          onRefreshImportReview={onImportReviewRefresh}
          onSignOut={onSignOut}
          profile={profile}
          role={role}
          sectionTitle={sectionTitle}
          sessionEmail={sessionEmail}
        />
        <main className="admin-layout__content">{children}</main>
        {canSubmitFeedback ? <AdminFeedbackButton onClick={openFeedbackDialog} /> : null}
        {canSubmitFeedback && isFeedbackDialogOpen ? (
          <AdminFeedbackDialog
            onClose={closeFeedbackDialog}
            section={activeSection}
            sectionTitle={sectionTitle}
          />
        ) : null}
      </div>
    </div>
  );
}
