import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";

import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { GlassCard } from "../components/ui/GlassCard";
import { listAdminEvents } from "../services/adminEventsService";
import type { AdminBadgeTone } from "../types/admin";
import type {
  AdminEvent,
  AdminEventRegistrationMode,
  AdminEventStatus,
  AdminEventVisibility,
} from "../types/events";

type StatusFilter = "all" | AdminEventStatus;
type VisibilityFilter = "all" | AdminEventVisibility;
type RegistrationModeFilter = "all" | AdminEventRegistrationMode;

type EventsPageProps = {
  onCreateEvent: () => void;
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

export function EventsPage({ onCreateEvent, refreshSignal }: EventsPageProps) {
  const [events, setEvents] = useState<AdminEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [visibilityFilter, setVisibilityFilter] = useState<VisibilityFilter>("all");
  const [registrationModeFilter, setRegistrationModeFilter] =
    useState<RegistrationModeFilter>("all");
  const [categoryFilter, setCategoryFilter] = useState("all");

  const loadEvents = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const nextEvents = await listAdminEvents();
      setEvents(nextEvents);
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Не удалось загрузить события из Supabase.",
      );
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

  return (
    <div className="page-stack page-stack--events">
      <section className="page-header">
        <Badge tone="green">Supabase</Badge>
        <h1>События</h1>
        <p>Просмотр событий и ручное создание через RPC admin_create_event.</p>
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
          <EventsTable events={filteredEvents} />
        )}
      </GlassCard>
    </div>
  );
}

function EventsTable({ events }: { events: AdminEvent[] }) {
  return (
    <div className="events-table-scroll">
      <div className="data-table data-table--events" role="table" aria-label="События">
        <div className="data-table__row data-table__row--head" role="row">
          <span role="columnheader">Афиша</span>
          <span role="columnheader">Название</span>
          <span role="columnheader">Дата/время</span>
          <span role="columnheader">Место</span>
          <span role="columnheader">Статусы</span>
          <span role="columnheader">Категория</span>
          <span role="columnheader">Регистрация</span>
          <span role="columnheader">Capacity</span>
          <span role="columnheader">Source</span>
          <span role="columnheader">Updated</span>
        </div>

        {events.map((event) => (
          <div className="data-table__row" key={event.id} role="row">
            <EventThumb event={event} />
            <div className="event-table__cell-stack event-table__title" role="cell">
              <strong>{event.title}</strong>
              {event.subtitle ? <span>{event.subtitle}</span> : null}
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
        ))}
      </div>
    </div>
  );
}

function EventThumb({ event }: { event: AdminEvent }) {
  return (
    <div className="event-thumb" role="cell">
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
