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

const adminEnvLabel = getOptionalEnvLabel(import.meta.env.VITE_ADMIN_ENV_LABEL);

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
  const displayName = getProfileDisplayName(profile);
  const email = getFirstNonEmptyLabel(profile?.email, sessionEmail) ?? "email не найден";
  const communityLabel = getCommunityLabel(membership);
  const contextTitle = [
    displayName ? `Name: ${displayName}` : null,
    `Email: ${email}`,
    `Role: ${role}`,
    `Community: ${communityLabel}`,
    adminEnvLabel ? `Env: ${adminEnvLabel}` : null,
  ]
    .filter(Boolean)
    .join(" | ");
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
        <section
          aria-label="Контекст текущего пользователя"
          className="admin-current-context"
          title={contextTitle}
        >
          <div className="admin-current-context__identity">
            {displayName ? <strong>{displayName}</strong> : null}
            <span>{email}</span>
          </div>
          <dl className="admin-current-context__meta">
            <div>
              <dt>Role</dt>
              <dd>{role}</dd>
            </div>
            <div>
              <dt>Community</dt>
              <dd title={communityLabel}>{communityLabel}</dd>
            </div>
            {adminEnvLabel ? (
              <div>
                <dt>Env</dt>
                <dd>{adminEnvLabel}</dd>
              </div>
            ) : null}
          </dl>
        </section>
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

function getOptionalEnvLabel(value: unknown): string | null {
  return typeof value === "string" ? getFirstNonEmptyLabel(value) : null;
}

function getProfileDisplayName(profile: AdminProfile | null): string | null {
  const fullName = [profile?.first_name, profile?.last_name].filter(Boolean).join(" ");

  return getFirstNonEmptyLabel(profile?.display_name, profile?.full_name, fullName);
}

function getCommunityLabel(membership: AdminMembership | null): string {
  return (
    getFirstNonEmptyLabel(
      membership?.community?.name,
      membership?.community_name,
      membership?.community_id,
      membership?.community?.id,
    ) ?? "community не выбрана"
  );
}

function getFirstNonEmptyLabel(...values: Array<string | null | undefined>): string | null {
  for (const value of values) {
    const trimmed = value?.trim();

    if (trimmed) {
      return trimmed;
    }
  }

  return null;
}
