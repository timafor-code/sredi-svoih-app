import { useId, useMemo, useState } from "react";

import {
  AdminWebsiteImportError,
  runAdminWebsiteImportForReview,
} from "../../services/adminWebsiteImportService";
import type {
  AdminWebsiteImportParserError,
  AdminWebsiteImportSuccessResponse,
  AdminWebsiteImportSummary,
} from "../../types/websiteImport";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { GlassCard } from "../ui/GlassCard";

type AdminWebsiteImportRunnerProps = {
  onImportFinished?: () => boolean | Promise<boolean> | void | Promise<void>;
};

type SummaryCount = {
  label: string;
  value: number | string;
};

export function AdminWebsiteImportRunner({
  onImportFinished,
}: AdminWebsiteImportRunnerProps) {
  const dialogTitleId = useId();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<AdminWebsiteImportSuccessResponse | null>(null);
  const [error, setError] = useState<AdminWebsiteImportError | Error | null>(null);
  const [queueReloaded, setQueueReloaded] = useState<boolean | null>(null);

  const parserErrors = useMemo(() => {
    if (result?.summary?.parserErrors?.length) {
      return result.summary.parserErrors;
    }

    if (error instanceof AdminWebsiteImportError) {
      return error.parserErrors;
    }

    return [];
  }, [error, result]);

  const handleStart = async () => {
    if (running) {
      return;
    }

    setConfirmOpen(false);
    setRunning(true);
    setError(null);
    setResult(null);
    setQueueReloaded(null);

    try {
      const nextResult = await runAdminWebsiteImportForReview();
      let nextQueueReloaded: boolean | null = null;

      if (onImportFinished) {
        try {
          const reloadResult = await onImportFinished();
          nextQueueReloaded = reloadResult === false ? false : true;
        } catch {
          nextQueueReloaded = false;
        }
      }

      setResult(nextResult);
      setQueueReloaded(nextQueueReloaded);
    } catch (nextError) {
      setResult(null);
      setError(
        nextError instanceof Error
          ? nextError
          : new Error("Не удалось запустить импорт сайта."),
      );
    } finally {
      setRunning(false);
    }
  };

  return (
    <>
      <GlassCard className="admin-import-runner">
        <div className="admin-import-runner__head">
          <div className="admin-import-runner__title">
            <div className="badge-row">
              <Badge tone="gold">apply_review_only</Badge>
              <Badge tone="glass">Edge Function</Badge>
            </div>
            <h2>Запуск импорта сайта</h2>
            <p>
              Кнопка вызывает admin-website-import с текущей Supabase-сессией и
              создаёт только данные очереди проверки.
            </p>
          </div>
          <Button disabled={running} onClick={() => setConfirmOpen(true)} variant="gold">
            {running ? "Запускаем..." : "Запустить импорт в очередь проверки"}
          </Button>
        </div>

        {result ? (
          <ImportRunSummary
            parserErrors={parserErrors}
            queueReloaded={queueReloaded}
            result={result}
          />
        ) : null}

        {error ? (
          <ImportRunError error={error} parserErrors={parserErrors} />
        ) : null}
      </GlassCard>

      {confirmOpen ? (
        <div
          className="event-action-dialog-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !running) {
              setConfirmOpen(false);
            }
          }}
        >
          <section
            aria-labelledby={dialogTitleId}
            aria-modal="true"
            className="event-action-dialog admin-import-confirm"
            role="dialog"
          >
            <div className="event-action-dialog__head">
              <div>
                <Badge tone="gold">Подтверждение</Badge>
                <h2 id={dialogTitleId}>Запустить импорт?</h2>
              </div>
              <Button disabled={running} onClick={() => setConfirmOpen(false)} variant="ghost">
                Закрыть
              </Button>
            </div>

            <div className="event-action-dialog__notice admin-import-confirm__notice">
              <p>
                Будет загружена страница событий сайта и создан новый import run.
                События не будут опубликованы автоматически. Спорные элементы попадут
                в очередь проверки.
              </p>
            </div>

            <div className="event-action-dialog__actions">
              <Button disabled={running} onClick={() => setConfirmOpen(false)}>
                Отмена
              </Button>
              <Button disabled={running} onClick={() => void handleStart()} variant="gold">
                {running ? "Запускаем..." : "Начать импорт"}
              </Button>
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}

