import { useCallback, useEffect, useState } from "react";

import { getWebRegistrationOperationsSummary } from "../../services/adminWebRegistrationOperationsService";
import type { AdminWebRegistrationOperationsSummary } from "../../types/webRegistrationOperations";
import { Button } from "../ui/Button";
import { GlassCard } from "../ui/GlassCard";
import { IdentityConflictsPanel } from "./IdentityConflictsPanel";
import { PrivacyDueDatesPanel } from "./PrivacyDueDatesPanel";

type SummaryCardProps = {
  label: string;
  loading: boolean;
  note?: string;
  value: number | null;
};

function SummaryCard({ label, loading, note, value }: SummaryCardProps) {
  return (
    <article className="web-registration-summary-card">
      <span>{label}</span>
      <strong aria-label={loading ? `${label}: загрузка` : undefined}>
        {loading ? "—" : (value ?? "—")}
      </strong>
      {note ? <p>{note}</p> : null}
    </article>
  );
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "Не удалось загрузить операционную сводку.";
}

function formatAttentionCount(count: number): string {
  const usesSingularVerb = count % 10 === 1 && count % 100 !== 11;

  return `${count} ${usesSingularVerb ? "требует" : "требуют"} внимания`;
}

export function WebRegistrationOperationsPanel() {
  const [isExpanded, setIsExpanded] = useState(false);
  const [summary, setSummary] = useState<AdminWebRegistrationOperationsSummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [queueRefreshRevision, setQueueRefreshRevision] = useState(0);

  const loadSummary = useCallback(async (): Promise<void> => {
    setSummaryLoading(true);
    setSummaryError(null);

    try {
      setSummary(await getWebRegistrationOperationsSummary());
    } catch (error) {
      setSummaryError(getErrorMessage(error));
      throw error;
    } finally {
      setSummaryLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSummary().catch(() => undefined);
  }, [loadSummary]);

  const refreshOperations = useCallback(() => {
    setQueueRefreshRevision((current) => current + 1);
    void loadSummary().catch(() => undefined);
  }, [loadSummary]);

  const privacyNote = "Детали по срокам показаны ниже.";
  const attentionCount = summary
    ? summary.activeEmailVerificationIntents +
      summary.openIdentityConflicts +
      summary.overduePrivacyRequests
    : null;

  let statusLabel = "Загрузка…";
  let statusTone = "loading";

  if (!summaryLoading) {
    if (summaryError) {
      statusLabel = "Ошибка загрузки";
      statusTone = "error";
    } else if (attentionCount === null) {
      statusLabel = "Нет данных";
      statusTone = "neutral";
    } else if (attentionCount > 0) {
      statusLabel = formatAttentionCount(attentionCount);
      statusTone = "attention";
    } else {
      statusLabel = "Нет задач";
      statusTone = "neutral";
    }
  }

  return (
    <GlassCard className="web-registration-operations" elevated>
      <button
        aria-controls="web-registration-operations-content"
        aria-expanded={isExpanded}
        aria-label={`${isExpanded ? "Свернуть" : "Развернуть"} операции веб-регистрации`}
        className="web-registration-operations__disclosure"
        id="web-registration-operations-disclosure"
        onClick={() => setIsExpanded((current) => !current)}
        type="button"
      >
        <span className="web-registration-operations__disclosure-main">
          <span className="web-registration-operations__title">Операции веб-регистрации</span>
          <span
            className={`web-registration-operations__status web-registration-operations__status--${statusTone}`}
          >
            {statusLabel}
          </span>
        </span>
        <span aria-hidden="true" className="web-registration-operations__chevron">
          ▼
        </span>
      </button>

      <div
        aria-labelledby="web-registration-operations-disclosure"
        className="web-registration-operations__content"
        hidden={!isExpanded}
        id="web-registration-operations-content"
        role="region"
      >
        <div className="web-registration-operations__head">
          <div>
            <span className="web-registration-operations__eyebrow">
              Только для администраторов
            </span>
            <p>
              Агрегированная сводка и безопасная очередь технических конфликтов без
              контактных данных.
            </p>
          </div>
          <Button disabled={summaryLoading} onClick={refreshOperations} size="sm">
            {summaryLoading ? "Обновляем..." : "Обновить"}
          </Button>
        </div>

        {summaryError ? (
          <div className="web-registration-operations__error" role="alert">
            <span>Сводка не загрузилась: {summaryError}</span>
            <Button onClick={() => void loadSummary()} size="sm">
              Повторить
            </Button>
          </div>
        ) : null}

        <div className="web-registration-summary-grid" aria-busy={summaryLoading}>
          <SummaryCard
            label="Ожидают подтверждения email"
            loading={summaryLoading}
            value={summary?.activeEmailVerificationIntents ?? null}
          />
          <SummaryCard
            label="Открытые конфликты"
            loading={summaryLoading}
            value={summary?.openIdentityConflicts ?? null}
          />
          <SummaryCard
            label="Открытые запросы по данным"
            loading={summaryLoading}
            note={privacyNote}
            value={summary?.openPrivacyRequests ?? null}
          />
          <SummaryCard
            label="Просроченные запросы"
            loading={summaryLoading}
            note={privacyNote}
            value={summary?.overduePrivacyRequests ?? null}
          />
        </div>

        <IdentityConflictsPanel
          onConflictUpdated={loadSummary}
          refreshRevision={queueRefreshRevision}
        />

        <PrivacyDueDatesPanel refreshRevision={queueRefreshRevision} />
      </div>
    </GlassCard>
  );
}
