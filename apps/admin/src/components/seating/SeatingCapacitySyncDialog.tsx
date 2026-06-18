import { useEffect } from "react";
import { createPortal } from "react-dom";

import { Button } from "../ui/Button";

export function SeatingCapacitySyncDialog({
  capacityLimit,
  error,
  isSubmitting,
  occupiedSeats,
  onCancel,
  onConfirm,
  physicalSeatCount,
}: {
  capacityLimit: number | null;
  error: string | null;
  isSubmitting: boolean;
  occupiedSeats: number;
  onCancel: () => void;
  onConfirm: () => void;
  physicalSeatCount: number;
}) {
  const normalizedPhysicalSeatCount = toCount(physicalSeatCount);
  const normalizedOccupiedSeats = toCount(occupiedSeats);
  const normalizedCapacityLimit = normalizeLimit(capacityLimit);
  const isBlockedByOccupiedSeats =
    normalizedPhysicalSeatCount < normalizedOccupiedSeats;
  const canConfirm = !isSubmitting && !isBlockedByOccupiedSeats;
  const confirmationLines = buildConfirmationLines({
    capacityLimit: normalizedCapacityLimit,
    physicalSeatCount: normalizedPhysicalSeatCount,
  });

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        if (!isSubmitting) {
          onCancel();
        }
      }
    };

    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isSubmitting, onCancel]);

  if (typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <div
      className="seat-capacity-sync-dialog-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !isSubmitting) {
          onCancel();
        }
      }}
    >
      <section
        aria-labelledby="seat-capacity-sync-dialog-title"
        aria-modal="true"
        className="seat-capacity-sync-dialog"
        role="dialog"
      >
        <header className="seat-capacity-sync-dialog__head">
          <span>Лимит регистрации</span>
          <h3 id="seat-capacity-sync-dialog-title">
            Обновить лимит слота
          </h3>
        </header>

        <div className="seat-capacity-sync-dialog__body">
          {confirmationLines.map((line) => (
            <p key={line}>{line}</p>
          ))}
          <p className="seat-capacity-sync-dialog__muted">
            Изменится только лимит публичной записи. Рассадка, регистрации,
            резервы и оплаты останутся без изменений.
          </p>
        </div>

        {isBlockedByOccupiedSeats ? (
          <p className="seat-capacity-sync-dialog__warning" role="alert">
            Нельзя понизить лимит до {formatCount(normalizedPhysicalSeatCount)}:
            уже занято {formatCount(normalizedOccupiedSeats)} мест. Сначала
            разберите регистрации или добавьте физические места.
          </p>
        ) : null}

        {error ? (
          <p className="seat-capacity-sync-dialog__error" role="alert">
            {error}
          </p>
        ) : null}

        <div className="seat-capacity-sync-dialog__actions">
          <Button
            disabled={isSubmitting}
            onClick={onCancel}
            size="sm"
            type="button"
            variant="secondary"
          >
            Отмена
          </Button>
          <Button
            disabled={!canConfirm}
            onClick={onConfirm}
            size="sm"
            type="button"
            variant="gold"
          >
            {isSubmitting ? "Обновляем..." : "Подтвердить"}
          </Button>
        </div>
      </section>
    </div>,
    document.body,
  );
}

function buildConfirmationLines({
  capacityLimit,
  physicalSeatCount,
}: {
  capacityLimit: number | null;
  physicalSeatCount: number;
}): string[] {
  const physicalLabel = formatCount(physicalSeatCount);

  if (capacityLimit === null) {
    return [
      "Сейчас лимит регистрации: без лимита.",
      `В схеме физических мест: ${physicalLabel}.`,
      `Установить лимит регистрации ${physicalLabel}?`,
    ];
  }

  const capacityLabel = formatCount(capacityLimit);

  if (physicalSeatCount > capacityLimit) {
    return [
      `Сейчас лимит регистрации: ${capacityLabel}.`,
      `В схеме физических мест: ${physicalLabel}.`,
      `Увеличить лимит регистрации до ${physicalLabel}?`,
      `Это откроет ${formatCount(
        physicalSeatCount - capacityLimit,
      )} новых мест для публичной записи.`,
    ];
  }

  return [
    `Сейчас лимит регистрации: ${capacityLabel}.`,
    `В схеме физических мест: ${physicalLabel}.`,
    `Понизить лимит регистрации до ${physicalLabel}?`,
    "Это ограничит публичную запись.",
  ];
}

function formatCount(value: number): string {
  return new Intl.NumberFormat("ru-RU").format(value);
}

function toCount(value: number | null | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.round(value));
}

function normalizeLimit(value: number | null | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return null;
  }

  return Math.round(value);
}
