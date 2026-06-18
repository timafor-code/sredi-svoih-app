import { useState } from "react";
import type { DragEvent as ReactDragEvent } from "react";

import type {
  SeatingGuestPoolItem,
  SeatingReservePoolItem,
} from "../../types/seating";
import {
  formatPaymentStatus,
  getRegistrationStatusLabel,
} from "../registrations/formatters";

export function SeatingAssignmentsPanel({
  canAddReserve = false,
  error,
  guests,
  isSeatingDone,
  isLoading,
  manualSeatingEnabled = false,
  onAddReserve,
  onDeleteReserve,
  onGuestDragEnd,
  onGuestDragStart,
  onPoolDrop,
  onReserveDragEnd,
  onReserveDragStart,
  reserves = [],
  warning,
}: {
  /** PR 16: when true, the "+ Резерв" action and reserve chips are interactive. */
  canAddReserve?: boolean;
  error: string | null;
  guests: SeatingGuestPoolItem[];
  isSeatingDone: boolean;
  isLoading: boolean;
  /** PR 15: when true, pool chips are draggable and the panel accepts drops. */
  manualSeatingEnabled?: boolean;
  onAddReserve?: () => void;
  onDeleteReserve?: (reserveId: string) => void;
  onGuestDragEnd?: () => void;
  onGuestDragStart?: (guestKey: string) => void;
  onPoolDrop?: () => void;
  onReserveDragEnd?: () => void;
  onReserveDragStart?: (reserveId: string) => void;
  /** PR 16: unseated operational reserves (no registration). */
  reserves?: SeatingReservePoolItem[];
  warning?: string | null;
}) {
  const [isDropTarget, setIsDropTarget] = useState(false);

  const handleDragOver = (event: ReactDragEvent<HTMLDivElement>) => {
    if (!manualSeatingEnabled || !onPoolDrop) {
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setIsDropTarget(true);
  };

  const handleDrop = (event: ReactDragEvent<HTMLDivElement>) => {
    if (!manualSeatingEnabled || !onPoolDrop) {
      return;
    }
    event.preventDefault();
    setIsDropTarget(false);
    onPoolDrop();
  };

  return (
    <aside
      aria-busy={isLoading}
      aria-label="Не рассажены"
      className="seat-pool"
    >
      <div className="seat-pool__head">
        <h4>Не рассажены</h4>
        <div className="seat-pool__head-meta">
          <span className="seat-pool__count">
            {isLoading ? "..." : formatGuestCount(guests.length)}
          </span>
          {canAddReserve && onAddReserve ? (
            <button
              className="seat-pool__add"
              onClick={onAddReserve}
              title="Добавить операционный резерв (гость раввина, габай, незаписанный гость)"
              type="button"
            >
              + Резерв
            </button>
          ) : null}
        </div>
      </div>

      <div
        className={[
          "seat-pool__list",
          manualSeatingEnabled ? "seat-pool__list--droppable" : "",
          isDropTarget ? "seat-pool__list--drop" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        onDragLeave={manualSeatingEnabled ? () => setIsDropTarget(false) : undefined}
        onDragOver={manualSeatingEnabled ? handleDragOver : undefined}
        onDrop={manualSeatingEnabled ? handleDrop : undefined}
      >
        {!isLoading && !error && warning ? (
          <p className="seat-pool__empty seat-pool__empty--warning" role="alert">
            {warning}
          </p>
        ) : null}

        {isLoading ? (
          <p className="seat-pool__empty" role="status">
            Загружаем гостей...
          </p>
        ) : error ? (
          <p className="seat-pool__empty seat-pool__empty--error" role="alert">
            {error}
          </p>
        ) : guests.length === 0 && reserves.length === 0 && isSeatingDone ? (
          <p className="seat-pool__empty seat-pool__empty--success">
            Все рассажены.
          </p>
        ) : guests.length === 0 && reserves.length === 0 ? (
          <p className="seat-pool__empty">Нет гостей для выбранного слота.</p>
        ) : (
          <>
            {guests.map((guest) => (
              <GuestChip
                draggable={manualSeatingEnabled}
                guest={guest}
                key={guest.key}
                onDragEnd={onGuestDragEnd}
                onDragStart={onGuestDragStart}
              />
            ))}
            {reserves.map((reserve) => (
              <ReserveChip
                draggable={canAddReserve}
                key={reserve.id}
                onDelete={onDeleteReserve}
                onDragEnd={onReserveDragEnd}
                onDragStart={onReserveDragStart}
                reserve={reserve}
              />
            ))}
          </>
        )}
      </div>
    </aside>
  );
}

function GuestChip({
  draggable,
  guest,
  onDragEnd,
  onDragStart,
}: {
  draggable: boolean;
  guest: SeatingGuestPoolItem;
  onDragEnd?: () => void;
  onDragStart?: (guestKey: string) => void;
}) {
  const statusLabel = guest.status ? getRegistrationStatusLabel(guest.status) : null;
  const paymentLabel = guest.paymentStatus
    ? formatPaymentStatus(guest.paymentStatus)
    : null;
  const meta = [guest.sourceLabel, statusLabel, paymentLabel].filter(Boolean).join(" · ");
  const optionsLabel = guest.optionTitles.slice(0, 2).join(", ");
  const hiddenOptionsCount = Math.max(0, guest.optionTitles.length - 2);

  const handleDragStart = (event: ReactDragEvent<HTMLDivElement>) => {
    if (!draggable || !onDragStart) {
      return;
    }
    event.dataTransfer.setData("text/plain", `pool:${guest.key}`);
    event.dataTransfer.effectAllowed = "move";
    onDragStart(guest.key);
  };

  return (
    <div
      className={["seat-guest-chip", draggable ? "seat-guest-chip--draggable" : ""]
        .filter(Boolean)
        .join(" ")}
      draggable={draggable}
      onDragEnd={draggable ? onDragEnd : undefined}
      onDragStart={draggable ? handleDragStart : undefined}
      title={formatGuestTitle(guest)}
    >
      <span aria-hidden="true" className="seat-guest-chip__initials">
        {guest.initials}
      </span>
      <span className="seat-guest-chip__body">
        <strong>{guest.displayName}</strong>
        {meta ? <span>{meta}</span> : null}
        {optionsLabel ? (
          <small>
            {optionsLabel}
            {hiddenOptionsCount > 0 ? ` +${hiddenOptionsCount}` : ""}
          </small>
        ) : null}
      </span>
    </div>
  );
}

function ReserveChip({
  draggable,
  onDelete,
  onDragEnd,
  onDragStart,
  reserve,
}: {
  draggable: boolean;
  onDelete?: (reserveId: string) => void;
  onDragEnd?: () => void;
  onDragStart?: (reserveId: string) => void;
  reserve: SeatingReservePoolItem;
}) {
  const handleDragStart = (event: ReactDragEvent<HTMLDivElement>) => {
    if (!draggable || !onDragStart) {
      return;
    }
    event.dataTransfer.setData("text/plain", `reserve:${reserve.id}`);
    event.dataTransfer.effectAllowed = "move";
    onDragStart(reserve.id);
  };

  return (
    <div
      className={["seat-reserve-chip", draggable ? "seat-reserve-chip--draggable" : ""]
        .filter(Boolean)
        .join(" ")}
      draggable={draggable}
      onDragEnd={draggable ? onDragEnd : undefined}
      onDragStart={draggable ? handleDragStart : undefined}
      title={`Резерв: ${reserve.label} · занимает физическое место, без регистрации`}
    >
      <span aria-hidden="true" className="seat-reserve-chip__initials">
        {reserve.initials}
      </span>
      <span className="seat-reserve-chip__body">
        <strong>{reserve.label}</strong>
        <span>Резерв · без регистрации</span>
      </span>
      {onDelete ? (
        <button
          aria-label={`Удалить резерв «${reserve.label}»`}
          className="seat-reserve-chip__delete"
          onClick={() => onDelete(reserve.id)}
          title="Удалить резерв"
          type="button"
        >
          ×
        </button>
      ) : null}
    </div>
  );
}

function formatGuestTitle(guest: SeatingGuestPoolItem): string {
  return [
    guest.displayName,
    guest.sourceLabel,
    guest.status ? getRegistrationStatusLabel(guest.status) : null,
    guest.paymentStatus ? formatPaymentStatus(guest.paymentStatus) : null,
    guest.optionTitles.join(", ") || null,
  ]
    .filter(Boolean)
    .join(" · ");
}

function formatGuestCount(count: number): string {
  const remainder100 = count % 100;
  const remainder10 = count % 10;

  if (remainder100 >= 11 && remainder100 <= 14) {
    return `${count} гостей`;
  }

  if (remainder10 === 1) {
    return `${count} гость`;
  }

  if (remainder10 >= 2 && remainder10 <= 4) {
    return `${count} гостя`;
  }

  return `${count} гостей`;
}
