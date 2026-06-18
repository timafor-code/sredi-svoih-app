import type { SeatingGuestPoolItem } from "../../types/seating";
import {
  formatPaymentStatus,
  getRegistrationStatusLabel,
} from "../registrations/formatters";

export function SeatingAssignmentsPanel({
  error,
  guests,
  isSeatingDone,
  isLoading,
  warning,
}: {
  error: string | null;
  guests: SeatingGuestPoolItem[];
  isSeatingDone: boolean;
  isLoading: boolean;
  warning?: string | null;
}) {
  return (
    <aside
      aria-busy={isLoading}
      aria-label="Не рассажены"
      className="seat-pool"
    >
      <div className="seat-pool__head">
        <h4>Не рассажены</h4>
        <span className="seat-pool__count">
          {isLoading ? "..." : formatGuestCount(guests.length)}
        </span>
      </div>

      <div className="seat-pool__list">
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
        ) : guests.length === 0 && isSeatingDone ? (
          <p className="seat-pool__empty seat-pool__empty--success">
            Все рассажены.
          </p>
        ) : guests.length === 0 ? (
          <p className="seat-pool__empty">Нет гостей для выбранного слота.</p>
        ) : (
          guests.map((guest) => <GuestChip guest={guest} key={guest.key} />)
        )}
      </div>
    </aside>
  );
}

function GuestChip({ guest }: { guest: SeatingGuestPoolItem }) {
  const statusLabel = guest.status ? getRegistrationStatusLabel(guest.status) : null;
  const paymentLabel = guest.paymentStatus
    ? formatPaymentStatus(guest.paymentStatus)
    : null;
  const meta = [guest.sourceLabel, statusLabel, paymentLabel].filter(Boolean).join(" · ");
  const optionsLabel = guest.optionTitles.slice(0, 2).join(", ");
  const hiddenOptionsCount = Math.max(0, guest.optionTitles.length - 2);

  return (
    <div className="seat-guest-chip" title={formatGuestTitle(guest)}>
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
