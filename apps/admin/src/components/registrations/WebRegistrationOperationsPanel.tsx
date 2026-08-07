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

export function WebRegistrationOperationsPanel() {
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

  return (
    <GlassCard className="web-registration-operations" elevated>
      <div className="web-registration-operations__head">
        <div>
          <span className="web-registration-operations__eyebrow">Только для администраторов</span>
          <h2>Операции веб-регистрации</h2>
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
    </GlassCard>
  );
}
