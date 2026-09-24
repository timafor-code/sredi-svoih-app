import { useCallback, useRef, useState } from "react";
import type { DragEvent as ReactDragEvent } from "react";

import type {
  SeatingGuestPoolItem,
  SeatingReservePoolItem,
} from "../../types/seating";
import {
  formatPaymentStatus,
  getRegistrationStatusLabel,
} from "../registrations/formatters";
import { enter, leave, reset } from "../../lib/seatingDropDepth";
import { SeatingUnseatedDialog, type DialogTriggerRect } from "./SeatingUnseatedDialog";

export function SeatingAssignmentsPanel({
  canAddReserve = false,
  error,
  fullListGuests,
  guests,
  isSeatingDone,
  isLoading,
  manualSeatingEnabled = false,
  onAddReserve,
  onDeleteReserve,
  onGuestDragEnd,
  onGuestDragStart,
  onGuestSelect,
  onPoolDrop,
  onReserveDragEnd,
  onReserveDragStart,
  reserves = [],
  pendingGuestKey = null,
  placementByGuestKey = new Map<string, string>(),
  warning,
}: {
  /** PR 16: when true, the "+ Резерв" action and reserve chips are interactive. */
  canAddReserve?: boolean;
  error: string | null;
  /** Complete loaded registration roster; unlike `guests`, this does not shrink as seats fill. */
  fullListGuests: SeatingGuestPoolItem[];
  /** Currently unseated registration guests used by the inline drag/drop pool. */
  guests: SeatingGuestPoolItem[];
  isSeatingDone: boolean;
  isLoading: boolean;
  /** PR 15: when true, pool chips are draggable and the panel accepts drops. */
  manualSeatingEnabled?: boolean;
  onAddReserve?: () => void;
  onDeleteReserve?: (reserveId: string) => void;
  onGuestDragEnd?: () => void;
  onGuestDragStart?: (guestKey: string) => void;
  onGuestSelect?: (guestKey: string) => boolean;
  onPoolDrop?: () => void;
  onReserveDragEnd?: () => void;
  onReserveDragStart?: (reserveId: string) => void;
  /** PR 16: unseated operational reserves (no registration). */
  reserves?: SeatingReservePoolItem[];
  pendingGuestKey?: string | null;
  placementByGuestKey?: Map<string, string>;
  warning?: string | null;
}) {
  const [isDropTarget, setIsDropTarget] = useState(false);
  const dragDepthRef = useRef(0);
  const isPoolDropEnabled = manualSeatingEnabled && Boolean(onPoolDrop);
  const [isFullListOpen, setIsFullListOpen] = useState(false);
  const [triggerRect, setTriggerRect] = useState<DialogTriggerRect | null>(null);
  const fullListButtonRef = useRef<HTMLButtonElement | null>(null);
  const handleCloseFullList = useCallback(() => setIsFullListOpen(false), []);

  const setDragState = (state: ReturnType<typeof reset>) => {
    dragDepthRef.current = state.depth;
    setIsDropTarget(state.isOver);
  };

  const handleDragEnter = (event: ReactDragEvent<HTMLElement>) => {
    if (!isPoolDropEnabled) {
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setDragState(enter(dragDepthRef.current));
  };

  const handleDragOver = (event: ReactDragEvent<HTMLElement>) => {
    if (!isPoolDropEnabled) {
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setIsDropTarget(true);
  };

  const handleDragLeave = () => {
    if (!isPoolDropEnabled) {
      return;
    }
    setDragState(leave(dragDepthRef.current));
  };

  const handleDragEnd = () => {
    if (isPoolDropEnabled) {
      setDragState(reset());
    }
  };

  const handleDrop = (event: ReactDragEvent<HTMLElement>) => {
    if (!isPoolDropEnabled) {
      return;
    }
    event.preventDefault();
    setDragState(reset());
    onPoolDrop?.();
  };

  return (
    <aside
      aria-busy={isLoading}
      aria-label="Не рассажены"
      className={isDropTarget ? "seat-pool seat-pool--drop" : "seat-pool"}
      onDragEnd={isPoolDropEnabled ? handleDragEnd : undefined}
      onDragEnter={isPoolDropEnabled ? handleDragEnter : undefined}
      onDragLeave={isPoolDropEnabled ? handleDragLeave : undefined}
      onDragOver={isPoolDropEnabled ? handleDragOver : undefined}
      onDrop={isPoolDropEnabled ? handleDrop : undefined}
    >
      <div className="seat-pool__head">
        <h4>Не рассажены</h4>
        <div className="seat-pool__head-meta">
          <span className="seat-pool__count">
            {isLoading ? "..." : formatGuestCount(guests.length)}
          </span>
          <button
            aria-expanded={isFullListOpen}
            aria-haspopup="dialog"
            className="seat-pool__all"
            onClick={() => { const rect = fullListButtonRef.current?.getBoundingClientRect(); setTriggerRect(rect ? { left: rect.left, top: rect.top, width: rect.width, height: rect.height } : null); setIsFullListOpen(true); }}
            ref={fullListButtonRef}
            type="button"
          >
            Весь список
          </button>
          {canAddReserve && onAddReserve ? (
            <button
              aria-label="Добавить резерв"
              className="seat-pool__add"
              onClick={onAddReserve}
              title="Добавить операционный резерв (гость раввина, габай, незаписанный гость)"
              type="button"
            >
              <ReservePlusIcon />
            </button>
          ) : null}
        </div>
      </div>

      <div
        className={[
          "seat-pool__list",
        ]
          .filter(Boolean)
          .join(" ")}
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
          <div
            className="seat-pool__empty seat-pool__empty--warning seat-pool__empty--block"
            role="status"
          >
            <strong>Нет гостей для рассадки в выбранном слоте.</strong>
            <span>
              Проверьте, что выбран правильный event/occurrence и что в этом
              capacity slot есть seat-taking registrations.
            </span>
            <ul>
              <li>нет confirmed/active registrations для этого слота;</li>
              <li>выбрана другая дата или другой capacity bucket;</li>
              <li>donation-only registrations не занимают места;</li>
              <li>capacity slot сейчас не содержит гостей для seating pool.</li>
            </ul>
          </div>
        ) : (
          <>
            {guests.map((guest) => (
              <GuestChip
                draggable={manualSeatingEnabled}
                guest={guest}
                key={guest.key}
                onDragEnd={onGuestDragEnd}
                onDragStart={onGuestDragStart}
                onSelect={onGuestSelect}
                selected={pendingGuestKey === guest.key}
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

      {manualSeatingEnabled ? (
        <p className="seat-pool__hint">Перетащите гостя на стул или выберите его кликом, затем нажмите свободное место.</p>
      ) : null}

      {isFullListOpen ? (
        <SeatingUnseatedDialog
          fullListGuests={fullListGuests}
          onClose={handleCloseFullList}
          onGuestSelect={onGuestSelect ?? (() => false)}
          placementByGuestKey={placementByGuestKey}
          reserves={reserves}
          triggerRect={triggerRect}
        />
      ) : null}
    </aside>
  );
}

function ReservePlusIcon() {
  return <svg aria-hidden="true" fill="none" height="14" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.7" viewBox="0 0 24 24" width="14"><path d="M12 5.5v13M5.5 12h13" /></svg>;
}

function GuestChip({
  draggable,
  guest,
  onDragEnd,
  onDragStart,
  onSelect,
  selected,
}: {
  draggable: boolean;
  guest: SeatingGuestPoolItem;
  onDragEnd?: () => void;
  onDragStart?: (guestKey: string) => void;
  onSelect?: (guestKey: string) => boolean;
  selected?: boolean;
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
      className={["seat-guest-chip", draggable ? "seat-guest-chip--draggable" : "", selected ? "is-selected" : ""]
        .filter(Boolean)
        .join(" ")}
      role={onSelect ? "button" : undefined}
      tabIndex={onSelect ? 0 : undefined}
      aria-pressed={onSelect ? selected : undefined}
      onClick={onSelect ? () => onSelect(guest.key) : undefined}
      onKeyDown={onSelect ? (event) => { if (event.key === "Enter") onSelect(guest.key); if (event.key === " ") { event.preventDefault(); onSelect(guest.key); } } : undefined}
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
          <svg aria-hidden="true" fill="none" height="10" stroke="currentColor" strokeLinecap="round" strokeWidth="1.6" viewBox="0 0 10 10" width="10"><path d="m1 1 8 8M9 1 1 9" /></svg>
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
