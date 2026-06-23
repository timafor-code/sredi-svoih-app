import type { AdminImportDedupe, AdminImportDedupeStatus } from "../../types/importDedupe";

const DEDUPE_STATUS_LABELS: Record<AdminImportDedupeStatus, string> = {
  new: "Новое",
  duplicate: "Дубль",
  possible_duplicate: "Возможный дубль",
  updated_existing: "Обновлено",
  linked_existing: "Связано",
  manual_override_skipped: "Защищено ручной правкой",
  error: "Ошибка",
};

type ImportDedupeBadgeProps = {
  dedupe?: AdminImportDedupe | null;
  hideUnchecked?: boolean;
};

export function ImportDedupeBadge({
  dedupe,
  hideUnchecked = false,
}: ImportDedupeBadgeProps) {
  if (!dedupe) {
    if (hideUnchecked) {
      return null;
    }

    return (
      <span className="import-dedupe-badge import-dedupe-badge--unchecked">
        Не проверено
      </span>
    );
  }

  return (
    <span
      className={`import-dedupe-badge import-dedupe-badge--${dedupe.status}`}
      title={dedupe.reason ?? undefined}
    >
      {getImportDedupeStatusLabel(dedupe.status)}
    </span>
  );
}

export function getImportDedupeStatusLabel(
  status: AdminImportDedupeStatus | null | undefined,
): string {
  return status ? DEDUPE_STATUS_LABELS[status] : "Не проверено";
}
