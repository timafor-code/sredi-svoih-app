import { useId, useRef, useState } from "react";
import { Button } from "../ui/Button";
import { GlassCard } from "../ui/GlassCard";
import type { AdminBadgeTone } from "../../types/admin";
import type { AdminRegistrationEventSummary } from "../../types/registrations";
import type {
  RegistrationEventListEntry,
  RegistrationEventListPreferences,
  RegistrationEventListSort,
  RegistrationEventListTab,
} from "../../lib/registrationEventList";
import { formatDateTime } from "./formatters";
import { RegistrationsState } from "./RegistrationsState";

type RegistrationEventsPanelProps = {
  eventQuery: string;
  events: AdminRegistrationEventSummary[];
  eventsError: string | null;
  eventsLoading: boolean;
  eventListPreferences: RegistrationEventListPreferences;
  eventsInSelectedTab: RegistrationEventListEntry[];
  filteredEvents: RegistrationEventListEntry[];
  onEventListSortChange: (sort: RegistrationEventListSort) => void;
  onEventListTabChange: (tab: RegistrationEventListTab) => void;
  onEventQueryChange: (query: string) => void;
  onRefresh: () => void;
  onRetry: () => void;
  onSelectEvent: (eventId: string) => void;
  selectedEventId: string | null;
};

