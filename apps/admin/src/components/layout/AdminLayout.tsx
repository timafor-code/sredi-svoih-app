import { Menu, X } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useId, useRef, useState } from "react";

import { getSectionTitle, getVisibleNavigationGroups } from "../../data/navigation";
import type { AdminMembership, AdminProfile, AdminRole } from "../../types/auth";
import type { AdminSection } from "../../types/admin";
import { AdminFeedbackButton } from "../feedback/AdminFeedbackButton";
import { AdminFeedbackDialog } from "../feedback/AdminFeedbackDialog";
import { Button } from "../ui/Button";
import { Sidebar } from "./Sidebar";
import { getProfileLabel, Topbar } from "./Topbar";

// Keep this query aligned with the mobile shell breakpoint in globals.css.
const MOBILE_SHELL_QUERY = "(max-width: 960px)";

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
  profile,
  role,
  onSectionChange,
  onSignOut,
  sessionEmail,
}: AdminLayoutProps) {
  const sectionTitle = getSectionTitle(activeSection);
  const mobileItems = getVisibleNavigationGroups(role)
    .flatMap((group) => group.items)
    .filter((item) => item.section === "events" || item.section === "registrations");
  const [isMobileDrawerOpen, setIsMobileDrawerOpen] = useState(false);
  const mobileDrawerId = useId();
  const mobileDrawerTitleId = useId();
  const mobileDrawerRef = useRef<HTMLDialogElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const contentRef = useRef<HTMLElement>(null);
  const [isFeedbackDialogOpen, setIsFeedbackDialogOpen] = useState(false);
  const canSubmitFeedback = role === "admin" || role === "event_manager";
  const openFeedbackDialog = useCallback(() => {
    setIsFeedbackDialogOpen(true);
  }, []);
  const closeFeedbackDialog = useCallback(() => {
    setIsFeedbackDialogOpen(false);
  }, []);
  const closeMobileDrawer = useCallback(() => {
    setIsMobileDrawerOpen(false);
  }, []);

  useEffect(() => {
    const media = window.matchMedia(MOBILE_SHELL_QUERY);
    const handleLayoutChange = () => {
      if (!media.matches) {
        closeMobileDrawer();
      }
    };
    media.addEventListener("change", handleLayoutChange);
    return () => media.removeEventListener("change", handleLayoutChange);
  }, [closeMobileDrawer]);

  useEffect(() => {
    const dialog = mobileDrawerRef.current;
    if (!isMobileDrawerOpen || !dialog) {
      return;
    }
    if (!window.matchMedia(MOBILE_SHELL_QUERY).matches) {
      closeMobileDrawer();
      return;
    }

    // Native modality contains keyboard focus and makes the background inert.
    dialog.showModal();
    closeButtonRef.current?.focus({ preventScroll: true });
    const scrollContainers = [document.documentElement, document.body, contentRef.current]
      .filter((element): element is HTMLElement => element !== null);
    const previousOverflow = scrollContainers.map((element) => element.style.overflowY);
    scrollContainers.forEach((element) => { element.style.overflowY = "hidden"; });
    const menuButton = menuButtonRef.current;

    return () => {
      dialog.close();
      scrollContainers.forEach((element, index) => {
        element.style.overflowY = previousOverflow[index];
      });
      if (menuButton?.isConnected && menuButton.getClientRects().length > 0) {
        menuButton.focus({ preventScroll: true });
      }
    };
  }, [isMobileDrawerOpen, closeMobileDrawer]);

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
        <header className="admin-mobile-header">
          <button
            aria-controls={mobileDrawerId}
            aria-expanded={isMobileDrawerOpen}
            aria-haspopup="dialog"
            aria-label="Открыть меню Admin Center"
            className="admin-mobile-menu-button"
            onClick={() => setIsMobileDrawerOpen(true)}
            ref={menuButtonRef}
            type="button"
          >
            <Menu aria-hidden="true" size={22} />
          </button>
          <strong className="admin-mobile-header__title">{sectionTitle}</strong>
        </header>
        <Topbar
          onCreateEvent={onCreateEvent}
          onSignOut={onSignOut}
          profile={profile}
          role={role}
          sectionTitle={sectionTitle}
          sessionEmail={sessionEmail}
        />
        <main className="admin-layout__content" ref={contentRef}>{children}</main>
        {canSubmitFeedback ? <AdminFeedbackButton onClick={openFeedbackDialog} /> : null}
        {canSubmitFeedback && isFeedbackDialogOpen ? (
          <AdminFeedbackDialog
            communityId={membership?.community_id ?? null}
            onClose={closeFeedbackDialog}
            section={activeSection}
            sectionTitle={sectionTitle}
          />
        ) : null}
      </div>
      <dialog
        aria-labelledby={mobileDrawerTitleId}
        aria-modal="true"
        className="admin-mobile-drawer"
        id={mobileDrawerId}
        onCancel={(event) => {
          event.preventDefault();
          closeMobileDrawer();
        }}
        onClick={(event) => {
          if (event.target === event.currentTarget) {
            closeMobileDrawer();
          }
        }}
        ref={mobileDrawerRef}
      >
        <div className="admin-mobile-drawer__panel">
          <div className="admin-mobile-drawer__head">
            <strong id={mobileDrawerTitleId}>Меню Admin Center</strong>
            <button
              aria-label="Закрыть меню Admin Center"
              className="admin-mobile-menu-button"
              onClick={closeMobileDrawer}
              ref={closeButtonRef}
              type="button"
            >
              <X aria-hidden="true" size={22} />
            </button>
          </div>
          <nav aria-label="Основная мобильная навигация" className="admin-mobile-drawer__nav">
            {mobileItems.length === 0 ? <p className="sidebar__locked">Нет доступа</p> : (
              mobileItems.map((item) => (
                <button
                  aria-current={activeSection === item.section ? "page" : undefined}
                  className={`sidebar__item${activeSection === item.section ? " sidebar__item--active" : ""}`}
                  key={item.section}
                  onClick={() => {
                    onSectionChange(item.section);
                    closeMobileDrawer();
                  }}
                  type="button"
                >
                  <span aria-hidden="true" className="sidebar__item-icon">{item.icon}</span>
                  <span className="sidebar__item-label">{item.label}</span>
                </button>
              ))
            )}
          </nav>
          <div className="admin-mobile-drawer__user">
            <strong>{getProfileLabel(profile, sessionEmail)}</strong>
            <span>{role}</span>
            <span>{membership?.status ?? "нет active membership"}</span>
            <Button onClick={() => {
              closeMobileDrawer();
              onSignOut();
            }} variant="ghost">
              Выйти
            </Button>
          </div>
        </div>
      </dialog>
    </div>
  );
}
