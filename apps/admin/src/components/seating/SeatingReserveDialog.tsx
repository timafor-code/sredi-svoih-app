import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { createPortal } from "react-dom";

import { Button } from "../ui/Button";

// PR 16 — operational reserve creation dialog.
//
// A reserve is a UI-only operational placeholder (гость раввина, габай, "Резерв
// 1"). It deliberately does NOT create a participant, profile or registration:
// the dialog only collects a human label. The label is persisted on the seating
// assignment (`guest_label`, `assignment_type='reserve'`, no `registration_id`),
// so it survives save / reopen once the reserve is seated. The reserve occupies a
// physical seat without changing the registration limit.
export function SeatingReserveDialog({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: (label: string) => void;
}) {
  const [label, setLabel] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        // Stop the seating modal's own Escape handler from also firing.
        event.stopPropagation();
        onClose();
      }
    };

    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  if (typeof document === "undefined") {
    return null;
  }

  const trimmed = label.trim();
  const canSubmit = trimmed.length > 0;

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSubmit) {
      return;
    }
    onCreate(trimmed);
  };

  return createPortal(
    <div
      className="seat-reserve-dialog-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <form
        aria-labelledby="seat-reserve-dialog-title"
        aria-modal="true"
        className="seat-reserve-dialog"
        onSubmit={handleSubmit}
        role="dialog"
      >
        <header className="seat-reserve-dialog__head">
          <span>Резерв</span>
          <h3 id="seat-reserve-dialog-title">Новый резерв</h3>
          <p>
            Резерв занимает физическое место, но не относится к регистрации и не
            меняет лимит мест.
          </p>
        </header>

        <label className="seat-reserve-dialog__field">
          <span>Название</span>
          <input
            maxLength={80}
            onChange={(event) => setLabel(event.target.value)}
            placeholder="Например: Гость раввина"
            ref={inputRef}
            type="text"
            value={label}
          />
        </label>

        <div className="seat-reserve-dialog__actions">
          <Button onClick={onClose} size="sm" type="button" variant="secondary">
            Отмена
          </Button>
          <Button disabled={!canSubmit} size="sm" type="submit" variant="gold">
            Добавить резерв
          </Button>
        </div>
      </form>
    </div>,
    document.body,
  );
}
