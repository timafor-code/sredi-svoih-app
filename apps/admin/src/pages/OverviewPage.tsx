import { useEffect, useMemo, useState, type KeyboardEvent } from "react";

import { formatDateTime } from "../components/registrations/formatters";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { EmptyState } from "../components/ui/EmptyState";
import { GlassCard } from "../components/ui/GlassCard";
import { canRoleOpenSection, getNavigationItem } from "../data/navigation";
import { listAdminEvents, listRegistrationEvents } from "../services/adminEventsService";
import { listAdminFeedback } from "../services/adminFeedbackService";
import { listImportItemsNeedingReview } from "../services/adminImportReviewService";
import { useAdminAuth } from "../store/useAdminAuth";
import type { AdminSection } from "../types/admin";
import type { AdminProfile, AdminRole } from "../types/auth";
import type { AdminEvent } from "../types/events";
import type { AdminRegistrationEventSummary } from "../types/registrations";

type OverviewPageProps = {
  onSectionChange: (section: AdminSection) => void;
};

type KpiTone = "blue" | "green" | "gold" | "muted";

type InboxRow = {
  key: string;
  label: string;
  display: string;
  section: AdminSection;
};

const IMPORT_REVIEW_LIMIT = 20;

const quickLinkSections: Array<{ section: AdminSection; note: string }> = [
  {
    section: "events",
    note: "Список событий и базовое редактирование через текущий beta flow.",
  },
  {
    section: "categories",
    note: "Категории событий в рамках текущей community.",
  },
  {
    section: "import",
    note: "Review очереди импорта; сам импорт пока запускается вне browser-admin.",
  },
  {
    section: "registrations",
    note: "Заявки, листы ожидания и занятость мест по событиям.",
  },
];

const testingItems = [
  "Вход и выход для active admin и active event_manager.",
  "Роль, community и membership текущей сессии отображаются без подмены моками.",
  "event_manager видит только разрешённые разделы и не видит admin-only shortcuts.",
  "Очередь import review доступна для проверки результатов CLI/dev импорта.",
];

const notProductionItems = [
  "Overview не является analytics dashboard: все числа — это реальные значения существующих RPC, без прогнозов и графиков.",
  "Импорт с сайта в Phase 1 выполняется владельцем проекта через CLI/dev flow.",
  "Beta staging предназначен для закрытой проверки доступа и основных admin flows.",
];

const roleNotes: Record<AdminRole, string> = {
  admin: "Полный beta-доступ к admin разделам.",
  event_manager: "Доступ к событиям, категориям, import review и регистрациям без admin-only разделов.",
  member: "Нет доступа к web-admin beta.",
};

