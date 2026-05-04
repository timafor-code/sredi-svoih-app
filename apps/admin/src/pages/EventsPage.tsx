import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { GlassCard } from "../components/ui/GlassCard";
import { listAdminEvents, updateAdminEvent } from "../services/adminEventsService";
import type { AdminBadgeTone } from "../types/admin";
import type {
  AdminEvent,
  AdminEventRegistrationMode,
  AdminEventStatus,
  AdminEventVisibility,
  UpdateAdminEventInput,
} from "../types/events";

type StatusFilter = "all" | AdminEventStatus;
type VisibilityFilter = "all" | AdminEventVisibility;
type RegistrationModeFilter = "all" | AdminEventRegistrationMode;
type EventStatusActionId = "publish" | "hide" | "draft" | "cancel" | "archive";
type ActionButtonVariant = "primary" | "secondary" | "ghost" | "gold";

type EventStatusAction = {
  id: EventStatusActionId;
  label: string;
  loadingLabel: string;
  confirmLabel: string;
  variant: ActionButtonVariant;
};

type PendingEventAction = {
  action: EventStatusAction;
  event: AdminEvent;
};

type EventStatusActionPlan = PendingEventAction & {
  nextStatus: string;
  nextVisibility: string;
  payload: UpdateAdminEventInput;
  summary: string;
};

type EventsPageProps = {
  onCreateEvent: () => void;
  onEditEvent: (event: AdminEvent) => void;
  refreshSignal: number;
};

const STATUS_FILTERS: Array<{ value: StatusFilter; label: string }> = [
  { value: "all", label: "Все" },
  { value: "draft", label: "draft" },
  { value: "published", label: "published" },
  { value: "cancelled", label: "cancelled" },
  { value: "archived", label: "archived" },
];

const VISIBILITY_FILTERS: Array<{ value: VisibilityFilter; label: string }> = [
  { value: "all", label: "Все" },
  { value: "public", label: "public" },
  { value: "members_only", label: "members_only" },
  { value: "hidden", label: "hidden" },
];

const REGISTRATION_MODE_FILTERS: Array<{ value: RegistrationModeFilter; label: string }> = [
  { value: "all", label: "Все" },
  { value: "none", label: "none" },
  { value: "external_link", label: "external_link" },
  { value: "internal_free", label: "internal_free" },
  { value: "internal_paid", label: "internal_paid" },
];

const EVENT_STATUS_ACTIONS: EventStatusAction[] = [
  {
    id: "publish",
    label: "Опубликовать",
    loadingLabel: "Публикуем...",
    confirmLabel: "Опубликовать",
    variant: "gold",
  },
  {
    id: "hide",
    label: "Скрыть",
    loadingLabel: "Скрываем...",
    confirmLabel: "Скрыть",
    variant: "secondary",
  },
  {
    id: "draft",
    label: "Вернуть в черновик",
    loadingLabel: "Возвращаем...",
    confirmLabel: "Вернуть в черновик",
    variant: "secondary",
  },
  {
    id: "cancel",
    label: "Отменить",
    loadingLabel: "Отменяем...",
    confirmLabel: "Отменить событие",
    variant: "primary",
  },
  {
    id: "archive",
    label: "В архив",
    loadingLabel: "Архивируем...",
    confirmLabel: "Перенести в архив",
    variant: "primary",
  },
];

