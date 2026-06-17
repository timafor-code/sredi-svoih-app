import type { AdminBadgeTone } from "../../types/admin";
import type {
  AdminEventRegistrationRow,
  AdminRegistrationEventSummary,
  AdminRegistrationOptionSelectionSummary,
} from "../../types/registrations";

export function formatDateTime(value: string | null): string {
  if (!value) {
    return "Не указано";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export function formatOccurrenceLabel(
  registration: AdminEventRegistrationRow,
  event: AdminRegistrationEventSummary,
): string {
  if (registration.occurrenceStartsAt) {
    return formatDateTime(registration.occurrenceStartsAt);
  }

  if (event.startsAt) {
    return formatDateTime(event.startsAt);
  }

  return "Без отдельного сеанса";
}

export function formatOptionsCompact(options: AdminRegistrationOptionSelectionSummary[]): string {
  if (options.length === 0) {
    return "Без опций";
  }

  return options
    .slice(0, 2)
    .map((option) => {
      const title = option.isDonation ? `Пожертвование: ${option.title}` : option.title;
      const amount =
        option.totalAmount > 0
          ? ` · ${formatMoney(option.totalAmount, option.currency)}`
          : "";
      return `${title} × ${option.quantity}${amount}`;
    })
    .join(", ");
}

export function formatOptionsFull(options: AdminRegistrationOptionSelectionSummary[]): string {
  if (options.length === 0) {
    return "Без опций";
  }

  return options
    .map((option) => {
      const title = option.isDonation ? `Пожертвование: ${option.title}` : option.title;
      const amount =
        option.totalAmount > 0
          ? ` · ${formatMoney(option.totalAmount, option.currency)}`
          : "";
      const seats = option.isDonation ? "не место" : `${option.seatsCount} мест`;

      return `${title} × ${option.quantity}${amount} · ${seats}`;
    })
    .join("\n");
}

export function formatRegistrationAmount(registration: AdminEventRegistrationRow): string {
  const amount =
    registration.totalAmount ??
    registration.selectedOptions.reduce((sum, option) => sum + option.totalAmount, 0);
  const hasAmount =
    registration.totalAmount !== null ||
    registration.selectedOptions.some((option) => option.totalAmount > 0);
  const currency = registration.selectedOptions[0]?.currency ?? "RUB";

  return hasAmount ? formatMoney(amount, currency) : "Без суммы";
}

export function formatRegistrationCount(count: number): string {
  const remainder100 = count % 100;
  const remainder10 = count % 10;

  if (remainder100 >= 11 && remainder100 <= 14) {
    return `${count} регистраций`;
  }

  if (remainder10 === 1) {
    return `${count} регистрация`;
  }

  if (remainder10 >= 2 && remainder10 <= 4) {
    return `${count} регистрации`;
  }

  return `${count} регистраций`;
}

export function formatMoney(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat("ru-RU", {
      currency,
      maximumFractionDigits: Number.isInteger(amount) ? 0 : 2,
      style: "currency",
    }).format(amount);
  } catch {
    return `${amount.toLocaleString("ru-RU")} ${currency}`;
  }
}

export function formatPaymentStatus(status: string): string {
  const labels: Record<string, string> = {
    cancelled: "Отменено",
    failed: "Ошибка оплаты",
    not_required: "Не требуется",
    paid: "Оплачено",
    pending: "Ожидает оплаты",
    refunded: "Возврат",
    succeeded: "Оплачено",
  };

  return labels[status] ?? status;
}

export function isSimulatedPaymentId(paymentId: string | null): boolean {
  return paymentId?.startsWith("simulated:") === true;
}

export function getRegistrationStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    attended: "Пришёл",
    cancelled: "Отменено",
    confirmed: "Подтверждено",
    no_show: "No-show",
    pending: "Заявка",
    rejected: "Отклонено",
    waitlisted: "Лист ожидания",
  };

  return labels[status] ?? status;
}

export function getRegistrationStatusTone(status: string): AdminBadgeTone {
  if (status === "confirmed" || status === "attended") {
    return "green";
  }

  if (status === "pending") {
    return "gold";
  }

  if (status === "waitlisted") {
    return "purple";
  }

  if (status === "rejected" || status === "no_show") {
    return "red";
  }

  if (status === "cancelled") {
    return "muted";
  }

  return "glass";
}

export function getDestructiveActionDescription(status: string): string {
  if (status === "cancelled") {
    return "Заявка будет отменена через admin_update_registration_status. Участник исчезнет из текущего фильтра, если он не показывает отменённые заявки.";
  }

  if (status === "rejected") {
    return "Заявка будет отклонена через admin_update_registration_status. Используйте это только для заявок, которые не должны попасть в подтверждённые.";
  }

  return "Регистрация будет отмечена как No-show через admin_mark_registration_attendance.";
}

export function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);

  if (parts.length === 0) {
    return "?";
  }

  return parts
    .slice(0, 2)
    .map((part) => part.slice(0, 1).toLocaleUpperCase("ru"))
    .join("");
}

export function formatEventKind(eventKind: string): string {
  const labels: Record<string, string> = {
    recurring: "повторяющееся",
    single: "одно событие",
  };

  return labels[eventKind] ?? eventKind;
}
