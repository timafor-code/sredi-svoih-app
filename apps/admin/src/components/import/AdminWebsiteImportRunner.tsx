import { useId, useMemo, useState } from "react";
import { createPortal } from "react-dom";

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
  buttonLabel?: string;
  onImportFinished?: () => boolean | Promise<boolean> | void | Promise<void>;
  triggerId?: string;
  variant?: "card" | "compact";
};

type SummaryCount = {
  label: string;
  value: number | string;
};

type DedupeSummaryMessage = {
  body: string;
  existingEventsWarning: string | null;
  title: string;
};

export function AdminWebsiteImportRunner({
  buttonLabel,
  onImportFinished,
  triggerId,
  variant = "card",
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

  const trigger = (
    <Button
      disabled={running}
      id={triggerId}
      onClick={() => setConfirmOpen(true)}
      size={variant === "compact" ? "sm" : "md"}
      variant="gold"
    >
      {running ? "Запускаем..." : buttonLabel ?? "Запустить импорт в очередь проверки"}
    </Button>
  );
  const feedback = (
    <>
      {result ? (
        <ImportRunSummary
          parserErrors={parserErrors}
          queueReloaded={queueReloaded}
          result={result}
        />
      ) : null}

      {error ? <ImportRunError error={error} parserErrors={parserErrors} /> : null}
    </>
  );
  const confirmDialog =
    confirmOpen && typeof document !== "undefined"
      ? createPortal(
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
                  Будет загружена страница событий сайта и создана новая запись в журнале.
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
          </div>,
          document.body,
        )
      : null;

  return (
    <>
      {variant === "compact" ? (
        <div className="admin-import-runner admin-import-runner--compact">
          {trigger}
          {feedback}
        </div>
      ) : (
        <GlassCard className="admin-import-runner">
          <div className="admin-import-runner__head">
            <div className="admin-import-runner__title">
              <h2>Запуск импорта сайта</h2>
              <p>
                Новые события будут добавлены в очередь ручной проверки без
                автоматической публикации.
              </p>
            </div>
            {trigger}
          </div>

          {feedback}
        </GlassCard>
      )}

      {confirmDialog}
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
  const dedupeMessage = buildDedupeSummaryMessage(result.summary);

  return (
    <div className="admin-import-runner__summary" role="status">
      <div className="admin-import-runner__summary-head">
        <Badge tone="green">Импорт завершён</Badge>
        {queueReloaded === true ? <Badge tone="glass">Очередь обновлена</Badge> : null}
        {queueReloaded === false ? <Badge tone="gold">Очередь не обновилась</Badge> : null}
      </div>

      {dedupeMessage ? (
        <div className="admin-import-runner__summary-text">
          <strong>{dedupeMessage.title}</strong>
          <p>{dedupeMessage.body}</p>
          {dedupeMessage.existingEventsWarning ? (
            <p>{dedupeMessage.existingEventsWarning}</p>
          ) : null}
        </div>
      ) : (
      <div className="admin-import-runner__summary-text">
        <strong>Готово к проверке</strong>
        <p>
          Импорт завершён. Новые или обновлённые элементы можно разобрать в
          очереди проверки.
        </p>
      </div>

      )}

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
        <span>Подробности доступны в журнале запусков.</span>
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
      <strong>Ошибки разбора</strong>
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

function buildDedupeSummaryMessage(
  summary: AdminWebsiteImportSummary | null | undefined,
): DedupeSummaryMessage | null {
  const writtenCount = readSummaryNumber(summary?.itemsWrittenCount);
  const alreadyQueuedCount = readSummaryNumber(
    summary?.itemsSkippedExistingImportItemCount,
  );
  const existingEventCount = readSummaryNumber(summary?.itemsSkippedExistingEventCount);
  const checkedCount = readSummaryNumber(summary?.dedupeCheckedCount);
  const existingEventsWarning =
    existingEventCount > 0
      ? "Есть похожие события, уже добавленные в основные события приложения"
      : null;

  if (
    writtenCount === 0 &&
    alreadyQueuedCount > 0 &&
    existingEventCount === 0 &&
    alreadyQueuedCount === checkedCount
  ) {
    return {
      title: "Все события с сайта уже импортированы и находятся в очереди проверки",
      body: "Новые строки не создавались: preflight нашёл открытые import items для каждого события.",
      existingEventsWarning,
    };
  }

  if (writtenCount > 0) {
    return {
      title: `Добавлено новых: ${writtenCount}; уже были в очереди: ${alreadyQueuedCount}`,
      body: "Новые события добавлены в очередь ручной проверки без автоматической публикации.",
      existingEventsWarning,
    };
  }

  if (existingEventsWarning) {
    return {
      title: "Импорт завершён без новых строк в очереди",
      body: "Preflight пропустил события, которые уже сопоставлены с основными events приложения.",
      existingEventsWarning,
    };
  }

  return null;
}

function buildSummaryCounts(result: AdminWebsiteImportSuccessResponse): SummaryCount[] {
  const summary = result.summary ?? {};
  const rows: SummaryCount[] = [];

  pushNumberCount(rows, "Найдено", summary.foundCount);
  pushNumberCount(rows, "Распознано", summary.parsedCount);
  pushNumberCount(rows, "Ошибки разбора", summary.parserErrorCount);
  pushNumberCount(rows, "Ошибки элементов", summary.itemErrorCount);
  pushNumberCount(rows, "В очередь", summary.itemsWrittenCount);
  pushNumberCount(rows, "Добавлено", summary.itemsInsertedCount);
  pushNumberCount(rows, "Обновлено", summary.itemsUpdatedCount);
  pushNumberCount(rows, "Новые", summary.itemsNewCount);

  pushNumberCount(rows, "Пропущено", summary.itemsSkippedCount);
  pushNumberCount(rows, "Уже в очереди", summary.itemsSkippedExistingImportItemCount);
  pushNumberCount(rows, "Уже в событиях", summary.itemsSkippedExistingEventCount);
  pushNumberCount(rows, "Похожие events", summary.itemsPossibleDuplicateEventCount);

  return rows;
}

function readSummaryNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
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

function formatParserError(parserError: AdminWebsiteImportParserError): string {
  const details = [parserError.code, parserError.message, parserError.details]
    .filter(Boolean)
    .join(": ");

  return details || "Неизвестная ошибка парсера.";
}