export function EventsPage({ onCreateEvent, onEditEvent, refreshSignal }: EventsPageProps) {
  const [events, setEvents] = useState<AdminEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [visibilityFilter, setVisibilityFilter] = useState<VisibilityFilter>("all");
  const [registrationModeFilter, setRegistrationModeFilter] =
    useState<RegistrationModeFilter>("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [pendingAction, setPendingAction] = useState<PendingEventAction | null>(null);
  const [actionInFlight, setActionInFlight] = useState<PendingEventAction | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  const loadEvents = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const nextEvents = await listAdminEvents();
      setEvents(nextEvents);
      return true;
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Не удалось загрузить события из Supabase.",
      );
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadEvents();
  }, [loadEvents, refreshSignal]);

  const categoryOptions = useMemo(
    () =>
      Array.from(
        new Set(
          events
            .map((event) => event.category)
            .filter((category): category is string => Boolean(category?.trim())),
        ),
      ).sort((left, right) => left.localeCompare(right, "ru")),
    [events],
  );

  const filteredEvents = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("ru");

    return events.filter((event) => {
      if (statusFilter !== "all" && event.status !== statusFilter) {
        return false;
      }

      if (visibilityFilter !== "all" && event.visibility !== visibilityFilter) {
        return false;
      }

      if (
        registrationModeFilter !== "all" &&
        event.registrationMode !== registrationModeFilter
      ) {
        return false;
      }

      if (categoryFilter !== "all" && event.category !== categoryFilter) {
        return false;
      }

      if (!normalizedQuery) {
        return true;
      }

      const searchableText = [
        event.title,
        event.subtitle,
        event.locationName,
        event.address,
        event.category,
      ]
        .filter(Boolean)
        .join(" ")
        .toLocaleLowerCase("ru");

      return searchableText.includes(normalizedQuery);
    });
  }, [
    categoryFilter,
    events,
    query,
    registrationModeFilter,
    statusFilter,
    visibilityFilter,
  ]);

  const hasActiveFilters =
    query.trim().length > 0 ||
    statusFilter !== "all" ||
    visibilityFilter !== "all" ||
    registrationModeFilter !== "all" ||
    categoryFilter !== "all";

  const requestStatusAction = useCallback((event: AdminEvent, action: EventStatusAction) => {
    setPendingAction({ action, event });
    setActionError(null);
    setActionSuccess(null);
  }, []);

  const cancelStatusAction = useCallback(() => {
    if (!actionInFlight) {
      setPendingAction(null);
      setActionError(null);
    }
  }, [actionInFlight]);

  const confirmStatusAction = useCallback(async () => {
    if (!pendingAction || actionInFlight) {
      return;
    }

    const plan = buildEventStatusActionPlan(pendingAction.event, pendingAction.action);
    setActionInFlight(pendingAction);
    setActionError(null);
    setActionSuccess(null);

    try {
      await updateAdminEvent(pendingAction.event.id, plan.payload);
      const listReloaded = await loadEvents();

      setPendingAction(null);
      setActionSuccess(
        listReloaded
          ? `Событие «${pendingAction.event.title}» обновлено через admin_update_event.`
          : `Событие «${pendingAction.event.title}» обновлено, но список не удалось перезагрузить.`,
      );
    } catch (nextError) {
      setActionError(
        nextError instanceof Error
          ? nextError.message
          : "Не удалось обновить событие через admin_update_event.",
      );
    } finally {
      setActionInFlight(null);
    }
  }, [actionInFlight, loadEvents, pendingAction]);

  const pendingActionPlan = pendingAction
    ? buildEventStatusActionPlan(pendingAction.event, pendingAction.action)
    : null;

  return (
    <div className="page-stack page-stack--events">
      <section className="page-header">
        <Badge tone="green">Supabase</Badge>
        <h1>События</h1>
        <p>
          Просмотр событий, ручное создание через admin_create_event и редактирование
          через admin_update_event.
        </p>
      </section>

      <GlassCard className="events-toolbar">
        <div className="events-toolbar__top">
          <div>
            <h2>Фильтры</h2>
            <p>Список читается из `public.events` с текущей сессией и действующими RLS.</p>
          </div>
          <div className="events-toolbar__actions">
            <Button onClick={onCreateEvent} variant="primary">
              Создать событие
            </Button>
            <Button disabled={loading} onClick={loadEvents}>
              {loading ? "Обновляем..." : "Обновить"}
            </Button>
          </div>
        </div>

        <div className="events-filters" aria-label="Фильтры событий">
          <label className="filter-field">
            <span>Поиск</span>
            <input
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Название, место, категория"
              type="search"
              value={query}
            />
          </label>

          <label className="filter-field">
            <span>Статус</span>
            <select
              onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}
              value={statusFilter}
            >
              {STATUS_FILTERS.map((filter) => (
                <option key={filter.value} value={filter.value}>
                  {filter.label}
                </option>
              ))}
            </select>
          </label>

          <label className="filter-field">
            <span>Видимость</span>
            <select
              onChange={(event) =>
                setVisibilityFilter(event.target.value as VisibilityFilter)
              }
              value={visibilityFilter}
            >
              {VISIBILITY_FILTERS.map((filter) => (
                <option key={filter.value} value={filter.value}>
                  {filter.label}
                </option>
              ))}
            </select>
          </label>

          <label className="filter-field">
            <span>Регистрация</span>
            <select
              onChange={(event) =>
                setRegistrationModeFilter(event.target.value as RegistrationModeFilter)
              }
              value={registrationModeFilter}
            >
              {REGISTRATION_MODE_FILTERS.map((filter) => (
                <option key={filter.value} value={filter.value}>
                  {filter.label}
                </option>
              ))}
            </select>
          </label>

          <label className="filter-field">
            <span>Категория</span>
            <select
              onChange={(event) => setCategoryFilter(event.target.value)}
              value={categoryFilter}
            >
              <option value="all">Все</option>
              {categoryOptions.map((category) => (
                <option key={category} value={category}>
                  {category}
                </option>
              ))}
            </select>
          </label>
        </div>
      </GlassCard>

      {actionSuccess ? (
        <div className="events-action-feedback" role="status">
          {actionSuccess}
        </div>
      ) : null}

      <GlassCard className="table-panel" elevated>
        <div className="table-panel__header">
          <h2>Список событий</h2>
          <div className="events-summary">
            <span>
              Показано {filteredEvents.length} из {events.length}
            </span>
            <Badge tone="glass">Supabase</Badge>
          </div>
        </div>

        {loading ? (
          <EventsState
            description="Читаем public.events через Supabase client. Порядок: starts_at по возрастанию, события без даты ниже."
            title="Загрузка событий"
          />
        ) : error ? (
          <EventsState description={error} title="Не удалось загрузить события">
            <Button onClick={loadEvents} variant="primary">
              Повторить
            </Button>
          </EventsState>
        ) : filteredEvents.length === 0 ? (
          <EventsState
            description={
              events.length === 0
                ? "Supabase вернул пустой список для текущей сессии. Если RLS разрешает только published/public, здесь появятся только они."
                : "Измените поисковый запрос или фильтры."
            }
            title={events.length === 0 ? "События не найдены" : "Нет совпадений"}
          >
            {hasActiveFilters ? (
              <Button
                onClick={() => {
                  setQuery("");
                  setStatusFilter("all");
                  setVisibilityFilter("all");
                  setRegistrationModeFilter("all");
                  setCategoryFilter("all");
                }}
              >
                Сбросить фильтры
              </Button>
            ) : null}
          </EventsState>
        ) : (
          <EventsTable
            actionInFlight={actionInFlight}
            events={filteredEvents}
            onEditEvent={onEditEvent}
            onRequestStatusAction={requestStatusAction}
          />
        )}
      </GlassCard>

      {pendingActionPlan ? (
        <EventStatusActionDialog
          error={actionError}
          isLoading={Boolean(actionInFlight)}
          onCancel={cancelStatusAction}
          onConfirm={confirmStatusAction}
          plan={pendingActionPlan}
        />
      ) : null}
    </div>
  );
}

