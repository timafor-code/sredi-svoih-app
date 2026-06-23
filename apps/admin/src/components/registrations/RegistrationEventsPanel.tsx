import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { GlassCard } from "../ui/GlassCard";
import type { AdminBadgeTone } from "../../types/admin";
import type { AdminRegistrationEventSummary } from "../../types/registrations";
import { formatDateTime } from "./formatters";
import { RegistrationsState } from "./RegistrationsState";

type RegistrationEventsPanelProps = {
  eventQuery: string;
  events: AdminRegistrationEventSummary[];
  eventsError: string | null;
  eventsLoading: boolean;
  filteredEvents: AdminRegistrationEventSummary[];
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
  filteredEvents,
  onEventQueryChange,
  onRefresh,
  onRetry,
  onSelectEvent,
  selectedEventId,
}: RegistrationEventsPanelProps) {
  return (
        <GlassCard className="registrations-events-panel" elevated>
          <div className="registrations-panel__head">
            <div>
              <span>События</span>
              <strong>{events.length}</strong>
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
                    : "Поиск не нашёл событие. Очистите запрос или попробуйте название, дату либо тип события."
                }
                title={events.length === 0 ? "Нет событий" : "Нет совпадений"}
              />
            ) : (
              filteredEvents.map((event) => (
                <RegistrationEventCard
                  event={event}
                  isSelected={event.eventId === selectedEventId}
                  key={event.eventId}
                  onSelect={onSelectEvent}
                />
              ))
            )}
          </div>
        </GlassCard>
  );
}

function RegistrationEventCard({
  event,
  isSelected,
  onSelect,
}: {
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
        <span>{formatDateTime(event.startsAt)}</span>
      </div>
      <div className="registration-event-card__counters">
        <CounterPill label="ok" tone="green" value={event.confirmedCount} />
        <CounterPill label="new" tone="gold" value={event.pendingCount} />
        <CounterPill label="wait" tone="purple" value={event.waitlistedCount} />
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
