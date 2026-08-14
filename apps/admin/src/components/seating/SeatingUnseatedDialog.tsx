import { useEffect, useMemo, useRef } from "react";
import { createPortal } from "react-dom";

import type {
  SeatingGuestPoolItem,
  SeatingReservePoolItem,
} from "../../types/seating";
import {
  formatPaymentStatus,
  getRegistrationStatusLabel,
} from "../registrations/formatters";

type SeatingParty = {
  guests: SeatingGuestPoolItem[];
  optionTitles: string[];
  participantName: string;
  paymentLabel: string | null;
  registrationId: string;
  statusLabel: string | null;
};

export function SeatingUnseatedDialog({
  fullListGuests,
  onClose,
  reserves,
}: {
  fullListGuests: SeatingGuestPoolItem[];
  onClose: () => void;
  reserves: SeatingReservePoolItem[];
}) {
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const parties = useMemo(
    () => groupGuestsByRegistration(fullListGuests),
    [fullListGuests],
  );
  const totalCount = fullListGuests.length;

  useEffect(() => {
    const previouslyFocused = document.activeElement;
    closeButtonRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        onClose();
        return;
      }

      if (event.key !== "Tab" || !dialogRef.current) {
        return;
      }

      const focusable = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      );
      if (focusable.length === 0) {
        event.preventDefault();
        dialogRef.current.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown, true);

    return () => {
      document.removeEventListener("keydown", handleKeyDown, true);
      if (previouslyFocused instanceof HTMLElement) {
        previouslyFocused.focus();
      }
    };
  }, [onClose]);

  if (typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <div
      className="seat-unseated-dialog-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        aria-describedby="seat-unseated-dialog-count"
        aria-labelledby="seat-unseated-dialog-title"
        aria-modal="true"
        className="seat-unseated-dialog"
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
      >
        <header className="seat-unseated-dialog__head">
          <div>
            <span>Гости</span>
            <h3 id="seat-unseated-dialog-title">Весь список</h3>
            <p id="seat-unseated-dialog-count">Всего: {formatSeatCount(totalCount)}</p>
          </div>
          <button
            aria-label="Закрыть полный список гостей"
            className="seat-unseated-dialog__close"
            onClick={onClose}
            ref={closeButtonRef}
            title="Закрыть"
            type="button"
          >
            ×
          </button>
        </header>

        <div className="seat-unseated-dialog__body">
          {parties.length === 0 && reserves.length === 0 ? (
            <p className="seat-unseated-dialog__empty">Все рассажены.</p>
          ) : null}

          {parties.length > 0 ? (
            <section aria-labelledby="seat-unseated-parties-title">
              <h4 id="seat-unseated-parties-title">Регистрации</h4>
              <div className="seat-unseated-dialog__parties">
                {parties.map((party) => (
                  <article className="seat-unseated-party" key={party.registrationId}>
                    <header className="seat-unseated-party__head">
                      <div>
                        <h5>{party.participantName}</h5>
                        <span>{formatPlaceCount(party.guests.length)}</span>
                      </div>
                      {party.optionTitles.length > 0 ? (
                        <p>{party.optionTitles.join(", ")}</p>
                      ) : null}
                      {party.statusLabel || party.paymentLabel ? (
                        <p className="seat-unseated-party__meta">
                          {[party.statusLabel, party.paymentLabel].filter(Boolean).join(" · ")}
                        </p>
                      ) : null}
                    </header>
                    <ul className="seat-unseated-party__members">
                      {party.guests.map((guest) => (
                        <li key={guest.key}>
                          <span aria-hidden="true" className="seat-unseated-party__initials">
                            {guest.initials}
                          </span>
                          <span>
                            <strong>{getGuestDisplayName(guest, party.participantName)}</strong>
                            <small>{guest.sourceLabel}</small>
                          </span>
                        </li>
                      ))}
                    </ul>
                  </article>
                ))}
              </div>
            </section>
          ) : null}

          {reserves.length > 0 ? (
            <section
              aria-labelledby="seat-unseated-reserves-title"
              className="seat-unseated-dialog__reserves"
            >
              <div className="seat-unseated-dialog__section-head">
                <h4 id="seat-unseated-reserves-title">Операционные резервы</h4>
                <span>{formatPlaceCount(reserves.length)}</span>
              </div>
              <ul>
                {reserves.map((reserve) => (
                  <li key={reserve.id}>
                    <span aria-hidden="true" className="seat-unseated-party__initials">
                      {reserve.initials}
                    </span>
                    <span>
                      <strong>{reserve.label}</strong>
                      <small>Резерв · без регистрации</small>
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      </div>
    </div>,
    document.body,
  );
}

function groupGuestsByRegistration(guests: SeatingGuestPoolItem[]): SeatingParty[] {
  const grouped = new Map<string, SeatingGuestPoolItem[]>();

  guests.forEach((guest) => {
    const party = grouped.get(guest.registrationId);
    if (party) {
      party.push(guest);
    } else {
      grouped.set(guest.registrationId, [guest]);
    }
  });

  return Array.from(grouped, ([registrationId, partyGuests]) => {
    const orderedGuests = [...partyGuests].sort((left, right) => {
      if (left.source !== right.source) {
        return left.source === "participant" ? -1 : 1;
      }
      return (left.guestIndex ?? 0) - (right.guestIndex ?? 0);
    });
    const participant = orderedGuests.find((guest) => guest.source === "participant");
    const participantName =
      participant?.displayName ||
      orderedGuests.find((guest) => guest.participantDisplayName)?.participantDisplayName ||
      "Регистрация";
    const status = orderedGuests.find((guest) => guest.status)?.status ?? null;
    const paymentStatus =
      orderedGuests.find((guest) => guest.paymentStatus)?.paymentStatus ?? null;

    return {
      guests: orderedGuests,
      optionTitles: Array.from(
        new Set(orderedGuests.flatMap((guest) => guest.optionTitles).filter(Boolean)),
      ),
      participantName,
      paymentLabel: paymentStatus ? formatPaymentStatus(paymentStatus) : null,
      registrationId,
      statusLabel: status ? getRegistrationStatusLabel(status) : null,
    };
  });
}

function getGuestDisplayName(guest: SeatingGuestPoolItem, participantName: string): string {
  if (guest.source === "participant") {
    return guest.displayName;
  }
  const guestName = guest.guestName?.trim();
  if (guestName) {
    return guestName;
  }
  return `Гость ${guest.guestIndex ?? 1} · ${participantName}`;
}

function formatSeatCount(count: number): string {
  return `${count} ${pluralizeRu(count, "человек", "человека", "человек")}`;
}

function formatPlaceCount(count: number): string {
  return `${count} ${pluralizeRu(count, "место", "места", "мест")}`;
}

function pluralizeRu(count: number, one: string, few: string, many: string): string {
  const remainder100 = Math.abs(count) % 100;
  const remainder10 = remainder100 % 10;

  if (remainder100 >= 11 && remainder100 <= 14) {
    return many;
  }
  if (remainder10 === 1) {
    return one;
  }
  if (remainder10 >= 2 && remainder10 <= 4) {
    return few;
  }
  return many;
}
