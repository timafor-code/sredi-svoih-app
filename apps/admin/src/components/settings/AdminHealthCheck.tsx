import { useCallback, useEffect, useState } from "react";

import {
  runAdminHealthCheck,
  type AdminHealthCheckStatus,
  type AdminHealthReport,
} from "../../services/adminHealthService";
import { Button } from "../ui/Button";
import { GlassCard } from "../ui/GlassCard";

const STATUS_LABELS: Record<AdminHealthCheckStatus, string> = {
  ok: "ok",
  warning: "warning",
  error: "error",
  skipped: "skipped",
};

export function AdminHealthCheck() {
  const [report, setReport] = useState<AdminHealthReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const runCheck = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const nextReport = await runAdminHealthCheck();
      setReport(nextReport);
    } catch {
      setReport(null);
      setError("Не удалось выполнить health-check. Проверьте сессию и staging env.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void runCheck();
  }, [runCheck]);

  return (
    <GlassCard className="admin-health-check" elevated>
      <div className="admin-health-check__head">
        <div className="admin-health-check__title">
          <span>Staging</span>
          <h2>Health check</h2>
          <p>Базовая готовность web-admin окружения.</p>
        </div>
        <Button disabled={loading} onClick={() => void runCheck()} size="sm">
          {loading ? "Проверяем..." : "Проверить снова"}
        </Button>
      </div>

      {error ? (
        <div className="admin-health-check__state admin-health-check__state--error" role="alert">
          {error}
        </div>
      ) : null}

      {loading && !report ? (
        <div className="admin-health-check__state" role="status">
          Проверяем окружение...
        </div>
      ) : null}

      {report ? (
        <>
          <div className="admin-health-check__summary" aria-live="polite">
            <span
              className={`admin-health-check__status admin-health-check__status--${report.summaryStatus}`}
            >
              {STATUS_LABELS[report.summaryStatus]}
            </span>
            <span className="admin-health-check__checked-at">
              Последняя проверка: {formatCheckedAt(report.checkedAt)}
            </span>
          </div>

          <ul className="admin-health-check__list">
            {report.checks.map((check) => (
              <li className="admin-health-check__item" key={check.id}>
                <div className="admin-health-check__item-main">
                  <strong>{check.label}</strong>
                  <p>{check.description}</p>
                </div>
                <span
                  className={`admin-health-check__status admin-health-check__status--${check.status}`}
                >
                  {STATUS_LABELS[check.status]}
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </GlassCard>
  );
}

function formatCheckedAt(value: string): string {
  const checkedAt = new Date(value);

  if (Number.isNaN(checkedAt.getTime())) {
    return "только что";
  }

  return checkedAt.toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