export function RegistrationEventsPanel({
  eventQuery,
  events,
  eventsError,
  eventsLoading,
  eventListPreferences,
  eventsInSelectedTab,
  filteredEvents,
  onEventListSortChange,
  onEventListTabChange,
  onEventQueryChange,
  onRefresh,
  onRetry,
  onSelectEvent,
  selectedEventId,
}: RegistrationEventsPanelProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const chooserId = useId();
  const chooserButtonRef = useRef<HTMLButtonElement>(null);
  const selectedEvent = events.find((event) => event.eventId === selectedEventId);
  const selectedEntry = eventsInSelectedTab.find((entry) => entry.event.eventId === selectedEventId);
  const hasEventQuery = eventQuery.trim().length > 0;

  return (
        <GlassCard className="registrations-events-panel" elevated>
          <button
            aria-controls={chooserId}
            aria-expanded={isExpanded}
            className="registration-event-chooser"
            onClick={() => setIsExpanded((current) => !current)}
            ref={chooserButtonRef}
            type="button"
          >
            <span>
              <small>Событие</small>
              <strong>{selectedEvent?.title ?? "Выбрать событие"}</strong>
              {eventsLoading ? <small>Загрузка событий…</small> : eventsError ? (
                <small>Список не обновлён — откройте, чтобы повторить</small>
              ) : selectedEvent ? <small>{formatDateTime(selectedEntry?.effectiveDate ?? selectedEvent.startsAt)}</small> : null}
            </span>
            <span aria-hidden="true">{isExpanded ? "▴" : "▾"}</span>
          </button>
          <div
            className={`registration-event-chooser-content${isExpanded ? " registration-event-chooser-content--expanded" : ""}`}
            id={chooserId}
          >
          <div className="registrations-panel__head">
            <div>
              <span>События</span>
              <strong>{eventsInSelectedTab.length}</strong>
            </div>
            <Button disabled={eventsLoading} onClick={onRefresh} size="sm">
              {eventsLoading ? "..." : "Обновить"}
            </Button>
          </div>

          <label className="registration-search-field">
            <span>Поиск события</span>
            <input
              onChange={(event) => onEventQueryChange(event.target.value)}
              placeholder="Название или дата"
              type="search"
              value={eventQuery}
            />
          </label>

          <div className="registration-event-list-controls">
            <div aria-label="Период событий" className="registration-event-list-tabs" role="tablist">
              <button
                aria-selected={eventListPreferences.tab === "current"}
                className={eventListPreferences.tab === "current" ? "is-active" : ""}
                onClick={() => onEventListTabChange("current")}
                role="tab"
                type="button"
              >
                Актуальные
              </button>
              <button
                aria-selected={eventListPreferences.tab === "archive"}
                className={eventListPreferences.tab === "archive" ? "is-active" : ""}
                onClick={() => onEventListTabChange("archive")}
                role="tab"
                type="button"
              >
                Архив
              </button>
            </div>
            <label className="registration-event-sort-field">
              <span>Сортировка</span>
              <select
                onChange={(event) => onEventListSortChange(event.target.value as RegistrationEventListSort)}
                value={eventListPreferences.sort}
              >
                <option value="nearest">Ближайшие по дате</option>
                <option value="latest">По дате — сначала поздние</option>
                <option value="registrations">По количеству регистраций</option>
                <option value="new">По количеству NEW</option>
                <option value="title">По названию (А–Я)</option>
              </select>
            </label>
          </div>

          <div className="registration-event-list">
            {eventsLoading ? (
              <RegistrationsState
                description="Загружаем события, где админ может смотреть заявки. После выбора события справа появится рабочий контекст."
                title="Загрузка событий"
              />
            ) : eventsError ? (
              <RegistrationsState
                description={`Не удалось получить список событий. Ошибка: ${eventsError}`}
                title="События не загрузились"
              >
                <Button onClick={onRetry} size="sm">
                  Повторить
                </Button>
              </RegistrationsState>
            ) : filteredEvents.length === 0 ? (
              <RegistrationsState
                description={
                  events.length === 0
                    ? "Для текущего admin context нет событий с доступными регистрациями. Mock-данные здесь не показываются."
                    : eventsInSelectedTab.length === 0
                      ? eventListPreferences.tab === "current"
                        ? "Нет актуальных событий. Проверьте архив событий."
                        : "В архиве пока нет событий."
                      : "Поиск не нашёл событие. Очистите запрос или попробуйте название, дату либо тип события."
                }
                title={
                  events.length === 0
                    ? "Нет событий"
                    : hasEventQuery || eventsInSelectedTab.length > 0
                      ? "Нет совпадений"
                      : eventListPreferences.tab === "current" ? "Нет актуальных событий" : "Архив пуст"
                }
              />
            ) : (
              filteredEvents.map((entry) => (
                <RegistrationEventCard
                  effectiveDate={entry.effectiveDate}
                  event={entry.event}
                  isSelected={entry.event.eventId === selectedEventId}
                  key={entry.event.eventId}
                  onSelect={(eventId) => {
                    onSelectEvent(eventId);
                    setIsExpanded(false);
                    if (window.matchMedia("(max-width: 960px)").matches) {
                      chooserButtonRef.current?.focus();
                    }
                  }}
                />
              ))
            )}
          </div>
          </div>
        </GlassCard>
  );
}

function getEventCardNewCount(event: AdminRegistrationEventSummary): number {
  return event.pendingCount + event.confirmedCount + event.waitlistedCount;
}

function RegistrationEventCard({
  effectiveDate,
  event,
  isSelected,
  onSelect,
}: {
  effectiveDate: string | null;
  event: AdminRegistrationEventSummary;
  isSelected: boolean;
  onSelect: (eventId: string) => void;
}) {
  return (
    <button
      aria-pressed={isSelected}
      className={`registration-event-card${isSelected ? " registration-event-card--active" : ""}`}
      onClick={() => onSelect(event.eventId)}
      type="button"
    >
      <div className="registration-event-card__title">
        <strong>{event.title}</strong>
        <span>{formatDateTime(effectiveDate)}</span>
      </div>
      <div className="registration-event-card__counters">
        <CounterPill label="new" tone="gold" value={getEventCardNewCount(event)} />
      </div>
    </button>
  );
}

function CounterPill({
  label,
  tone,
  value,
}: {
  label: string;
  tone: AdminBadgeTone;
  value: number;
}) {
  return (
    <span className={`registration-counter registration-counter--${tone}`}>
      <strong>{value}</strong>
      <small>{label}</small>
    </span>
  );
}
