import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import {
  listWebRegistrationIdentityConflicts,
  updateWebRegistrationIdentityConflict,
} from "../../services/adminWebRegistrationOperationsService";
import type {
  AdminWebRegistrationIdentityConflict,
  WebRegistrationConflictStatus,
} from "../../types/webRegistrationOperations";
import { RegistrationsState } from "./RegistrationsState";

const CONFLICT_PAGE_SIZE = 20;

type PendingConflictUpdate = {
  conflict: AdminWebRegistrationIdentityConflict;
  status: WebRegistrationConflictStatus;
};

type IdentityConflictsPanelProps = {
  onConflictUpdated: () => Promise<void>;
  refreshRevision: number;
};

const conflictDateFormatter = new Intl.DateTimeFormat("ru-RU", {
  dateStyle: "medium",
  timeStyle: "short",
});

function compactTechnicalId(value: string | null): string {
  if (!value) {
    return "Нет";
  }

  return `…${value.slice(-8)}`;
}

function formatConflictDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : conflictDateFormatter.format(date);
}

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export function IdentityConflictsPanel({
  onConflictUpdated,
  refreshRevision,
}: IdentityConflictsPanelProps) {
  const [status, setStatus] = useState<WebRegistrationConflictStatus>("open");
  const [offset, setOffset] = useState(0);
  const [conflicts, setConflicts] = useState<AdminWebRegistrationIdentityConflict[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{
    kind: "success" | "error";
    message: string;
  } | null>(null);
  const [pendingUpdate, setPendingUpdate] = useState<PendingConflictUpdate | null>(null);
  const [actionInFlight, setActionInFlight] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const requestRevisionRef = useRef(0);
  const skipNextAutomaticLoadRef = useRef(false);

  const loadPage = useCallback(
    async (
      nextStatus: WebRegistrationConflictStatus,
      nextOffset: number,
    ): Promise<AdminWebRegistrationIdentityConflict[]> => {
      const requestRevision = requestRevisionRef.current + 1;
      requestRevisionRef.current = requestRevision;
      setLoading(true);
      setError(null);
      setConflicts([]);

      try {
        const nextConflicts = await listWebRegistrationIdentityConflicts({
          status: nextStatus,
          limit: CONFLICT_PAGE_SIZE,
          offset: nextOffset,
        });

        if (requestRevisionRef.current === requestRevision) {
          setConflicts(nextConflicts);
        }

        return nextConflicts;
      } catch (nextError) {
        if (requestRevisionRef.current === requestRevision) {
          setError(
            getErrorMessage(
              nextError,
              "Не удалось загрузить очередь конфликтов.",
            ),
          );
        }
        throw nextError;
      } finally {
        if (requestRevisionRef.current === requestRevision) {
          setLoading(false);
        }
      }
    },
    [],
  );

  useEffect(() => {
    if (skipNextAutomaticLoadRef.current) {
      skipNextAutomaticLoadRef.current = false;
      return;
    }

    void loadPage(status, offset).catch(() => undefined);
  }, [loadPage, offset, refreshRevision, status]);

  const handleFilterChange = useCallback(
    (nextStatus: WebRegistrationConflictStatus) => {
      if (nextStatus === status) {
        return;
      }

      setStatus(nextStatus);
      setOffset(0);
      setFeedback(null);
      setPendingUpdate(null);
      setActionError(null);
    },
    [status],
  );

  const requestStatusUpdate = useCallback(
    (
      conflict: AdminWebRegistrationIdentityConflict,
      nextStatus: WebRegistrationConflictStatus,
    ) => {
      if (actionInFlight) {
        return;
      }

      setActionError(null);
      setFeedback(null);
      setPendingUpdate({ conflict, status: nextStatus });
    },
    [actionInFlight],
  );

  const runStatusUpdate = useCallback(async () => {
    if (!pendingUpdate || actionInFlight) {
      return;
    }

    const { conflict, status: nextStatus } = pendingUpdate;
    setActionInFlight(conflict.id);
    setActionError(null);
    setFeedback(null);

    try {
      await updateWebRegistrationIdentityConflict(conflict.id, nextStatus);
      setPendingUpdate(null);

      const [queueResult, summaryResult] = await Promise.allSettled([
        loadPage(status, offset),
        onConflictUpdated(),
      ]);

      if (
        queueResult.status === "fulfilled"
        && queueResult.value.length === 0
        && offset > 0
      ) {
        const previousOffset = Math.max(0, offset - CONFLICT_PAGE_SIZE);
        skipNextAutomaticLoadRef.current = true;
        setOffset(previousOffset);
        await loadPage(status, previousOffset);
      }

      if (queueResult.status === "rejected" || summaryResult.status === "rejected") {
        setFeedback({
          kind: "error",
          message:
            "Статус изменён, но не все данные обновились. Нажмите «Обновить» и проверьте очередь.",
        });
      } else {
        setFeedback({
          kind: "success",
          message:
            nextStatus === "resolved"
              ? "Конфликт отмечен решённым. Пользователи и регистрации не изменены."
              : "Конфликт возвращён в открытую очередь. Пользователи и регистрации не изменены.",
        });
      }
    } catch (nextError) {
      const message = getErrorMessage(
        nextError,
        "Не удалось изменить операционный статус конфликта.",
      );
      setActionError(message);
      setFeedback({ kind: "error", message });
    } finally {
      setActionInFlight(null);
    }
  }, [actionInFlight, loadPage, offset, onConflictUpdated, pendingUpdate, status]);

  const hasPreviousPage = offset > 0;
  const hasNextPage = conflicts.length === CONFLICT_PAGE_SIZE;
  const rangeStart = conflicts.length > 0 ? offset + 1 : 0;
  const rangeEnd = offset + conflicts.length;

  return (
    <section className="identity-conflicts-panel" aria-labelledby="identity-conflicts-title">
      <div className="identity-conflicts-panel__head">
        <div>
          <span className="web-registration-operations__eyebrow">Безопасная очередь</span>
          <h3 id="identity-conflicts-title">Конфликты email и телефона</h3>
          <p>
            Email и телефон совпали с разными техническими карточками. Автоматическое
            объединение запрещено.
          </p>
        </div>
        <div className="identity-conflicts-panel__filters" aria-label="Статус конфликта">
          <Button
            aria-pressed={status === "open"}
            className={status === "open" ? "is-active" : undefined}
            disabled={loading || Boolean(actionInFlight)}
            onClick={() => handleFilterChange("open")}
            size="sm"
            variant="secondary"
          >
            Открытые
          </Button>
          <Button
            aria-pressed={status === "resolved"}
            className={status === "resolved" ? "is-active" : undefined}
            disabled={loading || Boolean(actionInFlight)}
            onClick={() => handleFilterChange("resolved")}
            size="sm"
            variant="secondary"
          >
            Решённые
          </Button>
        </div>
      </div>

      <div className="identity-conflicts-panel__boundary-note">
        Автоматическое объединение пользователей не выполняется.
      </div>

      {feedback ? (
        <div
          className={`identity-conflicts-feedback identity-conflicts-feedback--${feedback.kind}`}
          role={feedback.kind === "error" ? "alert" : "status"}
        >
          {feedback.message}
        </div>
      ) : null}

      <div className="identity-conflicts-panel__page-head">
        <span>Показано {rangeStart}-{rangeEnd}</span>
        <div className="identity-conflicts-panel__pagination">
          <Button
            disabled={!hasPreviousPage || loading || Boolean(actionInFlight)}
            onClick={() => setOffset((current) => Math.max(0, current - CONFLICT_PAGE_SIZE))}
            size="sm"
          >
            Назад
          </Button>
          <Button
            disabled={!hasNextPage || loading || Boolean(actionInFlight)}
            onClick={() => setOffset((current) => current + CONFLICT_PAGE_SIZE)}
            size="sm"
          >
            Далее
          </Button>
        </div>
      </div>

      {loading ? (
        <RegistrationsState
          description="Получаем только разрешённые технические поля конфликтов."
          title="Загрузка конфликтов"
        />
      ) : error ? (
        <RegistrationsState
          description={`Не удалось получить очередь. Ошибка: ${error}`}
          title="Конфликты не загрузились"
        >
          <Button onClick={() => void loadPage(status, offset)} size="sm">
            Повторить
          </Button>
        </RegistrationsState>
      ) : conflicts.length === 0 ? (
        <RegistrationsState
          description={
            status === "open"
              ? "Открытых конфликтов на этой странице нет."
              : "Решённых конфликтов на этой странице нет."
          }
          title="Очередь пуста"
        />
      ) : (
        <div className="identity-conflicts-list">
          {conflicts.map((conflict) => {
            const isUpdating = actionInFlight === conflict.id;
            const nextStatus = conflict.status === "open" ? "resolved" : "open";

            return (
              <article className="identity-conflict-row" key={conflict.id}>
                <div className="identity-conflict-row__title">
                  <div>
                    <span>Конфликт {compactTechnicalId(conflict.id)}</span>
                    <strong>{formatConflictDate(conflict.createdAt)}</strong>
                  </div>
                  <Badge tone={conflict.status === "open" ? "gold" : "green"}>
                    {conflict.status === "open" ? "Открыт" : "Решён"}
                  </Badge>
                </div>

                <dl className="identity-conflict-row__metadata">
                  <div>
                    <dt>Статус intent</dt>
                    <dd><Badge tone="glass">{conflict.intentStatus}</Badge></dd>
                  </div>
                  <div>
                    <dt>Event ID</dt>
                    <dd>{compactTechnicalId(conflict.eventId)}</dd>
                  </div>
                  <div>
                    <dt>Occurrence ID</dt>
                    <dd>{compactTechnicalId(conflict.occurrenceId)}</dd>
                  </div>
                  <div>
                    <dt>Email user ID</dt>
                    <dd>{compactTechnicalId(conflict.emailUserId)}</dd>
                  </div>
                  <div>
                    <dt>Phone user ID</dt>
                    <dd>{compactTechnicalId(conflict.phoneUserId)}</dd>
                  </div>
                </dl>

                <div className="identity-conflict-row__actions">
                  <span>Технические идентификаторы показаны в сокращённом виде.</span>
                  <Button
                    disabled={Boolean(actionInFlight)}
                    onClick={() => requestStatusUpdate(conflict, nextStatus)}
                    size="sm"
                    variant={conflict.status === "open" ? "gold" : "secondary"}
                  >
                    {isUpdating
                      ? "Сохраняем..."
                      : conflict.status === "open"
                        ? "Отметить решённым"
                        : "Вернуть в открытые"}
                  </Button>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {pendingUpdate ? (
        <ConflictStatusConfirmationDialog
          actionError={actionError}
          isLoading={Boolean(actionInFlight)}
          onCancel={() => {
            if (!actionInFlight) {
              setPendingUpdate(null);
              setActionError(null);
            }
          }}
          onConfirm={() => void runStatusUpdate()}
          pendingUpdate={pendingUpdate}
        />
      ) : null}
    </section>
  );
}

function ConflictStatusConfirmationDialog({
  actionError,
  isLoading,
  onCancel,
  onConfirm,
  pendingUpdate,
}: {
  actionError: string | null;
  isLoading: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  pendingUpdate: PendingConflictUpdate;
}) {
  const isResolving = pendingUpdate.status === "resolved";

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !isLoading) {
        onCancel();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isLoading, onCancel]);

  if (typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <div
      className="event-action-dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !isLoading) {
          onCancel();
        }
      }}
    >
      <section
        aria-labelledby="identity-conflict-confirmation-title"
        aria-modal="true"
        className="event-action-dialog identity-conflict-dialog"
        role="dialog"
      >
        <div className="event-action-dialog__head">
          <div>
            <Badge tone={isResolving ? "gold" : "blue"}>
              {isResolving ? "Решение конфликта" : "Повторная проверка"}
            </Badge>
            <h2 id="identity-conflict-confirmation-title">
              {isResolving ? "Отметить конфликт решённым?" : "Вернуть конфликт в открытые?"}
            </h2>
          </div>
          <Button disabled={isLoading} onClick={onCancel} variant="ghost">
            Закрыть
          </Button>
        </div>

        <div className="identity-conflict-dialog__technical-id">
          <span>Конфликт</span>
          <strong>{compactTechnicalId(pendingUpdate.conflict.id)}</strong>
        </div>

        <div className="event-action-dialog__notice identity-conflict-dialog__notice">
          {isResolving ? (
            <>
              <p>Это действие только меняет операционный статус конфликта.</p>
              <p>Пользователи не объединяются.</p>
              <p>Профили, email, телефон и регистрации не изменяются.</p>
            </>
          ) : (
            <p>
              Конфликт снова появится в открытой очереди. Пользователи, профили,
              контакты и регистрации не изменяются.
            </p>
          )}
        </div>

        {actionError ? <div className="form-error" role="alert">{actionError}</div> : null}

        <div className="event-action-dialog__actions">
          <Button disabled={isLoading} onClick={onCancel} variant="secondary">
            Отмена
          </Button>
          <Button
            disabled={isLoading}
            onClick={onConfirm}
            variant={isResolving ? "gold" : "secondary"}
          >
            {isLoading
              ? "Сохраняем..."
              : isResolving
                ? "Отметить решённым"
                : "Вернуть в открытые"}
          </Button>
        </div>
      </section>
    </div>,
    document.body,
  );
}