export function OverviewPage({ onSectionChange }: OverviewPageProps) {
  const auth = useAdminAuth();
  const role = auth.role ?? auth.membership?.role ?? "member";
  const isAdmin = role === "admin";
  const userLabel = getUserLabel(auth.profile, auth.session?.user.email ?? null);
  const userEmail = auth.profile?.email ?? auth.session?.user.email ?? "email не найден";
  const communityId = auth.membership?.community_id ?? "community не выбрана";
  const membershipStatus = auth.membership?.status ?? "membership не найдена";

  const [registrationEvents, setRegistrationEvents] = useState<
    AdminRegistrationEventSummary[] | null
  >(null);
  const [registrationEventsError, setRegistrationEventsError] = useState<string | null>(null);
  const [adminEvents, setAdminEvents] = useState<AdminEvent[] | null>(null);
  const [adminEventsError, setAdminEventsError] = useState<string | null>(null);
  const [importReviewCount, setImportReviewCount] = useState<number | null>(null);
  const [importReviewError, setImportReviewError] = useState<string | null>(null);
  const [openFeedbackCount, setOpenFeedbackCount] = useState<number | null>(null);
  const [feedbackError, setFeedbackError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const now = useMemo(() => Date.now(), []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    const tasks: Array<Promise<unknown>> = [
      listRegistrationEvents().then(
        (data) => {
          if (!cancelled) {
            setRegistrationEvents(data);
            setRegistrationEventsError(null);
          }
        },
        (error) => {
          if (!cancelled) {
            setRegistrationEvents(null);
            setRegistrationEventsError(toErrorMessage(error, "Не удалось загрузить регистрации."));
          }
        },
      ),
      listAdminEvents().then(
        (data) => {
          if (!cancelled) {
            setAdminEvents(data);
            setAdminEventsError(null);
          }
        },
        (error) => {
          if (!cancelled) {
            setAdminEvents(null);
            setAdminEventsError(toErrorMessage(error, "Не удалось загрузить события."));
          }
        },
      ),
      listImportItemsNeedingReview(IMPORT_REVIEW_LIMIT).then(
        (items) => {
          if (!cancelled) {
            setImportReviewCount(items.length);
            setImportReviewError(null);
          }
        },
        (error) => {
          if (!cancelled) {
            setImportReviewCount(null);
            setImportReviewError(toErrorMessage(error, "Не удалось загрузить очередь импорта."));
          }
        },
      ),
    ];

    if (isAdmin) {
      tasks.push(
        listAdminFeedback({ status: "open" }).then(
          (response) => {
            if (!cancelled) {
              setOpenFeedbackCount(response.totalCount);
              setFeedbackError(null);
            }
          },
          (error) => {
            if (!cancelled) {
              setOpenFeedbackCount(null);
              setFeedbackError(toErrorMessage(error, "Не удалось загрузить отзывы."));
            }
          },
        ),
      );
    } else {
      setOpenFeedbackCount(null);
      setFeedbackError(null);
    }

    void Promise.allSettled(tasks).then(() => {
      if (!cancelled) {
        setLoading(false);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [isAdmin]);

  const publishedFutureEventIds = useMemo(() => {
    const ids = new Set<string>();

    for (const event of adminEvents ?? []) {
      if (event.status !== "published") {
        continue;
      }

      const startsAt = toTimestamp(event.startsAt);

      if (startsAt !== null && startsAt >= now) {
        ids.add(event.id);
      }
    }

    return ids;
  }, [adminEvents, now]);

  const registrationTotals = useMemo(() => {
    let confirmed = 0;
    let pending = 0;
    let waitlisted = 0;

    for (const summary of registrationEvents ?? []) {
      confirmed += summary.confirmedCount;
      pending += summary.pendingCount;
      waitlisted += summary.waitlistedCount;
    }

    return { confirmed, pending, waitlisted };
  }, [registrationEvents]);

  const draftCount = useMemo(
    () => (adminEvents ?? []).filter((event) => event.status === "draft").length,
    [adminEvents],
  );

  const upcomingEvents = useMemo(() => {
    return (registrationEvents ?? [])
      .filter((summary) => publishedFutureEventIds.has(summary.eventId))
      .slice()
      .sort((left, right) => {
        const leftTime = toTimestamp(left.startsAt);
        const rightTime = toTimestamp(right.startsAt);

        if (leftTime === null && rightTime === null) {
          return 0;
        }

        if (leftTime === null) {
          return 1;
        }

        if (rightTime === null) {
          return -1;
        }

        return leftTime - rightTime;
      })
      .slice(0, 5);
  }, [registrationEvents, publishedFutureEventIds]);

  const quickLinks = quickLinkSections
    .filter((link) => canRoleOpenSection(role, link.section))
    .map((link) => ({
      ...link,
      label: getNavigationItem(link.section)?.label ?? link.section,
    }));

  const activePublishedCount = publishedFutureEventIds.size;
  const upcomingError = registrationEventsError ?? adminEventsError;

  const inboxRows: InboxRow[] = [];

  if (!registrationEventsError && registrationEvents) {
    if (registrationTotals.pending > 0) {
      inboxRows.push({
        key: "pending",
        label: "Ожидают решения",
        display: String(registrationTotals.pending),
        section: "registrations",
      });
    }

    if (registrationTotals.waitlisted > 0) {
      inboxRows.push({
        key: "waitlist",
        label: "Лист ожидания",
        display: String(registrationTotals.waitlisted),
        section: "registrations",
      });
    }
  }

  if (!importReviewError && importReviewCount !== null && importReviewCount > 0) {
    inboxRows.push({
      key: "import",
      label: "Импорт на проверку",
      display: importReviewCount >= IMPORT_REVIEW_LIMIT ? `${IMPORT_REVIEW_LIMIT}+` : String(importReviewCount),
      section: "import",
    });
  }

  if (!adminEventsError && adminEvents && draftCount > 0) {
    inboxRows.push({
      key: "drafts",
      label: "Черновики событий",
      display: String(draftCount),
      section: "events",
    });
  }

  if (isAdmin && !feedbackError && openFeedbackCount !== null && openFeedbackCount > 0) {
    inboxRows.push({
      key: "feedback",
      label: "Открытые отзывы",
      display: String(openFeedbackCount),
      section: "feedback",
    });
  }

  const visibleInboxRows = inboxRows.filter((row) => canRoleOpenSection(role, row.section));

  const inboxErrorNotes: Array<{ key: string; message: string }> = [];

  if (registrationEventsError) {
    inboxErrorNotes.push({ key: "registrations", message: `Регистрации: ${registrationEventsError}` });
  }

  if (importReviewError) {
    inboxErrorNotes.push({ key: "import", message: `Импорт: ${importReviewError}` });
  }

  if (adminEventsError) {
    inboxErrorNotes.push({ key: "events", message: `События: ${adminEventsError}` });
  }

  if (isAdmin && feedbackError) {
    inboxErrorNotes.push({ key: "feedback", message: `Отзывы: ${feedbackError}` });
  }

  const inboxAllClear = visibleInboxRows.length === 0 && inboxErrorNotes.length === 0;

  if (loading) {
    return (
      <div className="page-stack">
        <section className="page-header">
          <Badge tone="blue">live overview</Badge>
          <h1>Обзор</h1>
          <p>Загружаем данные обзора...</p>
        </section>
        <GlassCard className="overview-panel">
          <p className="overview-helper" role="status">
            Загружаем сигналы из admin-сервисов...
          </p>
        </GlassCard>
      </div>
    );
  }

  return (
    <div className="page-stack">
      <section className="page-header">
        <Badge tone="blue">live overview</Badge>
        <h1>Обзор</h1>
        <p>
          Живая стартовая страница: задачи, требующие внимания, ключевые показатели и
          ближайшие события из текущей Supabase session.
        </p>
      </section>

      {inboxAllClear ? (
        <EmptyState
          title="Всё разобрано"
          description="Нет ожидающих решения заявок, листа ожидания, импорта на проверку или черновиков, требующих внимания."
        />
      ) : (
        <GlassCard className="overview-panel">
          <div className="section-title">
            <h2>Требует внимания</h2>
            <Badge tone="gold">action inbox</Badge>
          </div>

          {visibleInboxRows.length > 0 ? (
            <div className="overview-inbox-list">
              {visibleInboxRows.map((row) => (
                <div className="overview-inbox-row" key={row.key}>
                  <div className="overview-inbox-row__label">
                    <strong>{row.display}</strong>
                    <span>{row.label}</span>
                  </div>
                  <Button onClick={() => onSectionChange(row.section)} size="sm" variant="primary">
                    Открыть
                  </Button>
                </div>
              ))}
            </div>
          ) : null}

          {inboxErrorNotes.map((note) => (
            <p className="overview-helper" key={note.key} role="alert">
              {note.message}
            </p>
          ))}
        </GlassCard>
      )}

      <section className="members-summary-grid" aria-label="Ключевые показатели">
        <KpiTile
          label="Активные события"
          tone="blue"
          value={adminEventsError ? "—" : String(activePublishedCount)}
        />
        <KpiTile
          label="Подтверждено"
          tone="green"
          value={registrationEventsError ? "—" : String(registrationTotals.confirmed)}
        />
        <KpiTile
          label="Ожидают решения"
          tone="gold"
          value={registrationEventsError ? "—" : String(registrationTotals.pending)}
        />
        <KpiTile
          label="Лист ожидания"
          tone="muted"
          value={registrationEventsError ? "—" : String(registrationTotals.waitlisted)}
        />
      </section>

      <GlassCard className="overview-identity-row" aria-label="Текущий доступ">
        <div className="overview-identity-row__item">
          <span>Текущий user</span>
          <strong>{userLabel}</strong>
          <small>{userEmail}</small>
        </div>
        <div className="overview-identity-row__item">
          <span>Role</span>
          <strong>{role}</strong>
          <small>{roleNotes[role]}</small>
        </div>
        <div className="overview-identity-row__item">
          <span>Community</span>
          <strong title={communityId}>{communityId}</strong>
          <small>{membershipStatus}</small>
        </div>
      </GlassCard>

      <GlassCard className="overview-panel">
        <div className="section-title">
          <h2>Ближайшие события</h2>
          <Badge tone="blue">published</Badge>
        </div>

        {upcomingError ? (
          <p className="overview-helper" role="alert">
            {upcomingError}
          </p>
        ) : upcomingEvents.length === 0 ? (
          <p className="overview-helper">Опубликованных будущих событий пока нет.</p>
        ) : (
          <div className="overview-upcoming-list">
            {upcomingEvents.map((event) => {
              const fillPercent = computeFillPercent(event.confirmedCount, event.capacity);
              const occurrenceSuffix =
                event.occurrenceCount > 0 ? ` · сеансов: ${event.occurrenceCount}` : "";

              return (
                <div
                  className="overview-upcoming-row"
                  key={event.eventId}
                  onClick={() => onSectionChange("registrations")}
                  onKeyDown={(keyboardEvent) =>
                    handleRowActivateKeyDown(keyboardEvent, () => onSectionChange("registrations"))
                  }
                  role="button"
                  tabIndex={0}
                >
                  <span className="overview-upcoming-row__head">
                    <strong>{event.title}</strong>
                    <span>
                      {formatDateTime(event.startsAt)}
                      {occurrenceSuffix}
                    </span>
                  </span>

                  {event.capacity !== null ? (
                    <OverviewMeter
                      fillPercent={fillPercent}
                      label={`${event.confirmedCount} из ${event.capacity}`}
                      secondaryLabel={fillPercent !== null ? `${fillPercent}% заполнено` : null}
                    />
                  ) : (
                    <span className="overview-upcoming-row__count">
                      {event.confirmedCount} подтверждено · без лимита
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </GlassCard>

      {quickLinks.length > 0 ? (
        <GlassCard className="overview-panel">
          <div className="section-title">
            <h2>Быстрые ссылки</h2>
            <Badge tone="gold">role-based</Badge>
          </div>
          <p className="overview-helper">
            Откройте раздел напрямую. Список фильтруется по текущей роли.
          </p>
          <div className="overview-quick-links">
            {quickLinks.map((link) => (
              <button
                className="overview-quick-link"
                key={link.section}
                onClick={() => onSectionChange(link.section)}
                type="button"
              >
                <span className="overview-quick-link__label">
                  <strong>{link.label}</strong>
                  <span>{link.note}</span>
                </span>
                <span aria-hidden="true" className="overview-quick-link__chevron">
                  ›
                </span>
              </button>
            ))}
          </div>
        </GlassCard>
      ) : null}

      <GlassCard className="overview-panel">
        <details className="overview-beta-details">
          <summary>Бета-заметки: что пока не production и что тестировать</summary>
          <div className="overview-beta-details__body">
            <div>
              <h3>Что пока не production</h3>
              <ul className="soft-list">
                {notProductionItems.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
            <div>
              <h3>Что тестировать</h3>
              <ul className="soft-list">
                {testingItems.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          </div>
        </details>
      </GlassCard>
    </div>
  );
}

function KpiTile({ label, tone, value }: { label: string; tone: KpiTone; value: string }) {
  return (
    <div className={`members-summary-card members-summary-card--${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function OverviewMeter({
  fillPercent,
  label,
  secondaryLabel,
}: {
  fillPercent: number | null;
  label: string;
  secondaryLabel: string | null;
}) {
  return (
    <div className="registration-capacity-meter">
      <div
        aria-valuemax={fillPercent !== null ? 100 : undefined}
        aria-valuemin={fillPercent !== null ? 0 : undefined}
        aria-valuenow={fillPercent ?? undefined}
        className="registration-capacity-meter__track"
        role={fillPercent !== null ? "progressbar" : undefined}
      >
        <span style={{ width: `${fillPercent ?? 0}%` }} />
      </div>
      <div className="registration-capacity-meter__labels">
        <span>{label}</span>
        {secondaryLabel ? <span>{secondaryLabel}</span> : null}
      </div>
    </div>
  );
}

function handleRowActivateKeyDown(event: KeyboardEvent<HTMLDivElement>, activate: () => void) {
  if (event.key !== "Enter" && event.key !== " ") {
    return;
  }

  event.preventDefault();
  activate();
}

function computeFillPercent(confirmed: number, capacity: number | null): number | null {
  if (capacity === null || capacity <= 0) {
    return null;
  }

  return Math.max(0, Math.min(100, Math.round((confirmed / capacity) * 100)));
}

function toTimestamp(value: string | null): number | null {
  if (!value) {
    return null;
  }

  const time = Date.parse(value);
  return Number.isNaN(time) ? null : time;
}

function toErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function getUserLabel(profile: AdminProfile | null, email: string | null): string {
  const fullName = [profile?.first_name, profile?.last_name].filter(Boolean).join(" ").trim();

  return (
    profile?.display_name ??
    profile?.full_name ??
    (fullName || null) ??
    profile?.email ??
    email ??
    "Пользователь"
  );
}
