import type { ReactNode } from "react";

import type { AdminBadgeTone } from "../../types/admin";
import type { AdminImportRun, AdminImportRunStatus } from "../../types/websiteImport";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { GlassCard } from "../ui/GlassCard";

type AdminImportRunHistoryProps = {
  error: string | null;
  loading: boolean;
  onRefresh: () => void;
  runs: AdminImportRun[];
};

const RUN_STATUS_LABELS: Record<AdminImportRunStatus, string> = {
  started: "В процессе",
  success: "Успешно",
  failed: "Ошибка",
};

export function AdminImportRunHistory({
  error,
  loading,
  onRefresh,
  runs,
}: AdminImportRunHistoryProps) {
  const latestRun = runs[0] ?? null;

  return (
    <GlassCard className="admin-import-history">
      <div className="admin-import-history__head">
        <div className="admin-import-history__title">
          <div className="badge-row">
            {latestRun ? (
              <Badge tone={getAdminImportRunStatusTone(latestRun.status)}>
                Последний: {formatAdminImportRunStatusLabel(latestRun.status)}
              </Badge>
            ) : null}
          </div>
          <h2>Журнал запусков импорта</h2>
          <p>Последние запуски по текущей активной общине.</p>
        </div>
        <Button disabled={loading} onClick={onRefresh}>
          {loading ? "Обновляем..." : "Обновить журнал"}
        </Button>
      </div>

      {latestRun ? (
        <div
          className={`admin-import-history__latest admin-import-history__latest--${latestRun.status}`}
        >
          <span>Последний запуск</span>
          <strong>{formatAdminImportRunStatusLabel(latestRun.status)}</strong>
          <small>
            {latestRun.sourceName ? `${latestRun.sourceName} · ` : ""}
            {formatDateTime(latestRun.startedAt)}
          </small>
        </div>
      ) : null}

      {loading ? (
        <ImportHistoryState
          description="Загружаем последние запуски импорта."
          title="Загрузка журнала запусков"
        />
      ) : error ? (
        <ImportHistoryState description={error} title="Не удалось загрузить журнал">
          <Button onClick={onRefresh} variant="primary">
            Повторить
          </Button>
        </ImportHistoryState>
      ) : runs.length === 0 ? (
        <ImportHistoryState
          description="Запусков импорта пока нет"
          title="Журнал запусков пуст"
        />
      ) : (
        <div className="admin-import-history__list" aria-label="Журнал запусков импорта">
          {runs.map((run) => (
            <article
              className={`admin-import-history__row admin-import-history__row--${run.status}`}
              key={run.id}
            >
              <div className="admin-import-history__row-head">
                <div className="admin-import-history__source">
                  <Badge tone={getAdminImportRunStatusTone(run.status)}>
                    {formatAdminImportRunStatusLabel(run.status)}
                  </Badge>
                  <strong>{run.sourceName || "Источник без названия"}</strong>
                </div>
                <code>{run.id}</code>
              </div>

              <div className="admin-import-history__meta">
                <ImportRunField label="Начат" value={formatDateTime(run.startedAt)} />
                <ImportRunField label="Завершён" value={formatDateTime(run.finishedAt)} />
              </div>

              <dl className="admin-import-history__counts">
                <ImportRunCount label="Найдено" value={run.foundCount} />
                <ImportRunCount label="Создано" value={run.createdCount} />
                <ImportRunCount label="Обновлено" value={run.updatedCount} />
              </dl>

              {run.error ? (
                <div className="admin-import-history__error" role="note">
                  <span>Ошибка</span>
                  <strong>{formatRunError(run.error)}</strong>
                </div>
              ) : null}
            </article>
          ))}
        </div>
      )}
    </GlassCard>
  );
}

function ImportRunField({ label, value }: { label: string; value: string }) {
  return (
    <div className="admin-import-history__field">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function ImportRunCount({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function ImportHistoryState({
  children,
  description,
  title,
}: {
  children?: ReactNode;
  description: string;
  title: string;
}) {
  return (
    <div className="events-state" role="status">
      <h3>{title}</h3>
      <p>{description}</p>
      {children ? <div className="events-state__actions">{children}</div> : null}
    </div>
  );
}

export function getAdminImportRunStatusTone(status: AdminImportRunStatus): AdminBadgeTone {
  if (status === "success") {
    return "green";
  }

  if (status === "failed") {
    return "red";
  }

  return "gold";
}

export function formatAdminImportRunStatusLabel(status: AdminImportRunStatus): string {
  return RUN_STATUS_LABELS[status] ?? status;
}

function formatRunError(error: string): string {
  const normalized = error.trim();

  if (!normalized) {
    return "Ошибка не указана.";
  }

  if (normalized === "stale_import_run_timed_out") {
    return "Запуск не завершился вовремя и был помечен как failed.";
  }

  if (/^[a-z0-9_]+$/.test(normalized)) {
    return normalized.replaceAll("_", " ");
  }

  return normalized;
}

function formatDateTime(value: string | null): string {
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
