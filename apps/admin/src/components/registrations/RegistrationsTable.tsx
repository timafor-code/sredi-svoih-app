import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";

import { Badge } from "../ui/Badge";
import type { AdminEventRegistrationRow, AdminRegistrationEventSummary } from "../../types/registrations";
import {
  formatDateTime,
  formatOccurrenceLabel,
  formatOptionsCompact,
  formatOptionsFull,
  formatPaymentStatus,
  formatRegistrationAmount,
  getInitials,
  getRegistrationSourceCompactLabel,
  getRegistrationSourceLabel,
  getRegistrationSourceTone,
  getRegistrationStatusLabel,
  getRegistrationStatusTone,
  isSimulatedPaymentId,
} from "./formatters";
import type { ActionInFlight, RegistrationAction } from "./types";

const REGISTRATION_MENU_WIDTH = 232;
const REGISTRATION_MENU_HEIGHT = 318;

type RegistrationActionMenuState = {
  registrationId: string;
  left: number;
  top: number;
};

export function RegistrationsTable({
  actionInFlight,
  actions,
  event,
  onAction,
  onSelectRegistration,
  registrations,
  selectedRegistrationId,
}: {
  actionInFlight: ActionInFlight | null;
  actions: RegistrationAction[];
  event: AdminRegistrationEventSummary;
  onAction: (registration: AdminEventRegistrationRow, action: RegistrationAction) => void;
  onSelectRegistration: (registrationId: string) => void;
  registrations: AdminEventRegistrationRow[];
  selectedRegistrationId: string | null;
}) {
  const [openActionMenu, setOpenActionMenu] = useState<RegistrationActionMenuState | null>(null);

  useEffect(() => {
    if (!openActionMenu) {
      return undefined;
    }

    const handleKeyDown = (keyboardEvent: KeyboardEvent) => {
      if (keyboardEvent.key === "Escape") {
        setOpenActionMenu(null);
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    const mobileViewport = window.matchMedia("(max-width: 960px)");
    const closeOnMobile = () => {
      if (mobileViewport.matches) {
        setOpenActionMenu(null);
      }
    };
    mobileViewport.addEventListener("change", closeOnMobile);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      mobileViewport.removeEventListener("change", closeOnMobile);
    };
  }, [openActionMenu]);

  const openRegistration = openActionMenu
    ? registrations.find((registration) => registration.id === openActionMenu.registrationId)
    : null;

  const openActionsMenu = useCallback(
    (registration: AdminEventRegistrationRow, button: HTMLButtonElement) => {
      const rect = button.getBoundingClientRect();
      const safePadding = 12;
      const left = Math.max(
        safePadding,
        Math.min(
          rect.right - REGISTRATION_MENU_WIDTH,
          window.innerWidth - REGISTRATION_MENU_WIDTH - safePadding,
        ),
      );
      const top = Math.max(
        safePadding,
        Math.min(
          rect.bottom + 8,
          window.innerHeight - REGISTRATION_MENU_HEIGHT - safePadding,
        ),
      );

      setOpenActionMenu((current) =>
        current?.registrationId === registration.id
          ? null
          : {
              registrationId: registration.id,
              left,
              top,
            },
      );
    },
    [],
  );

  return (
    <>
    <RegistrationsMobileList
      actionInFlight={actionInFlight}
      event={event}
      onSelectRegistration={onSelectRegistration}
      registrations={registrations}
      selectedRegistrationId={selectedRegistrationId}
    />
    <div className="registrations-table-scroll">
      <div
        aria-label="Регистрации события"
        className="data-table data-table--registrations"
        role="table"
      >
        <div className="data-table__row data-table__row--head" role="row">
          <span role="columnheader">Участник</span>
          <span role="columnheader">Контакты</span>
          <span role="columnheader">Статус / источник</span>
          <span role="columnheader">Дата/сеанс</span>
          <span role="columnheader">Мест</span>
          <span role="columnheader">Опции</span>
          <span role="columnheader">Оплата</span>
          <span role="columnheader">Заявка</span>
          <span role="columnheader">Действия</span>
        </div>

        {registrations.map((registration) => {
          const isSelected = registration.id === selectedRegistrationId;
          const fullOptionsLabel = formatOptionsFull(registration.selectedOptions);
          const sourceLabel = getRegistrationSourceLabel(registration.sourceChannel);

          return (
            <div
              className={`data-table__row data-table__row--registration${
                isSelected ? " data-table__row--registration-selected" : ""
              }`}
              key={registration.id}
              onClick={() => onSelectRegistration(registration.id)}
              onKeyDown={(keyboardEvent) => {
                if (keyboardEvent.target !== keyboardEvent.currentTarget) {
                  return;
                }

                if (keyboardEvent.key === "Enter" || keyboardEvent.key === " ") {
                  keyboardEvent.preventDefault();
                  onSelectRegistration(registration.id);
                }
              }}
              role="row"
              tabIndex={0}
            >
              <div className="registration-table-person" role="cell">
                <span className="registration-avatar" aria-hidden="true">
                  {getInitials(registration.participantDisplayName)}
                </span>
                <div>
                  <strong>{registration.participantDisplayName}</strong>
                  {registration.guestNames.length > 0 ? (
                    <small>{registration.guestNames.length} гост.</small>
                  ) : null}
                </div>
              </div>
              <div className="registration-table-stack" role="cell">
                <span>{registration.email ?? "email не указан"}</span>
                <small>{registration.phone ?? "телефон не указан"}</small>
              </div>
              <div className="registration-table-stack registration-table-stack--status" role="cell">
                <Badge tone={getRegistrationStatusTone(registration.status)}>
                  {getRegistrationStatusLabel(registration.status)}
                </Badge>
                <div
                  aria-label={`Источник регистрации: ${sourceLabel}`}
                  className="registration-table-source"
                  title={sourceLabel}
                >
                  <Badge tone={getRegistrationSourceTone(registration.sourceChannel)}>
                    {getRegistrationSourceCompactLabel(registration.sourceChannel)}
                  </Badge>
                </div>
              </div>
              <div className="registration-table-stack" role="cell">
                <span>{formatOccurrenceLabel(registration, event)}</span>
                {registration.occurrenceTitle ? <small>{registration.occurrenceTitle}</small> : null}
              </div>
              <span role="cell">{registration.seatsCount}</span>
              <div
                aria-label={`Опции: ${fullOptionsLabel}`}
                className="registration-table-stack registration-table-stack--options"
                role="cell"
                title={fullOptionsLabel}
              >
                <span>{formatOptionsCompact(registration.selectedOptions)}</span>
                {registration.selectedOptions.length > 2 ? (
                  <small>+{registration.selectedOptions.length - 2} ещё</small>
                ) : null}
              </div>
              <div className="registration-table-stack" role="cell">
                <span>{formatPaymentStatus(registration.paymentStatus)}</span>
                {isSimulatedPaymentId(registration.paymentId) ? (
                  <Badge tone="gold">Тестовая оплата</Badge>
                ) : null}
                <small>{formatRegistrationAmount(registration)}</small>
              </div>
              <span role="cell">{formatDateTime(registration.registeredAt)}</span>
              <div
                aria-label={`Действия: ${registration.participantDisplayName}`}
                className="event-table__actions"
                role="cell"
              >
                <button
                  aria-expanded={openActionMenu?.registrationId === registration.id}
                  aria-haspopup="menu"
                  aria-label={`Действия регистрации: ${registration.participantDisplayName}`}
                  className="event-action-dots"
                  disabled={Boolean(actionInFlight)}
                  onClick={(clickEvent) => {
                    clickEvent.stopPropagation();
                    openActionsMenu(registration, clickEvent.currentTarget);
                  }}
                  onMouseDown={(mouseEvent) => {
                    mouseEvent.stopPropagation();
                  }}
                  type="button"
                >
                  ...
                </button>
              </div>
            </div>
          );
        })}

        {openActionMenu && openRegistration ? (
          <RegistrationOverflowMenu
            actionInFlight={actionInFlight}
            actions={actions}
            left={openActionMenu.left}
            onAction={(registration, action) => {
              setOpenActionMenu(null);
              onAction(registration, action);
            }}
            onClose={() => setOpenActionMenu(null)}
            registration={openRegistration}
            top={openActionMenu.top}
          />
        ) : null}
      </div>
    </div>
    </>
  );
}

function RegistrationsMobileList({
  actionInFlight,
  event,
  onSelectRegistration,
  registrations,
  selectedRegistrationId,
}: {
  actionInFlight: ActionInFlight | null;
  event: AdminRegistrationEventSummary;
  onSelectRegistration: (registrationId: string) => void;
  registrations: AdminEventRegistrationRow[];
  selectedRegistrationId: string | null;
}) {
  return (
    <ul aria-label={`Регистрации: ${event.title}`} className="registrations-mobile-list">
      {registrations.map((registration) => (
        <li key={registration.id}>
          <RegistrationMobileCard
            isBusy={actionInFlight?.registrationId === registration.id}
            isSelected={selectedRegistrationId === registration.id}
            onSelectRegistration={onSelectRegistration}
            registration={registration}
          />
        </li>
      ))}
    </ul>
  );
}

function RegistrationMobileCard({
  isBusy,
  isSelected,
  onSelectRegistration,
  registration,
}: {
  isBusy: boolean;
  isSelected: boolean;
  onSelectRegistration: (registrationId: string) => void;
  registration: AdminEventRegistrationRow;
}) {
  return (
    <button
      aria-busy={isBusy}
      aria-haspopup="dialog"
      className={`registration-mobile-card${isSelected ? " registration-mobile-card--selected" : ""}`}
      onClick={() => onSelectRegistration(registration.id)}
      type="button"
    >
      <strong className="registration-mobile-card__name">{registration.participantDisplayName}</strong>
      <span className="badge-row">
        <Badge tone={getRegistrationStatusTone(registration.status)}>
          {getRegistrationStatusLabel(registration.status)}
        </Badge>
        <Badge tone={getRegistrationSourceTone(registration.sourceChannel)}>
          {getRegistrationSourceLabel(registration.sourceChannel)}
        </Badge>
      </span>
      <span className="registration-mobile-card__contacts">
        {registration.email ? <span>{registration.email}</span> : null}
        {registration.phone ? <span>{registration.phone}</span> : null}
        {!registration.email && !registration.phone ? <span>Контакты не указаны</span> : null}
      </span>
      <span>
        Мест: {registration.seatsCount}
        {registration.guestNames.length > 0 ? ` · Гостей: ${registration.guestNames.length}` : ""}
      </span>
      {registration.selectedOptions.length > 0 ? (
        <span className="registration-mobile-card__options">
          {formatOptionsCompact(registration.selectedOptions)}
          {registration.selectedOptions.length > 2 ? ` · +${registration.selectedOptions.length - 2} ещё` : ""}
        </span>
      ) : null}
      <span className="registration-mobile-card__payment">
        <span>{formatPaymentStatus(registration.paymentStatus)} · {formatRegistrationAmount(registration)}</span>
        {isSimulatedPaymentId(registration.paymentId) ? <Badge tone="gold">Тестовая оплата</Badge> : null}
      </span>
      <span className="registration-mobile-card__footer">
        <span>Заявка: {formatDateTime(registration.registeredAt)}</span>
        <span>Подробнее →</span>
      </span>
    </button>
  );
}

function RegistrationOverflowMenu({
  actionInFlight,
  actions,
  left,
  onAction,
  onClose,
  registration,
  top,
}: {
  actionInFlight: ActionInFlight | null;
  actions: RegistrationAction[];
  left: number;
  onAction: (registration: AdminEventRegistrationRow, action: RegistrationAction) => void;
  onClose: () => void;
  registration: AdminEventRegistrationRow;
  top: number;
}) {
  if (typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <div className="event-overflow-layer registration-overflow-layer" onClick={onClose}>
      <div
        className="event-overflow-menu registration-action-menu"
        onClick={(clickEvent) => clickEvent.stopPropagation()}
        role="menu"
        style={{ left, top }}
      >
        {actions.map((action) => {
          const isCurrentStatus = registration.status === action.status;
          const isLoading =
            actionInFlight?.registrationId === registration.id &&
            actionInFlight.status === action.status;

          return (
            <button
              className={`event-overflow-menu__item registration-action-menu__item${
                action.destructive ? " registration-action-menu__item--danger" : ""
              }`}
              disabled={Boolean(actionInFlight) || isCurrentStatus}
              key={`${action.kind}-${action.status}`}
              onClick={() => onAction(registration, action)}
              role="menuitem"
              type="button"
            >
              {isLoading ? action.loadingLabel : action.label}
            </button>
          );
        })}
      </div>
    </div>,
    document.body,
  );
}
