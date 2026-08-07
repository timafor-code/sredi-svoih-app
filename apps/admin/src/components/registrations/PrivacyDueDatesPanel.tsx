import { useCallback, useEffect, useRef, useState } from "react";

import { listAdminPrivacyDueDates } from "../../services/adminPrivacyDueDatesService";
import type {
  AdminPrivacyDueDateFilter,
  AdminPrivacyDueDateItem,
  AdminPrivacyRequestStatus,
  AdminPrivacyRequestType,
} from "../../types/privacyDueDates";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { RegistrationsState } from "./RegistrationsState";

type PrivacyDueDatesPanelProps = {
  refreshRevision: number;
};

const privacyDateFormatter = new Intl.DateTimeFormat("ru-RU", {
  dateStyle: "medium",
  timeStyle: "short",
});

const requestTypeLabels: Record<AdminPrivacyRequestType, string> = {
  data_export: "Выгрузка данных",
  deletion: "Удаление данных",
  correction: "Исправление данных",
  other: "Другое",
};

const statusLabels: Record<AdminPrivacyRequestStatus, string> = {
  open: "Открыт",
  reviewed: "На рассмотрении",
  resolved: "Решён",
  rejected: "Отклонён",
  closed: "Закрыт",
};

const statusTones: Record<
  AdminPrivacyRequestStatus,
  "gold" | "blue" | "green" | "red" | "glass"
> = {
  open: "gold",
  reviewed: "blue",
  resolved: "green",
  rejected: "red",
  closed: "glass",
};

const terminalStatuses = new Set<AdminPrivacyRequestStatus>([
  "resolved",
  "rejected",
  "closed",
]);

function compactTechnicalId(value: string): string {
  return `…${value.slice(-8)}`;
}

function formatPrivacyDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : privacyDateFormatter.format(date);
}

function isOverdue(item: AdminPrivacyDueDateItem): boolean {
  if (!item.dueAt || terminalStatuses.has(item.status)) {
    return false;
  }

  const dueAt = new Date(item.dueAt).getTime();
  return !Number.isNaN(dueAt) && dueAt < Date.now();
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "Не удалось загрузить сроки запросов по персональным данным.";
}

export function PrivacyDueDatesPanel({ refreshRevision }: PrivacyDueDatesPanelProps) {
  const [filter, setFilter] = useState<AdminPrivacyDueDateFilter>("all");
  const [items, setItems] = useState<AdminPrivacyDueDateItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestRevisionRef = useRef(0);

  const loadPrivacyDueDates = useCallback(
    async (nextFilter: AdminPrivacyDueDateFilter): Promise<void> => {
      const requestRevision = requestRevisionRef.current + 1;
      requestRevisionRef.current = requestRevision;
      setLoading(true);
      setError(null);
      setItems([]);

      try {
        const nextItems = await listAdminPrivacyDueDates({ filter: nextFilter });

        if (requestRevisionRef.current === requestRevision) {
          setItems(nextItems);
        }
      } catch (nextError) {
        if (requestRevisionRef.current === requestRevision) {
          setError(getErrorMessage(nextError));
        }
      } finally {
        if (requestRevisionRef.current === requestRevision) {
          setLoading(false);
        }
      }
    },
    [],
  );

  useEffect(() => {
    void loadPrivacyDueDates(filter);
  }, [filter, loadPrivacyDueDates, refreshRevision]);

  return (
    <section
      className="privacy-due-dates-panel"
      aria-labelledby="privacy-due-dates-title"
    >
      <div className="privacy-due-dates-panel__head">
        <div>
          <h3 id="privacy-due-dates-title">Сроки запросов по персональным данным</h3>
          <p>
            Контроль сроков обработки запросов. Содержимое обращений и персональные
            данные здесь не показываются.
          </p>
        </div>
        <div className="privacy-due-dates-panel__controls">
          <div
            className="privacy-due-dates-panel__filters"
            aria-label="Фильтр сроков запросов"
          >
            <Button
              aria-pressed={filter === "all"}
              className={filter === "all" ? "is-active" : undefined}
              disabled={loading}
              onClick={() => setFilter("all")}
              size="sm"
              variant="secondary"
            >
              Все
            </Button>
            <Button
              aria-pressed={filter === "overdue"}
              className={filter === "overdue" ? "is-active" : undefined}
              disabled={loading}
              onClick={() => setFilter("overdue")}
              size="sm"
              variant="secondary"
            >
              Просроченные
            </Button>
          </div>
          <Button
            disabled={loading}
            onClick={() => void loadPrivacyDueDates(filter)}
            size="sm"
          >
            {loading ? "Обновляем..." : "Обновить"}
          </Button>
        </div>
      </div>

      {loading ? (
        <RegistrationsState
          description="Получаем только тип, статус, дату создания и установленный FastAPI срок."
          title="Загрузка сроков запросов"
        />
      ) : error ? (
        <RegistrationsState
          description={`Не удалось получить сроки запросов. Ошибка: ${error}`}
          title="Сроки запросов не загрузились"
        >
          <Button onClick={() => void loadPrivacyDueDates(filter)} size="sm">
            Повторить
          </Button>
        </RegistrationsState>
      ) : items.length === 0 ? (
        <RegistrationsState
          description="Содержимое обращений и персональные данные не запрашиваются."
          title={
            filter === "overdue"
              ? "Просроченных запросов нет."
              : "Запросов по персональным данным нет."
          }
        />
      ) : (
        <div className="privacy-due-dates-list">
          {items.map((item) => {
            const overdue = isOverdue(item);

            return (
              <article
                className={
                  `privacy-due-date-row${overdue ? " privacy-due-date-row--overdue" : ""}`
                }
                key={item.id}
              >
                <div className="privacy-due-date-row__title">
                  <div>
                    <span>Технический идентификатор</span>
                    <strong>{compactTechnicalId(item.id)}</strong>
                  </div>
                  {overdue ? <Badge tone="red">Просрочено</Badge> : null}
                </div>

                <dl className="privacy-due-date-row__metadata">
                  <div>
                    <dt>Тип запроса</dt>
                    <dd>{requestTypeLabels[item.requestType]}</dd>
                  </div>
                  <div>
                    <dt>Статус</dt>
                    <dd>
                      <Badge tone={statusTones[item.status]}>
                        {statusLabels[item.status]}
                      </Badge>
                    </dd>
                  </div>
                  <div>
                    <dt>Создан</dt>
                    <dd>{formatPrivacyDate(item.createdAt)}</dd>
                  </div>
                  <div>
                    <dt>Срок</dt>
                    <dd>
                      {item.dueAt
                        ? formatPrivacyDate(item.dueAt)
                        : "Срок не установлен"}
                    </dd>
                  </div>
                </dl>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
