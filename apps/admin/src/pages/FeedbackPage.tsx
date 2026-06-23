import { type ChangeEvent, useCallback, useEffect, useState } from "react";

import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { GlassCard } from "../components/ui/GlassCard";
import { listAdminFeedback, updateAdminFeedbackStatus } from "../services/adminFeedbackService";
import type { AdminBadgeTone } from "../types/admin";
import {
  ADMIN_FEEDBACK_SEVERITIES,
  ADMIN_FEEDBACK_STATUSES,
  type AdminFeedbackItem,
  type AdminFeedbackSeverity,
  type AdminFeedbackStatus,
} from "../types/feedback";

type StatusFilter = AdminFeedbackStatus | "all";
type SeverityFilter = AdminFeedbackSeverity | "all";

type StatusAction = {
  label: string;
  status: AdminFeedbackStatus;
  variant?: "primary" | "secondary" | "ghost" | "gold" | "success";
};

const STATUS_FILTER_OPTIONS: Array<{ label: string; value: StatusFilter }> = [
  ...ADMIN_FEEDBACK_STATUSES.map((status) => ({
    value: status,
    label: status,
  })),
  { value: "all", label: "All" },
];

const SEVERITY_FILTER_OPTIONS: Array<{ label: string; value: SeverityFilter }> = [
  { value: "all", label: "All" },
  ...ADMIN_FEEDBACK_SEVERITIES.map((severity) => ({
    value: severity,
    label: severity,
  })),
];

