import { useEffect, useRef, useState, type ReactNode } from "react";
import type { ExistingAccountIdentity } from "../types";

export function AccountPanel({
  identity,
  onDeleteAccount,
  onOpenTickets,
  onSignOut,
}: {
  identity: ExistingAccountIdentity;
  onDeleteAccount: () => void;
  onOpenTickets: () => void;
  onSignOut: () => void;
}): ReactNode {
  const panelRef = useRef<HTMLElement>(null);
  const deleteButtonRef = useRef<HTMLButtonElement>(null);
  const [managementOpen, setManagementOpen] = useState(false);
  const fullName = [identity.first_name, identity.last_name].filter(Boolean).join(" ");

  useEffect(() => {
    panelRef.current?.focus();
  }, []);

  return (
    <section
      ref={panelRef}
      className="surface account-panel"
      aria-labelledby="account-panel-heading"
      aria-live="polite"
      tabIndex={-1}
    >
      <div className="account-panel-copy">
        <div className="account-panel-heading-row">
          <h2 id="account-panel-heading">Аккаунт</h2>
          <span className="account-status">Вы вошли</span>
        </div>
        <strong className="account-panel-name">{fullName}</strong>
        <span className="account-panel-email">{identity.email}</span>
      </div>
      <div className="account-panel-actions">
        <button
          id="account-my-tickets-button"
          className="secondary-button"
          type="button"
          onClick={onOpenTickets}
        >
          Мои билеты
        </button>
        <button
          className="secondary-button"
          type="button"
          aria-expanded={managementOpen}
          aria-controls="account-management-actions"
          onClick={() => {
            setManagementOpen((open) => !open);
            if (!managementOpen) {
              window.requestAnimationFrame(() => deleteButtonRef.current?.focus());
            }
          }}
        >
          Управление аккаунтом
        </button>
        <button className="secondary-button account-sign-out" type="button" onClick={onSignOut}>
          Выйти
        </button>
        {managementOpen ? (
          <div id="account-management-actions" className="account-management-actions">
            <button
              ref={deleteButtonRef}
              id="account-delete-button"
              className="danger-text-button"
              type="button"
              onClick={onDeleteAccount}
            >
              Удалить аккаунт
            </button>
          </div>
        ) : null}
      </div>
    </section>
  );
}