function EventsTable({
  actionInFlight,
  events,
  onEditEvent,
  onRequestStatusAction,
}: {
  actionInFlight: PendingEventAction | null;
  events: AdminEvent[];
  onEditEvent: (event: AdminEvent) => void;
  onRequestStatusAction: (event: AdminEvent, action: EventStatusAction) => void;
}) {
  return (
    <div className="events-table-scroll">
      <div className="data-table data-table--events" role="table" aria-label="События">
        <div className="data-table__row data-table__row--head" role="row">
          <span role="columnheader">Афиша / Название</span>
          <span role="columnheader">Дата/время</span>
          <span role="columnheader">Место</span>
          <span role="columnheader">Статусы</span>
          <span role="columnheader">Категория</span>
          <span role="columnheader">Регистрация</span>
          <span role="columnheader">Capacity</span>
          <span role="columnheader">Source</span>
          <span role="columnheader">Updated</span>
        </div>

        {events.map((event) => {
          const activeActionId =
            actionInFlight?.event.id === event.id ? actionInFlight.action.id : null;
          const isActionDisabled = Boolean(actionInFlight);
          const secondaryText = event.subtitle ?? event.shortDescription;
          const visibleStatusActions = getVisibleEventStatusActions(event);

          return (
            <Fragment key={event.id}>
              <div className="data-table__row data-table__row--event-main" role="row">
                <div className="event-table__identity" role="cell">
                  <EventThumb event={event} />
                  <div className="event-table__identity-body">
                    <div className="event-table__cell-stack event-table__title">
                      <button
                        className="event-table__title-button"
                        onClick={() => onEditEvent(event)}
                        type="button"
                      >
                        {event.title}
                      </button>
                      {secondaryText ? <span>{secondaryText}</span> : null}
                    </div>
                  </div>
                </div>
                <span role="cell">{formatEventDateRange(event)}</span>
                <div className="event-table__cell-stack" role="cell">
                  <span>{event.locationName || event.address || "Не указано"}</span>
                  {event.locationName && event.address ? <small>{event.address}</small> : null}
                </div>
                <span className="badge-row" role="cell">
                  <Badge tone={getStatusTone(event.status)}>{event.status}</Badge>
                  <Badge tone={getVisibilityTone(event.visibility)}>{event.visibility}</Badge>
                </span>
                <span role="cell">{event.category || "Не указана"}</span>
                <span role="cell">
                  <Badge tone={getRegistrationModeTone(event.registrationMode)}>
                    {event.registrationMode}
                  </Badge>
                </span>
                <div className="event-table__cell-stack" role="cell">
                  <span>{formatCapacity(event.capacity)}</span>
                  {event.waitlistEnabled ? <small>waitlist</small> : null}
                  {event.requiresApproval ? <small>approval</small> : null}
                </div>
                <div className="event-table__cell-stack" role="cell">
                  <span>{event.sourceType}</span>
                  {event.sourceExternalId ? <small>{event.sourceExternalId}</small> : null}
                </div>
                <span role="cell">{formatDateTime(event.updatedAt, null)}</span>
              </div>
              <div className="event-actions-row" role="row">
                <div
                  className="event-actions-bar"
                  role="cell"
                  aria-label={`Быстрые действия: ${event.title}`}
                >
                  <Button onClick={() => onEditEvent(event)} size="sm" type="button">
                    Редактировать
                  </Button>
                  {visibleStatusActions.map((action) => (
                    <button
                      className={`event-status-action event-status-action--${action.id}`}
                      disabled={isActionDisabled}
                      key={action.id}
                      onClick={() => onRequestStatusAction(event, action)}
                      type="button"
                    >
                      {activeActionId === action.id ? action.loadingLabel : action.label}
                    </button>
                  ))}
                </div>
              </div>
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}

function EventStatusActionDialog({
  error,
  isLoading,
  onCancel,
  onConfirm,
  plan,
}: {
  error: string | null;
  isLoading: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  plan: EventStatusActionPlan;
}) {
  return (
    <div
      className="event-action-dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !isLoading) {
          onCancel();
        }
      }}
    >
      <section
        aria-labelledby="event-action-dialog-title"
        aria-modal="true"
        className="event-action-dialog"
        role="dialog"
      >
        <div className="event-action-dialog__head">
          <div>
            <Badge tone={getStatusTone(plan.nextStatus)}>{plan.action.label}</Badge>
            <h2 id="event-action-dialog-title">Подтвердить действие</h2>
          </div>
          <Button disabled={isLoading} onClick={onCancel} variant="ghost">
            Закрыть
          </Button>
        </div>

        <div className="event-action-dialog__event">
          <span>Событие</span>
          <strong>{plan.event.title}</strong>
        </div>

        <div className="event-action-dialog__states">
          <div className="event-action-state">
            <span>Сейчас</span>
            <div className="badge-row">
              <Badge tone={getStatusTone(plan.event.status)}>{plan.event.status}</Badge>
              <Badge tone={getVisibilityTone(plan.event.visibility)}>
                {plan.event.visibility}
              </Badge>
            </div>
            <p>{getMobileVisibilityNotice(plan.event.status, plan.event.visibility)}</p>
          </div>

          <div className="event-action-state event-action-state--next">
            <span>Будет</span>
            <div className="badge-row">
              <Badge tone={getStatusTone(plan.nextStatus)}>{plan.nextStatus}</Badge>
              <Badge tone={getVisibilityTone(plan.nextVisibility)}>
                {plan.nextVisibility}
              </Badge>
            </div>
            <p>{getMobileVisibilityNotice(plan.nextStatus, plan.nextVisibility)}</p>
          </div>
        </div>

        <div className="event-action-dialog__notice">
          <p>{plan.summary}</p>
        </div>

        {error ? (
          <div className="form-error" role="alert">
            {error}
          </div>
        ) : null}

        <div className="event-action-dialog__actions">
          <Button disabled={isLoading} onClick={onCancel} variant="secondary">
            Отмена
          </Button>
          <Button disabled={isLoading} onClick={onConfirm} variant={plan.action.variant}>
            {isLoading ? plan.action.loadingLabel : plan.action.confirmLabel}
          </Button>
        </div>
      </section>
    </div>
  );
}

function buildEventStatusActionPlan(
  event: AdminEvent,
  action: EventStatusAction,
): EventStatusActionPlan {
  if (action.id === "publish") {
    const nextVisibility = getPublishedVisibility(event.visibility);

    return {
      action,
      event,
      nextStatus: "published",
      nextVisibility,
      payload: {
        status: "published",
        visibility: nextVisibility,
      },
      summary:
        event.visibility === "hidden"
          ? "Сейчас событие hidden, поэтому публикация поставит visibility=public. Если нужно members_only, сначала измените visibility в edit flow."
          : "Публикация сохранит текущую visibility, потому что она уже не hidden.",
    };
  }

  if (action.id === "hide") {
    return {
      action,
      event,
      nextStatus: event.status,
      nextVisibility: "hidden",
      payload: {
        visibility: "hidden",
      },
      summary: "Меняется только visibility. Status останется без изменений.",
    };
  }

  if (action.id === "draft") {
    return {
      action,
      event,
      nextStatus: "draft",
      nextVisibility: "hidden",
      payload: {
        status: "draft",
        visibility: "hidden",
      },
      summary:
        event.status === "published"
          ? "Опубликованное событие вернётся в черновик и станет hidden."
          : "Событие станет черновиком и будет скрыто из мобильного приложения.",
    };
  }

  if (action.id === "cancel") {
    return {
      action,
      event,
      nextStatus: "cancelled",
      nextVisibility: event.visibility,
      payload: {
        status: "cancelled",
      },
      summary:
        "Регистрации не отменяются автоматически. Уведомления и обработка регистраций будут добавлены отдельным PR.",
    };
  }

  return {
    action,
    event,
    nextStatus: "archived",
    nextVisibility: "hidden",
    payload: {
      status: "archived",
      visibility: "hidden",
    },
    summary:
      "Событие будет отправлено в архив и скрыто. Регистрации, уведомления и payment changes здесь не меняются.",
  };
}

function getPublishedVisibility(currentVisibility: string): AdminEventVisibility {
  return currentVisibility === "public" || currentVisibility === "members_only"
    ? currentVisibility
    : "public";
}

function getVisibleEventStatusActions(event: AdminEvent): EventStatusAction[] {
  return EVENT_STATUS_ACTIONS.filter((action) => {
    if (action.id === "publish") {
      return event.status === "draft";
    }

    if (action.id === "hide") {
      return event.visibility !== "hidden";
    }

    if (action.id === "draft") {
      return event.status !== "draft";
    }

    if (action.id === "cancel") {
      return event.status === "draft" || event.status === "published";
    }

    return event.status !== "archived";
  });
}

function getMobileVisibilityNotice(status: string, visibility: string): string {
  if (status === "draft") {
    return "Черновик не отображается в мобильном приложении.";
  }

  if (status === "cancelled") {
    return "Отменённое событие не должно быть доступно для новых регистраций и не должно показываться как активное.";
  }

  if (visibility === "hidden") {
    return "Hidden не отображается в мобильном приложении.";
  }

  if (status === "archived") {
    return "Архивное событие не отображается как активное в мобильном приложении.";
  }

  if (status === "published" && visibility === "public") {
    return "Опубликованное public-событие будет видно всем пользователям.";
  }

  if (status === "published" && visibility === "members_only") {
    return "Members only будет видно только участникам общины.";
  }

  return "Событие не станет published/public, поэтому не должно отображаться как публичное активное событие.";
}

function EventThumb({ event }: { event: AdminEvent }) {
  return (
    <div className="event-thumb" aria-hidden="true">
      <span>{event.title.trim().slice(0, 1).toLocaleUpperCase("ru") || "С"}</span>
      {event.imageUrl ? (
        <img
          alt=""
          className="event-thumb__image"
          loading="lazy"
          onError={(imageEvent) => {
            imageEvent.currentTarget.style.display = "none";
          }}
          src={event.imageUrl}
        />
      ) : null}
    </div>
  );
}

function EventsState({
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

function formatEventDateRange(event: AdminEvent): string {
  if (!event.startsAt) {
    return "Дата не указана";
  }

  const startsAt = formatDateTime(event.startsAt, event.timezone);

  if (!event.endsAt) {
    return startsAt;
  }

  return `${startsAt} - ${formatDateTime(event.endsAt, event.timezone)}`;
}

function formatDateTime(value: string | null, timezone: string | null): string {
  if (!value) {
    return "Не указано";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  try {
    return new Intl.DateTimeFormat("ru-RU", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: timezone ?? undefined,
    }).format(date);
  } catch {
    return new Intl.DateTimeFormat("ru-RU", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(date);
  }
}

function formatCapacity(capacity: number | null): string {
  return capacity === null ? "Без лимита" : String(capacity);
}

function getStatusTone(status: string): AdminBadgeTone {
  if (status === "published") {
    return "green";
  }

  if (status === "draft") {
    return "gold";
  }

  if (status === "cancelled") {
    return "red";
  }

  return "muted";
}

function getVisibilityTone(visibility: string): AdminBadgeTone {
  if (visibility === "public") {
    return "blue";
  }

  if (visibility === "members_only") {
    return "purple";
  }

  return "muted";
}

function getRegistrationModeTone(registrationMode: string): AdminBadgeTone {
  if (registrationMode === "internal_free") {
    return "green";
  }

  if (registrationMode === "internal_paid") {
    return "gold";
  }

  if (registrationMode === "external_link") {
    return "blue";
  }

  return "muted";
}