function ImportRunSummary({
  parserErrors,
  queueReloaded,
  result,
}: {
  parserErrors: AdminWebsiteImportParserError[];
  queueReloaded: boolean | null;
  result: AdminWebsiteImportSuccessResponse;
}) {
  const counts = buildSummaryCounts(result);
  const parserLabel = [result.parser?.name, result.parser?.version].filter(Boolean).join(" ");

  return (
    <div className="admin-import-runner__summary" role="status">
      <div className="admin-import-runner__summary-head">
        <Badge tone="green">Импорт завершён</Badge>
        {queueReloaded === true ? <Badge tone="glass">Очередь обновлена</Badge> : null}
        {queueReloaded === false ? <Badge tone="gold">Очередь не обновилась</Badge> : null}
      </div>

      <div className="admin-import-runner__summary-text">
        <strong>Summary Edge Function</strong>
        <p>
          {result.run?.status ? `Run status: ${result.run.status}. ` : ""}
          {parserLabel ? `Parser: ${parserLabel}. ` : ""}
          {result.sourceUrl ? `Source: ${result.sourceUrl}.` : ""}
        </p>
      </div>

      {counts.length > 0 ? (
        <dl className="admin-import-runner__count-grid">
          {counts.map((count) => (
            <div className="admin-import-runner__count" key={count.label}>
              <dt>{count.label}</dt>
              <dd>{count.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}

      {parserErrors.length > 0 ? (
        <ParserErrorList parserErrors={parserErrors} tone="warning" />
      ) : null}
    </div>
  );
}

function ImportRunError({
  error,
  parserErrors,
}: {
  error: Error;
  parserErrors: AdminWebsiteImportParserError[];
}) {
  return (
    <div className="admin-import-runner__status admin-import-runner__status--error" role="alert">
      <strong>{error.message}</strong>
      {error instanceof AdminWebsiteImportError && error.runId ? (
        <span>Run ID: {error.runId}</span>
      ) : null}
      {parserErrors.length > 0 ? (
        <ParserErrorList parserErrors={parserErrors} tone="error" />
      ) : null}
    </div>
  );
}

function ParserErrorList({
  parserErrors,
  tone,
}: {
  parserErrors: AdminWebsiteImportParserError[];
  tone: "error" | "warning";
}) {
  return (
    <div
      className={`admin-import-runner__parser-errors admin-import-runner__parser-errors--${tone}`}
    >
      <strong>Parser errors</strong>
      <ul>
        {parserErrors.slice(0, 6).map((parserError, index) => (
          <li key={`${parserError.code ?? "parser-error"}-${index}`}>
            {formatParserError(parserError)}
          </li>
        ))}
      </ul>
      {parserErrors.length > 6 ? <span>Ещё ошибок: {parserErrors.length - 6}</span> : null}
    </div>
  );
}

function buildSummaryCounts(result: AdminWebsiteImportSuccessResponse): SummaryCount[] {
  const summary = result.summary ?? {};
  const rows: SummaryCount[] = [];

  pushStringCount(rows, "Run ID", result.run?.runId);
  pushNumberCount(rows, "Found", summary.foundCount);
  pushNumberCount(rows, "Parsed", summary.parsedCount);
  pushNumberCount(rows, "Parser errors", summary.parserErrorCount);
  pushNumberCount(rows, "Item errors", summary.itemErrorCount);
  pushNumberCount(rows, "Import items", summary.itemsWrittenCount);
  pushNumberCount(rows, "Inserted", summary.itemsInsertedCount);
  pushNumberCount(rows, "Updated", summary.itemsUpdatedCount);
  pushNumberCount(rows, "New items", summary.itemsNewCount);

  return rows;
}

function pushNumberCount(
  rows: SummaryCount[],
  label: string,
  value: AdminWebsiteImportSummary[keyof AdminWebsiteImportSummary],
) {
  if (typeof value === "number" && Number.isFinite(value)) {
    rows.push({ label, value });
  }
}

function pushStringCount(
  rows: SummaryCount[],
  label: string,
  value: string | null | undefined,
) {
  const normalized = value?.trim();

  if (normalized) {
    rows.push({ label, value: normalized });
  }
}

function formatParserError(parserError: AdminWebsiteImportParserError): string {
  const details = [parserError.code, parserError.message, parserError.details]
    .filter(Boolean)
    .join(": ");

  return details || "Неизвестная ошибка парсера.";
}