export function FeedbackPage() {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("open");
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>("all");
  const [sectionFilter, setSectionFilter] = useState("");
  const [items, setItems] = useState<AdminFeedbackItem[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const loadFeedback = useCallback(async () => {
    setLoading(true);
    setErrorMessage(null);

    try {
      const response = await listAdminFeedback({
        status: statusFilter,
        severity: severityFilter,
        section: sectionFilter,
        limit: 50,
        offset: 0,
      });
      setItems(response.items);
      setTotalCount(response.totalCount);
    } catch (error) {
      setItems([]);
      setTotalCount(0);
      setErrorMessage(
        error instanceof Error ? error.message : "Не удалось загрузить feedback.",
      );
    } finally {
      setLoading(false);
    }
  }, [sectionFilter, severityFilter, statusFilter]);

  useEffect(() => {
    void loadFeedback();
  }, [loadFeedback]);

  const handleStatusFilterChange = (event: ChangeEvent<HTMLSelectElement>) => {
    setStatusFilter(event.target.value as StatusFilter);
  };

  const handleSeverityFilterChange = (event: ChangeEvent<HTMLSelectElement>) => {
    setSeverityFilter(event.target.value as SeverityFilter);
  };

  const handleStatusAction = async (
    item: AdminFeedbackItem,
    nextStatus: AdminFeedbackStatus,
  ) => {
    if (updatingId) {
      return;
    }

    setUpdatingId(item.id);
    setActionError(null);

    try {
      await updateAdminFeedbackStatus({ id: item.id, status: nextStatus });
      await loadFeedback();
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : "Не удалось обновить статус feedback.",
      );
    } finally {
      setUpdatingId(null);
    }
  };

  const resetFilters = () => {
    setStatusFilter("open");
    setSeverityFilter("all");
    setSectionFilter("");
  };

  return (
    <div className="admin-feedback-page page-stack">
      <section className="page-header">
        <Badge tone="gold">admin only</Badge>
        <h1>Beta feedback / Обратная связь beta</h1>
        <p>
          Inbox для замечаний из web-admin beta. Список и смена статуса доступны
          только admin через RPC; event_manager сохраняет только submit flow.
        </p>
      </section>

      <GlassCard className="admin-feedback-filters" elevated>
        <label className="admin-feedback-filters__field">
          <span>Status</span>
          <select onChange={handleStatusFilterChange} value={statusFilter}>
            {STATUS_FILTER_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label className="admin-feedback-filters__field">
          <span>Severity</span>
          <select onChange={handleSeverityFilterChange} value={severityFilter}>
            {SEVERITY_FILTER_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label className="admin-feedback-filters__field">
          <span>Section</span>
          <input
            maxLength={80}
            onChange={(event) => setSectionFilter(event.target.value)}
            placeholder="overview, events, registrations..."
            value={sectionFilter}
          />
        </label>

        <div className="admin-feedback-filters__actions">
          <Button disabled={loading} onClick={() => void loadFeedback()} variant="primary">
            {loading ? "Refreshing..." : "Refresh"}
          </Button>
          <Button disabled={loading} onClick={resetFilters} variant="ghost">
            Reset
          </Button>
        </div>
      </GlassCard>

      <div className="admin-feedback-status" role="status">
        <span>
          {loading
            ? "Loading feedback..."
            : `Shown ${items.length} of ${totalCount} matching feedback items`}
        </span>
        {updatingId ? <strong>Updating status...</strong> : null}
      </div>

      {actionError ? (
        <div className="admin-feedback-page__state admin-feedback-page__state--error" role="alert">
          {actionError}
        </div>
      ) : null}

      {errorMessage ? (
        <GlassCard className="admin-feedback-page__state admin-feedback-page__state--error" elevated>
          <strong>Не удалось загрузить feedback.</strong>
          <span>{errorMessage}</span>
        </GlassCard>
      ) : null}

      {!loading && !errorMessage && items.length === 0 ? (
        <GlassCard className="admin-feedback-page__state" elevated>
          <strong>Feedback не найден.</strong>
          <span>Попробуйте сменить status, severity или section filter.</span>
        </GlassCard>
      ) : null}

      {items.length > 0 ? (
        <section className="admin-feedback-list" aria-label="Feedback items">
          {items.map((item) => (
            <FeedbackCard
              item={item}
              key={item.id}
              onStatusAction={handleStatusAction}
              updatingId={updatingId}
            />
          ))}
        </section>
      ) : null}
    </div>
  );
}

function FeedbackCard({
  item,
  onStatusAction,
  updatingId,
}: {
  item: AdminFeedbackItem;
  onStatusAction: (item: AdminFeedbackItem, nextStatus: AdminFeedbackStatus) => void;
  updatingId: string | null;
}) {
  const isUpdating = updatingId === item.id;
  const isAnyItemUpdating = Boolean(updatingId);
  const safeUrl = item.url ? getSafeUrl(item.url) : null;

  return (
    <GlassCard className="admin-feedback-card" elevated>
      <header className="admin-feedback-card__head">
        <div className="admin-feedback-card__badges">
          <Badge tone={getSeverityTone(item.severity)}>{item.severity}</Badge>
          <Badge tone={getStatusTone(item.status)}>{item.status}</Badge>
        </div>
        <time dateTime={item.createdAt}>{formatDateTime(item.createdAt)}</time>
      </header>

      <p className="admin-feedback-card__message">{item.message}</p>

      <dl className="admin-feedback-card__meta">
        <div>
          <dt>Section</dt>
          <dd>{item.section}</dd>
        </div>
        <div>
          <dt>User ID</dt>
          <dd>
            <code>{item.userId}</code>
          </dd>
        </div>
        {item.updatedAt ? (
          <div>
            <dt>Updated</dt>
            <dd>{formatDateTime(item.updatedAt)}</dd>
          </div>
        ) : null}
        {item.resolvedAt ? (
          <div>
            <dt>Resolved</dt>
            <dd>{formatDateTime(item.resolvedAt)}</dd>
          </div>
        ) : null}
        {item.resolvedBy ? (
          <div>
            <dt>Resolved by</dt>
            <dd>
              <code>{item.resolvedBy}</code>
            </dd>
          </div>
        ) : null}
        {item.entityType || item.entityId ? (
          <div>
            <dt>Entity</dt>
            <dd>
              {[item.entityType, item.entityId].filter(Boolean).join(" · ")}
            </dd>
          </div>
        ) : null}
        {item.url ? (
          <div className="admin-feedback-card__meta-wide">
            <dt>URL</dt>
            <dd>
              {safeUrl ? (
                <a href={safeUrl} rel="noreferrer" target="_blank">
                  {item.url}
                </a>
              ) : (
                item.url
              )}
            </dd>
          </div>
        ) : null}
      </dl>

      {item.userAgent ? (
        <details className="admin-feedback-card__agent">
          <summary>User agent</summary>
          <code>{item.userAgent}</code>
        </details>
      ) : null}

      <div className="admin-feedback-actions" aria-label="Feedback status actions">
        {getStatusActions(item.status).map((action) => (
          <Button
            disabled={isAnyItemUpdating}
            key={action.status}
            onClick={() => onStatusAction(item, action.status)}
            size="sm"
            variant={action.variant ?? "secondary"}
          >
            {isUpdating ? "Updating..." : action.label}
          </Button>
        ))}
      </div>
    </GlassCard>
  );
}

function getStatusActions(status: AdminFeedbackStatus): StatusAction[] {
  if (status === "open") {
    return [
      { status: "reviewed", label: "Mark reviewed", variant: "secondary" },
      { status: "resolved", label: "Mark resolved", variant: "success" },
      { status: "closed", label: "Close", variant: "ghost" },
    ];
  }

  if (status === "reviewed") {
    return [
      { status: "resolved", label: "Mark resolved", variant: "success" },
      { status: "closed", label: "Close", variant: "ghost" },
      { status: "open", label: "Reopen", variant: "secondary" },
    ];
  }

  if (status === "resolved") {
    return [
      { status: "closed", label: "Close", variant: "ghost" },
      { status: "open", label: "Reopen", variant: "secondary" },
    ];
  }

  return [{ status: "open", label: "Reopen", variant: "secondary" }];
}

function getSeverityTone(severity: AdminFeedbackSeverity): AdminBadgeTone {
  if (severity === "blocker") {
    return "red";
  }

  if (severity === "issue") {
    return "gold";
  }

  if (severity === "idea") {
    return "purple";
  }

  return "blue";
}

function getStatusTone(status: AdminFeedbackStatus): AdminBadgeTone {
  if (status === "resolved") {
    return "green";
  }

  if (status === "closed") {
    return "muted";
  }

  if (status === "reviewed") {
    return "blue";
  }

  return "gold";
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

function getSafeUrl(value: string): string | null {
  try {
    const url = new URL(value);

    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}
