import {
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
} from "react";

import { ApiClientError } from "../../services/apiClient";
import type {
  AdminMemberListRow,
  AdminStartedMemberDeletion,
} from "../../types/members";
import { Button } from "../ui/Button";

type AdminMemberDeleteDialogProps = {
  member: AdminMemberListRow;
  onClose: () => void;
  onConfirm: () => Promise<AdminStartedMemberDeletion>;
  onDeletionStarted: (deletion: AdminStartedMemberDeletion) => void;
};

const UI_CONFIRMATION = "УДАЛИТЬ";

const KNOWN_DELETION_ERROR_MESSAGES: Record<string, string> = {
  cannot_delete_self:
    "Нельзя удалить собственный аккаунт из раздела «Участники». Используйте обычное удаление аккаунта.",
  cannot_delete_last_admin:
    "Нельзя удалить последнего активного администратора общины. Сначала назначьте другого активного администратора.",
  member_has_other_active_communities:
    "Пользователь состоит ещё в одной или нескольких общинах. Полное удаление аккаунта из этой общины недоступно. Используйте «Исключить из общины».",
  invalid_confirmation:
    "Не удалось подтвердить удаление. Повторите подтверждение.",
  member_deletion_unavailable:
    "Удаление этого пользователя сейчас недоступно. Обновите данные и повторите попытку.",
  not_found: "Пользователь больше недоступен. Обновите список участников.",
};

function getDeletionErrorMessage(error: unknown): string {
  if (!(error instanceof ApiClientError)) {
    return "Не удалось запустить удаление. Обновите данные и повторите попытку.";
  }

  const knownMessage = KNOWN_DELETION_ERROR_MESSAGES[error.code];
  if (knownMessage) {
    return knownMessage;
  }

  if (error.code === "unauthenticated" || error.status === 401) {
    return "Сессия администратора истекла. Войдите снова и повторите попытку.";
  }

  if (error.code === "forbidden" || error.status === 403) {
    return "Недостаточно прав для удаления этого пользователя.";
  }

  if (error.code === "network_error") {
    return "Не удалось связаться с сервером. Проверьте подключение и повторите попытку.";
  }

  if (error.code === "request_timeout") {
    return "Сервер не ответил вовремя. Обновите список перед повторной попыткой.";
  }

  if (error.status >= 500 || error.code === "internal_error") {
    return "Не удалось запустить удаление из-за ошибки сервера. Повторите попытку позже.";
  }

  return "Не удалось запустить удаление. Обновите данные и повторите попытку.";
}

export function AdminMemberDeleteDialog({
  member,
  onClose,
  onConfirm,
  onDeletionStarted,
}: AdminMemberDeleteDialogProps) {
  const titleId = useId();
  const descriptionId = useId();
  const confirmationInputRef = useRef<HTMLInputElement>(null);
  const submitInFlightRef = useRef(false);
  const [confirmation, setConfirmation] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const confirmationMatches = confirmation === UI_CONFIRMATION;

  useEffect(() => {
    confirmationInputRef.current?.focus();
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }

      event.preventDefault();
      if (!submitInFlightRef.current) {
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const requestClose = () => {
    if (!submitInFlightRef.current) {
      onClose();
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!confirmationMatches || submitInFlightRef.current) {
      return;
    }

    submitInFlightRef.current = true;
    setSubmitting(true);
    setError(null);

    try {
      const deletion = await onConfirm();
      submitInFlightRef.current = false;
      setSubmitting(false);
      onDeletionStarted(deletion);
    } catch (nextError) {
      submitInFlightRef.current = false;
      setSubmitting(false);
      setError(getDeletionErrorMessage(nextError));
    }
  };

  return (
    <div className="member-delete-backdrop" onClick={requestClose}>
      <section
        aria-describedby={descriptionId}
        aria-labelledby={titleId}
        aria-modal="true"
        className="member-delete-dialog"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
      >
        <header className="member-delete-dialog__head">
          <div>
            <span>Полное удаление аккаунта</span>
            <h2 id={titleId}>Удалить пользователя?</h2>
          </div>
          <button
            aria-label="Закрыть подтверждение удаления"
            className="member-detail-drawer__close"
            disabled={submitting}
            onClick={requestClose}
            type="button"
          >
            ×
          </button>
        </header>

        <form className="member-delete-dialog__body" onSubmit={handleSubmit}>
          <dl className="member-delete-details">
            <div>
              <dt>Имя</dt>
              <dd>{member.displayName}</dd>
            </div>
            <div>
              <dt>Email</dt>
              <dd>{member.email?.trim() || "не указан"}</dd>
            </div>
            <div>
              <dt>Телефон</dt>
              <dd>{member.phone?.trim() || "не указан"}</dd>
            </div>
            <div>
              <dt>Количество регистраций</dt>
              <dd>{member.registrationsTotal}</dd>
            </div>
            <div>
              <dt>Роль / статус membership</dt>
              <dd>{formatMembership(member)}</dd>
            </div>
          </dl>

          <p className="member-delete-warning" id={descriptionId}>
            Пользователь немедленно потеряет доступ к аккаунту. Профиль, членство и
            персональные данные будут переданы в процесс удаления. Отдельные
            минимальные финансовые записи могут храниться установленный срок, если
            это требуется действующими правилами хранения.
          </p>

          <label className="member-delete-confirmation">
            <span>Введите УДАЛИТЬ для подтверждения</span>
            <input
              autoComplete="off"
              disabled={submitting}
              onChange={(event) => {
                setConfirmation(event.target.value);
                setError(null);
              }}
              placeholder="Введите УДАЛИТЬ для подтверждения"
              ref={confirmationInputRef}
              spellCheck={false}
              type="text"
              value={confirmation}
            />
          </label>

          {error ? (
            <p className="member-delete-feedback member-delete-feedback--error" role="alert">
              {error}
            </p>
          ) : null}

          {submitting ? (
            <p className="member-delete-feedback" role="status">
              Запускаем удаление...
            </p>
          ) : null}

          <footer className="member-delete-dialog__actions">
            <Button disabled={submitting} onClick={requestClose} variant="ghost">
              Отмена
            </Button>
            <Button
              className="button--member-danger"
              disabled={!confirmationMatches || submitting}
              type="submit"
            >
              {submitting ? "Запускаем удаление..." : "Удалить пользователя"}
            </Button>
          </footer>
        </form>
      </section>
    </div>
  );
}

const MEMBERSHIP_ROLE_LABELS: Record<string, string> = {
  admin: "Администратор",
  event_manager: "Менеджер событий",
  member: "Участник",
  rabbi: "Раввин",
};

const MEMBERSHIP_STATUS_LABELS: Record<string, string> = {
  active: "Активный",
  left: "Исключён / покинул",
  pending: "Ожидает",
  suspended: "Приостановлен",
};

function formatMembership(member: AdminMemberListRow): string {
  if (!member.membershipId) {
    return "Членство отсутствует";
  }

  const role = member.membershipRole
    ? MEMBERSHIP_ROLE_LABELS[member.membershipRole] ?? member.membershipRole
    : "роль не указана";
  const status = member.membershipStatus
    ? MEMBERSHIP_STATUS_LABELS[member.membershipStatus] ?? member.membershipStatus
    : "статус не указан";

  return `${role} / ${status}`;
}
