type SaveStatusViewProps = {
  error?: string | null;
  errorLabel?: string;
  recovery?: string;
  savedAt?: string | null;
  scheduled?: boolean;
  saving?: boolean;
  unsaved?: boolean;
};

export function SaveStatusView({
  error,
  errorLabel = "Ошибка сохранения",
  recovery,
  savedAt,
  scheduled = false,
  saving = false,
  unsaved = false,
}: SaveStatusViewProps) {
  const state = saving ? "saving" : error ? "error" : scheduled ? "scheduled" : unsaved ? "unsaved" : savedAt ? "saved" : null;
  const savedTime = savedAt
    ? new Date(savedAt).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })
    : null;

  return (
    <span
      aria-atomic="true"
      className={`save-status${state ? ` save-status--${state}` : ""}`}
      role={state === "error" ? "alert" : "status"}
    >
      {state === "saving" ? "Сохраняем…"
        : state === "error" ? `${errorLabel}: ${error}${recovery ? ` ${recovery}` : ""}`
        : state === "scheduled" ? "Автосохранение через 2 секунды…"
        : state === "unsaved" ? "Есть несохранённые изменения"
        : state === "saved" ? `Сохранено в ${savedTime}`
        : null}
    </span>
  );
}
