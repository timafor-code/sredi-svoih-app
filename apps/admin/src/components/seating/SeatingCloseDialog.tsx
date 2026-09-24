import { useEffect } from "react";
import { createPortal } from "react-dom";

import { Button } from "../ui/Button";

export function SeatingCloseDialog({
  isSaving,
  onCancel,
  onDiscard,
  onSaveAndClose,
}: {
  isSaving: boolean;
  onCancel: () => void;
  onDiscard: () => void;
  onSaveAndClose: () => void;
}) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      if (!isSaving) onCancel();
    };
    document.addEventListener("keydown", handleKeyDown, true);
    return () => document.removeEventListener("keydown", handleKeyDown, true);
  }, [isSaving, onCancel]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      className="seat-close-dialog-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !isSaving) onCancel();
      }}
    >
      <section
        aria-labelledby="seat-close-dialog-title"
        aria-modal="true"
        className="seat-close-dialog"
        role="dialog"
      >
        <header>
          <h3 id="seat-close-dialog-title">Есть несохранённые изменения</h3>
          <p>Сохранить схему перед закрытием?</p>
        </header>
        <div className="seat-close-dialog__actions">
          <Button disabled={isSaving} onClick={onCancel} size="sm" variant="secondary">
            Отмена
          </Button>
          <Button disabled={isSaving} onClick={onDiscard} size="sm" variant="destructive">
            Закрыть без сохранения
          </Button>
          <Button disabled={isSaving} onClick={onSaveAndClose} size="sm" variant="gold">
            {isSaving ? "Сохраняем..." : "Сохранить и закрыть"}
          </Button>
        </div>
      </section>
    </div>,
    document.body,
  );
}
