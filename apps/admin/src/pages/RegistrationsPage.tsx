import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { createPortal } from "react-dom";

import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { GlassCard } from "../components/ui/GlassCard";
import { RegistrationCapacityBucketsOverview } from "../components/registrations/RegistrationCapacityBucketsOverview";
import { RegistrationDetailPanel } from "../components/registrations/RegistrationDetailPanel";
import { RegistrationEventsPanel } from "../components/registrations/RegistrationEventsPanel";
import { RegistrationMainActions } from "../components/registrations/RegistrationMainActions";
import { RegistrationsState } from "../components/registrations/RegistrationsState";
import { RegistrationsTable } from "../components/registrations/RegistrationsTable";
import { listAdminEventOccurrences } from "../services/adminEventOccurrencesService";
import { listAdminRegistrationCapacityBuckets } from "../services/adminRegistrationCapacityService";
import {
  listAdminEventCapacities,
  listEventRegistrations,
  listRegistrationEvents,
  markRegistrationAttendance,
  updateRegistrationStatus,
} from "../services/adminEventsService";
import { exportEventRegistrationsToExcel } from "../services/registrationExcelExport";
import type { AdminEventOccurrence } from "../types/eventOccurrences";
import type {
  AdminEventRegistrationRow,
  AdminRegistrationEventSummary,
  AdminRegistrationStatus,
} from "../types/registrations";
import type { AdminRegistrationCapacityBucket } from "../types/registrationCapacity";
import {
  formatDateTime,
  formatEventKind,
  formatRegistrationCount,
  getDestructiveActionDescription,
  getRegistrationStatusLabel,
  getRegistrationStatusTone,
} from "../components/registrations/formatters";
import type {
  ActionInFlight,
  PendingRegistrationAction,
  RegistrationAction,
} from "../components/registrations/types";

type RegistrationStatusFilter = AdminRegistrationStatus | "all";
type ToastKind = "success" | "error";

type ToastMessage = {
  id: number;
  kind: ToastKind;
  message: string;
};

const CAPACITY_REGISTRATION_LIMIT = 1000;
const REGISTRATION_PAGE_SIZE = 50;
const STATUS_FILTERS: Array<{ value: RegistrationStatusFilter; label: string }> = [
  { value: "all", label: "Все" },
  { value: "pending", label: "Pending" },
  { value: "confirmed", label: "Confirmed" },
  { value: "waitlisted", label: "Waitlist" },
  { value: "cancelled", label: "Cancelled" },
  { value: "rejected", label: "Rejected" },
  { value: "attended", label: "Attended" },
  { value: "no_show", label: "No-show" },
];

const REGISTRATION_ACTIONS: RegistrationAction[] = [
  {
    kind: "status",
    status: "confirmed",
    label: "Подтвердить",
    loadingLabel: "Подтверждаем...",
    variant: "gold",
  },
  {
    kind: "status",
    status: "pending",
    label: "Вернуть в заявку",
    loadingLabel: "Возвращаем...",
    variant: "secondary",
  },
  {
    kind: "status",
    status: "waitlisted",
    label: "В лист ожидания",
    loadingLabel: "Переносим...",
    variant: "secondary",
  },
  {
    kind: "status",
    status: "cancelled",
    label: "Отменить",
    loadingLabel: "Отменяем...",
    destructive: true,
    variant: "primary",
  },
  {
    kind: "status",
    status: "rejected",
    label: "Отклонить",
    loadingLabel: "Отклоняем...",
    destructive: true,
    variant: "primary",
  },
  {
    kind: "attendance",
    status: "attended",
    label: "Пришёл",
    loadingLabel: "Отмечаем...",
    variant: "secondary",
  },
  {
    kind: "attendance",
    status: "no_show",
    label: "No-show",
    loadingLabel: "Отмечаем...",
    destructive: true,
    variant: "primary",
  },
];

export function RegistrationsPage() {
  const [events, setEvents] = useState<AdminRegistrationEventSummary[]>([]);
  const [eventsLoading, setEventsLoading] = useState(true);
  const [eventsError, setEventsError] = useState<string | null>(null);
  const [eventQuery, setEventQuery] = useState("");
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);

  const [registrations, setRegistrations] = useState<AdminEventRegistrationRow[]>([]);
  const [registrationsLoading, setRegistrationsLoading] = useState(false);
  const [registrationsError, setRegistrationsError] = useState<string | null>(null);
  const [capacityRegistrations, setCapacityRegistrations] = useState<
    AdminEventRegistrationRow[]
  >([]);
  const [capacityRegistrationsLoading, setCapacityRegistrationsLoading] = useState(false);
  const [capacityRegistrationsError, setCapacityRegistrationsError] = useState<string | null>(
    null,
  );
  const [capacityBuckets, setCapacityBuckets] = useState<AdminRegistrationCapacityBucket[]>([]);
  const [capacityBucketsLoading, setCapacityBucketsLoading] = useState(false);
  const [capacityBucketsError, setCapacityBucketsError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<RegistrationStatusFilter>("all");
  const [registrationSearch, setRegistrationSearch] = useState("");
  const [offset, setOffset] = useState(0);
  const [selectedRegistrationId, setSelectedRegistrationId] = useState<string | null>(null);

  const [occurrences, setOccurrences] = useState<AdminEventOccurrence[]>([]);
  const [occurrencesLoading, setOccurrencesLoading] = useState(false);
  const [occurrencesError, setOccurrencesError] = useState<string | null>(null);
  const [selectedOccurrenceId, setSelectedOccurrenceId] = useState<string | null>(null);
  const [showPastOccurrences, setShowPastOccurrences] = useState(false);

  const [pendingAction, setPendingAction] = useState<PendingRegistrationAction | null>(null);
  const [actionInFlight, setActionInFlight] = useState<ActionInFlight | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [excelExportLoading, setExcelExportLoading] = useState(false);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const pushToast = useCallback((kind: ToastKind, message: string) => {
    const id = Date.now() + Math.random();
    setToasts((current) => [...current, { id, kind, message }]);
  }, []);

  const removeToast = useCallback((toastId: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== toastId));
  }, []);

  useEffect(() => {
    if (toasts.length === 0) {
      return undefined;
    }

    const timers = toasts.map((toast) =>
      window.setTimeout(() => removeToast(toast.id), 5200),
    );

    return () => {
      timers.forEach((timer) => window.clearTimeout(timer));
    };
  }, [removeToast, toasts]);

  const loadRegistrationEventSummaries = useCallback(
    async ({ silent = false }: { silent?: boolean } = {}) => {
      if (!silent) {
        setEventsLoading(true);
      }

      setEventsError(null);

      try {
        const nextEvents = await listRegistrationEvents();
        const eventCapacityById = await listAdminEventCapacities(
          nextEvents.map((event) => event.eventId),
        );
        const nextEventsWithCapacity = nextEvents.map((event) => ({
          ...event,
          capacity: eventCapacityById.get(event.eventId) ?? event.capacity ?? null,
        }));

        setEvents(nextEventsWithCapacity);
        setSelectedEventId((currentEventId) => {
          if (
            currentEventId &&
            nextEventsWithCapacity.some((event) => event.eventId === currentEventId)
          ) {
            return currentEventId;
          }

          return nextEventsWithCapacity[0]?.eventId ?? null;
        });

        return nextEventsWithCapacity;
      } catch (nextError) {
        const message =
          nextError instanceof Error
            ? nextError.message
            : "Не удалось загрузить события с регистрациями.";
        setEventsError(message);
        throw nextError;
      } finally {
        if (!silent) {
          setEventsLoading(false);
        }
      }
    },
    [],
  );

  const selectedEvent = useMemo(
    () => events.find((event) => event.eventId === selectedEventId) ?? null,
    [events, selectedEventId],
  );

  const eventHasOccurrences = (selectedEvent?.occurrenceCount ?? 0) > 0;

  const loadRegistrations = useCallback(
    async ({ silent = false }: { silent?: boolean } = {}) => {
      if (!selectedEventId) {
        setRegistrations([]);
        setSelectedRegistrationId(null);
        setRegistrationsLoading(false);
        setRegistrationsError(null);
        return [];
      }

      if (eventHasOccurrences && !selectedOccurrenceId) {
        setRegistrations([]);
        setSelectedRegistrationId(null);
        setRegistrationsLoading(false);
        setRegistrationsError(null);
        return [];
      }

      if (!silent) {
        setRegistrationsLoading(true);
        setRegistrations([]);
        setSelectedRegistrationId(null);
      }

      setRegistrationsError(null);

      try {
        const nextRegistrations = await listEventRegistrations({
          eventId: selectedEventId,
          occurrenceId: eventHasOccurrences ? selectedOccurrenceId : null,
          status: statusFilter,
          search: registrationSearch.trim() || null,
          limit: REGISTRATION_PAGE_SIZE,
          offset,
        });

        setRegistrations(nextRegistrations);
        setSelectedRegistrationId((currentRegistrationId) => {
          if (
            currentRegistrationId &&
            nextRegistrations.some((registration) => registration.id === currentRegistrationId)
          ) {
            return currentRegistrationId;
          }

          return null;
        });

        return nextRegistrations;
      } catch (nextError) {
        const message =
          nextError instanceof Error
            ? nextError.message
            : "Не удалось загрузить регистрации события.";
        setRegistrationsError(message);
        throw nextError;
      } finally {
        if (!silent) {
          setRegistrationsLoading(false);
        }
      }
    },
    [
      eventHasOccurrences,
      offset,
      registrationSearch,
      selectedEventId,
      selectedOccurrenceId,
      statusFilter,
    ],
  );

  const loadCapacityRegistrations = useCallback(
    async ({ silent = false }: { silent?: boolean } = {}) => {
      if (!selectedEventId) {
        setCapacityRegistrations([]);
        setCapacityRegistrationsLoading(false);
        setCapacityRegistrationsError(null);
        return [];
      }

      if (eventHasOccurrences && !selectedOccurrenceId) {
        setCapacityRegistrations([]);
        setCapacityRegistrationsLoading(false);
        setCapacityRegistrationsError(null);
        return [];
      }

      if (!silent) {
        setCapacityRegistrationsLoading(true);
        setCapacityRegistrations([]);
      }

      setCapacityRegistrationsError(null);

      try {
        const nextCapacityRegistrations = await listEventRegistrations({
          eventId: selectedEventId,
          occurrenceId: eventHasOccurrences ? selectedOccurrenceId : null,
          status: "all",
          search: null,
          limit: CAPACITY_REGISTRATION_LIMIT,
          offset: 0,
        });

        setCapacityRegistrations(nextCapacityRegistrations);
        return nextCapacityRegistrations;
      } catch (nextError) {
        const message =
          nextError instanceof Error
            ? nextError.message
            : "Не удалось загрузить данные занятости мест.";
        setCapacityRegistrations([]);
        setCapacityRegistrationsError(message);
        return [];
      } finally {
        if (!silent) {
          setCapacityRegistrationsLoading(false);
        }
      }
    },
    [eventHasOccurrences, selectedEventId, selectedOccurrenceId],
  );

  const loadCapacityBuckets = useCallback(
    async ({ silent = false }: { silent?: boolean } = {}) => {
      if (!selectedEventId) {
        setCapacityBuckets([]);
        setCapacityBucketsLoading(false);
        setCapacityBucketsError(null);
        return [];
      }

      if (eventHasOccurrences && !selectedOccurrenceId) {
        setCapacityBuckets([]);
        setCapacityBucketsLoading(false);
        setCapacityBucketsError(null);
        return [];
      }

      if (!silent) {
        setCapacityBucketsLoading(true);
        setCapacityBuckets([]);
      }

      setCapacityBucketsError(null);

      try {
        const nextBuckets = await listAdminRegistrationCapacityBuckets({
          eventId: selectedEventId,
          occurrenceId: eventHasOccurrences ? selectedOccurrenceId : null,
        });

        setCapacityBuckets(nextBuckets);
        return nextBuckets;
      } catch (nextError) {
        const message =
          nextError instanceof Error
            ? nextError.message
            : "Не удалось загрузить слоты мест.";
        setCapacityBuckets([]);
        setCapacityBucketsError(message);
        return [];
      } finally {
        if (!silent) {
          setCapacityBucketsLoading(false);
        }
      }
    },
    [eventHasOccurrences, selectedEventId, selectedOccurrenceId],
  );

  useEffect(() => {
    void loadRegistrationEventSummaries().catch(() => undefined);
  }, [loadRegistrationEventSummaries]);

  useEffect(() => {
    void loadRegistrations().catch(() => undefined);
  }, [loadRegistrations]);

  useEffect(() => {
    void loadCapacityRegistrations();
  }, [loadCapacityRegistrations]);

  useEffect(() => {
    void loadCapacityBuckets();
  }, [loadCapacityBuckets]);

  useEffect(() => {
    if (!selectedEventId || !eventHasOccurrences) {
      setOccurrences([]);
      setOccurrencesError(null);
      setOccurrencesLoading(false);
      return undefined;
    }

    let cancelled = false;
    setOccurrencesLoading(true);
    setOccurrencesError(null);
    setOccurrences([]);

    listAdminEventOccurrences(selectedEventId)
      .then((nextOccurrences) => {
        if (!cancelled) {
          setOccurrences(nextOccurrences);
        }
      })
      .catch((nextError) => {
        if (!cancelled) {
          const message =
            nextError instanceof Error
              ? nextError.message
              : "Не удалось загрузить даты события.";
          setOccurrencesError(message);
          setOccurrences([]);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setOccurrencesLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [eventHasOccurrences, selectedEventId]);

  const visibleOccurrences = useMemo(() => {
    if (showPastOccurrences) {
      return occurrences;
    }

    return occurrences.filter((occurrence) => !isPastOccurrence(occurrence));
  }, [occurrences, showPastOccurrences]);

  const hasOnlyPastOccurrences =
    occurrences.length > 0 && visibleOccurrences.length === 0;

  useEffect(() => {
    if (!eventHasOccurrences) {
      if (selectedOccurrenceId !== null) {
        setSelectedOccurrenceId(null);
      }
      return;
    }

    if (occurrences.length === 0) {
      return;
    }

    setSelectedOccurrenceId((currentId) => {
      if (currentId && visibleOccurrences.some((occurrence) => occurrence.id === currentId)) {
        return currentId;
      }

      if (visibleOccurrences.length === 0) {
        return null;
      }

      const now = Date.now();
      const sorted = [...visibleOccurrences].sort((left, right) => {
        const leftTime = new Date(left.startsAt).getTime();
        const rightTime = new Date(right.startsAt).getTime();
        return leftTime - rightTime;
      });
      const future = sorted.find((occurrence) => {
        const startTime = new Date(occurrence.startsAt).getTime();
        return Number.isFinite(startTime) && startTime >= now;
      });

      return future?.id ?? sorted[0]?.id ?? null;
    });
  }, [eventHasOccurrences, occurrences, selectedOccurrenceId, visibleOccurrences]);

  const selectedOccurrence = useMemo(
    () =>
      occurrences.find((occurrence) => occurrence.id === selectedOccurrenceId) ?? null,
    [occurrences, selectedOccurrenceId],
  );
  const exportOccurrence =
    eventHasOccurrences && selectedOccurrence ? selectedOccurrence : null;
  const exportHint = exportOccurrence
    ? "Экспорт выбранного сеанса"
    : "Экспорт всех записей события";

  const filteredEvents = useMemo(() => {
    const normalizedQuery = eventQuery.trim().toLocaleLowerCase("ru");

    if (!normalizedQuery) {
      return events;
    }

    return events.filter((event) => {
      const searchableText = [
        event.title,
        event.startsAt,
        event.eventKind,
        event.registrationMode,
      ]
        .filter(Boolean)
        .join(" ")
        .toLocaleLowerCase("ru");

      return searchableText.includes(normalizedQuery);
    });
  }, [eventQuery, events]);

  const selectedRegistration = useMemo(
    () =>
      registrations.find((registration) => registration.id === selectedRegistrationId) ??
      null,
    [registrations, selectedRegistrationId],
  );

  const hasPreviousPage = offset > 0;
  const hasNextPage = registrations.length === REGISTRATION_PAGE_SIZE;
  const registrationRangeStart = registrations.length > 0 ? offset + 1 : 0;
  const registrationRangeEnd = offset + registrations.length;

  const refreshAfterAction = useCallback(async () => {
    await Promise.all([
      loadRegistrationEventSummaries({ silent: true }),
      loadRegistrations({ silent: true }),
      loadCapacityRegistrations({ silent: true }),
      loadCapacityBuckets({ silent: true }),
    ]);
  }, [
    loadCapacityBuckets,
    loadCapacityRegistrations,
    loadRegistrationEventSummaries,
    loadRegistrations,
  ]);

  const runRegistrationAction = useCallback(
    async (registration: AdminEventRegistrationRow, action: RegistrationAction) => {
      if (actionInFlight) {
        return;
      }

      const nextStatus = action.status;
      setActionInFlight({ registrationId: registration.id, status: nextStatus });
      setActionError(null);

      try {
        if (action.kind === "status") {
          await updateRegistrationStatus(registration.id, action.status);
        } else {
          await markRegistrationAttendance(registration.id, action.status);
        }

        await refreshAfterAction();
        setPendingAction(null);
        pushToast(
          "success",
          `${registration.participantDisplayName}: ${getRegistrationStatusLabel(nextStatus)}.`,
        );
      } catch (nextError) {
        const message =
          nextError instanceof Error
            ? nextError.message
            : "Не удалось обновить регистрацию.";
        setActionError(message);
        pushToast("error", message);
      } finally {
        setActionInFlight(null);
      }
    },
    [actionInFlight, pushToast, refreshAfterAction],
  );

  const requestRegistrationAction = useCallback(
    (registration: AdminEventRegistrationRow, action: RegistrationAction) => {
      setActionError(null);

      if (action.destructive) {
        setPendingAction({ action, registration });
        return;
      }

      void runRegistrationAction(registration, action);
    },
    [runRegistrationAction],
  );

  const confirmPendingAction = useCallback(() => {
    if (!pendingAction) {
      return;
    }

    void runRegistrationAction(pendingAction.registration, pendingAction.action);
  }, [pendingAction, runRegistrationAction]);

  const handleSelectEvent = useCallback((eventId: string) => {
    setSelectedEventId(eventId);
    setSelectedRegistrationId(null);
    setStatusFilter("all");
    setRegistrationSearch("");
    setOffset(0);
    setSelectedOccurrenceId(null);
    setOccurrences([]);
    setOccurrencesError(null);
    setShowPastOccurrences(false);
  }, []);

  const handleSelectOccurrence = useCallback((occurrenceId: string | null) => {
    setSelectedOccurrenceId(occurrenceId);
    setSelectedRegistrationId(null);
    setOffset(0);
  }, []);

  const handleToggleArchive = useCallback((nextValue: boolean) => {
    setShowPastOccurrences(nextValue);
    setOffset(0);
  }, []);

  const handleStatusFilterChange = useCallback((nextStatus: RegistrationStatusFilter) => {
    setStatusFilter(nextStatus);
    setSelectedRegistrationId(null);
    setOffset(0);
  }, []);

  const handleRegistrationSearchChange = useCallback((nextSearch: string) => {
    setRegistrationSearch(nextSearch);
    setSelectedRegistrationId(null);
    setOffset(0);
  }, []);

  const handleCloseRegistrationModal = useCallback(() => {
    setSelectedRegistrationId(null);
  }, []);

  const handleOpenSeatingPlaceholder = useCallback(() => {
    pushToast("success", "Схема рассадки будет добавлена в следующем PR.");
  }, [pushToast]);

  const refreshAll = useCallback(() => {
    void Promise.all([
      loadRegistrationEventSummaries(),
      loadRegistrations(),
      loadCapacityRegistrations(),
      loadCapacityBuckets(),
    ]).catch((nextError) => {
      pushToast(
        "error",
        nextError instanceof Error ? nextError.message : "Не удалось обновить регистрации.",
      );
    });
  }, [
    loadCapacityBuckets,
    loadCapacityRegistrations,
    loadRegistrationEventSummaries,
    loadRegistrations,
    pushToast,
  ]);

  const handleExportExcel = useCallback(() => {
    if (!selectedEvent || excelExportLoading) {
      return;
    }

    setExcelExportLoading(true);

    void exportEventRegistrationsToExcel(selectedEvent, { occurrence: exportOccurrence })
      .then((result) => {
        pushToast("success", `Excel готов: ${formatRegistrationCount(result.rowCount)}.`);
      })
      .catch((nextError) => {
        console.error("Failed to export event registrations Excel.", nextError);
        pushToast(
          "error",
          "Не удалось сформировать Excel-файл. Обновите страницу и попробуйте снова.",
        );
      })
      .finally(() => {
        setExcelExportLoading(false);
      });
  }, [excelExportLoading, exportOccurrence, pushToast, selectedEvent]);

  return (
    <div className="page-stack page-stack--registrations">
      <section className="page-header registrations-page-header">
        <Badge tone="green">Supabase RPC</Badge>
        <h1>Регистрации</h1>
        <p>
          Рабочий центр заявок на события: список событий, таблица регистраций,
          детали участника и управление статусами через admin registration RPC.
        </p>
      </section>

      <div className="registrations-workspace">
        <RegistrationEventsPanel
          eventQuery={eventQuery}
          events={events}
          eventsError={eventsError}
          eventsLoading={eventsLoading}
          filteredEvents={filteredEvents}
          onEventQueryChange={setEventQuery}
          onRefresh={refreshAll}
          onRetry={() => void loadRegistrationEventSummaries()}
          onSelectEvent={handleSelectEvent}
          selectedEventId={selectedEventId}
        />
        <GlassCard className="registrations-main-panel" elevated>
          {selectedEvent ? (
            <>
              <div className="registrations-main-head">
                <div>
                  <div className="badge-row">
                    <Badge tone="glass">{formatEventKind(selectedEvent.eventKind)}</Badge>
                    <Badge tone="blue">
                      {selectedEvent.occurrenceCount > 0
                        ? `${selectedEvent.occurrenceCount} сеанс.`
                        : "без сеансов"}
                    </Badge>
                  </div>
                  <h2>{selectedEvent.title}</h2>
                  <p>{formatDateTime(selectedEvent.startsAt)}</p>
                </div>
                <RegistrationMainActions
                  eventsLoading={eventsLoading}
                  excelExportLoading={excelExportLoading}
                  exportDisabled={
                    !selectedEvent ||
                    registrationsLoading ||
                    eventsLoading ||
                    excelExportLoading
                  }
                  exportHint={exportHint}
                  onExportExcel={handleExportExcel}
                  onRefresh={refreshAll}
                  registrationsLoading={registrationsLoading}
                />
              </div>

              {eventHasOccurrences ? (
                <RegistrationOccurrenceBar
                  occurrences={visibleOccurrences}
                  occurrencesLoading={occurrencesLoading}
                  occurrencesError={occurrencesError}
                  selectedOccurrenceId={selectedOccurrenceId}
                  showPastOccurrences={showPastOccurrences}
                  onSelectOccurrence={handleSelectOccurrence}
                  onToggleArchive={handleToggleArchive}
                  selectedOccurrence={selectedOccurrence}
                />
              ) : null}

              <RegistrationCapacityBucketsOverview
                bucketError={capacityBucketsError}
                buckets={capacityBuckets}
                bucketsLoading={capacityBucketsLoading}
                error={capacityRegistrationsError}
                event={selectedEvent}
                isLoading={capacityRegistrationsLoading}
                onOpenSeatingPlaceholder={handleOpenSeatingPlaceholder}
                registrations={capacityRegistrations}
                selectedOccurrence={eventHasOccurrences ? selectedOccurrence : null}
              />

              <div className="registration-controls">
                <div className="registration-filter-chips" aria-label="Фильтр статуса">
                  {STATUS_FILTERS.map((filter) => (
                    <button
                      className={`registration-filter-chip${
                        statusFilter === filter.value ? " registration-filter-chip--active" : ""
                      }`}
                      key={filter.value}
                      onClick={() => handleStatusFilterChange(filter.value)}
                      type="button"
                    >
                      {filter.label}
                    </button>
                  ))}
                </div>

                <label className="registration-search-field registration-search-field--wide">
                  <span>Поиск по заявкам</span>
                  <input
                    onChange={(event) => handleRegistrationSearchChange(event.target.value)}
                    placeholder="Участник, email, телефон, комментарий, гость"
                    type="search"
                    value={registrationSearch}
                  />
                </label>
              </div>

              <div className="registrations-table-panel">
                <div className="registrations-table-panel__head">
                  <span>
                    Показано {registrationRangeStart}-{registrationRangeEnd}
                  </span>
                  <div className="registrations-pagination">
                    <Button
                      disabled={!hasPreviousPage || registrationsLoading}
                      onClick={() =>
                        setOffset((currentOffset) =>
                          Math.max(0, currentOffset - REGISTRATION_PAGE_SIZE),
                        )
                      }
                      size="sm"
                    >
                      Назад
                    </Button>
                    <Button
                      disabled={!hasNextPage || registrationsLoading}
                      onClick={() =>
                        setOffset((currentOffset) => currentOffset + REGISTRATION_PAGE_SIZE)
                      }
                      size="sm"
                    >
                      Далее
                    </Button>
                  </div>
                </div>

                {eventHasOccurrences && occurrencesLoading ? (
                  <RegistrationsState
                    description="Читаем admin_list_event_occurrences для серии."
                    title="Загрузка дат"
                  />
                ) : eventHasOccurrences &&
                  !occurrencesLoading &&
                  hasOnlyPastOccurrences &&
                  !showPastOccurrences ? (
                  <RegistrationsState
                    description="Активных дат нет. Откройте архив дат, чтобы посмотреть прошедшие списки."
                    title="Нет активных дат"
                  >
                    <Button onClick={() => handleToggleArchive(true)} size="sm">
                      Показать прошедшие
                    </Button>
                  </RegistrationsState>
                ) : eventHasOccurrences && !selectedOccurrenceId ? (
                  <RegistrationsState
                    description="Выберите дату/сеанс в селекторе выше, чтобы открыть список."
                    title="Дата не выбрана"
                  />
                ) : registrationsLoading ? (
                  <RegistrationsState
                    description="Читаем admin_list_event_registrations для выбранного события."
                    title="Загрузка регистраций"
                  />
                ) : registrationsError ? (
                  <RegistrationsState
                    description={registrationsError}
                    title="Регистрации не загрузились"
                  >
                    <Button onClick={() => void loadRegistrations()} size="sm">
                      Повторить
                    </Button>
                  </RegistrationsState>
                ) : registrations.length === 0 ? (
                  <RegistrationsState
                    description={
                      statusFilter === "all" && !registrationSearch.trim()
                        ? eventHasOccurrences && selectedOccurrenceId
                          ? "На эту дату пока нет регистраций."
                          : "По этому событию пока нет регистраций."
                        : "Для выбранного фильтра или поиска нет совпадений."
                    }
                    title="Нет заявок"
                  />
                ) : (
                  <RegistrationsTable
                    actionInFlight={actionInFlight}
                    actions={REGISTRATION_ACTIONS}
                    event={selectedEvent}
                    onAction={requestRegistrationAction}
                    onSelectRegistration={setSelectedRegistrationId}
                    registrations={registrations}
                    selectedRegistrationId={selectedRegistrationId}
                  />
                )}
              </div>
            </>
          ) : (
            <RegistrationsState
              description="Выберите событие слева, чтобы открыть заявки."
              title="Событие не выбрано"
            />
          )}
        </GlassCard>
      </div>

      <RegistrationDetailModal
        actionInFlight={actionInFlight}
        actions={REGISTRATION_ACTIONS}
        event={selectedEvent}
        onAction={requestRegistrationAction}
        onClose={handleCloseRegistrationModal}
        registration={selectedRegistration}
      />

      {pendingAction ? (
        <RegistrationConfirmDialog
          actionError={actionError}
          isLoading={Boolean(actionInFlight)}
          onCancel={() => {
            if (!actionInFlight) {
              setPendingAction(null);
              setActionError(null);
            }
          }}
          onConfirm={confirmPendingAction}
          pendingAction={pendingAction}
        />
      ) : null}

      <ToastViewport onRemove={removeToast} toasts={toasts} />
    </div>
  );
}

function RegistrationDetailModal({
  actionInFlight,
  actions,
  event,
  onAction,
  onClose,
  registration,
}: {
  actionInFlight: ActionInFlight | null;
  actions: RegistrationAction[];
  event: AdminRegistrationEventSummary | null;
  onAction: (registration: AdminEventRegistrationRow, action: RegistrationAction) => void;
  onClose: () => void;
  registration: AdminEventRegistrationRow | null;
}) {
  useEffect(() => {
    if (!registration) {
      return undefined;
    }

    const handleKeyDown = (keyboardEvent: KeyboardEvent) => {
      if (keyboardEvent.key === "Escape") {
        onClose();
      }
    };

    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose, registration]);

  if (!registration || typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <div
      className="registration-detail-modal-overlay"
      onMouseDown={(mouseEvent) => {
        if (mouseEvent.target === mouseEvent.currentTarget) {
          onClose();
        }
      }}
    >
      <section
        aria-labelledby="registration-detail-modal-title"
        aria-modal="true"
        className="registration-detail-modal"
        role="dialog"
      >
        <header className="registration-detail-modal__head">
          <div>
            <span>Заявка участника</span>
            <h2 id="registration-detail-modal-title">
              {registration.participantDisplayName}
            </h2>
          </div>
          <button
            aria-label="Закрыть детали регистрации"
            className="registration-detail-modal__close"
            onClick={onClose}
            type="button"
          >
            ×
          </button>
        </header>
        <div className="registration-detail-modal__body">
          <RegistrationDetailPanel
            actionInFlight={actionInFlight}
            actions={actions}
            event={event}
            onAction={onAction}
            registration={registration}
          />
        </div>
      </section>
    </div>,
    document.body,
  );
}

function RegistrationOccurrenceBar({
  occurrences,
  occurrencesLoading,
  occurrencesError,
  selectedOccurrenceId,
  showPastOccurrences,
  onSelectOccurrence,
  onToggleArchive,
  selectedOccurrence,
}: {
  occurrences: AdminEventOccurrence[];
  occurrencesLoading: boolean;
  occurrencesError: string | null;
  selectedOccurrenceId: string | null;
  showPastOccurrences: boolean;
  onSelectOccurrence: (occurrenceId: string | null) => void;
  onToggleArchive: (nextValue: boolean) => void;
  selectedOccurrence: AdminEventOccurrence | null;
}) {
  const isSelectedPast = selectedOccurrence
    ? isPastOccurrence(selectedOccurrence)
    : false;

  return (
    <div className="registration-occurrence-bar" aria-label="Дата сеанса">
      <label className="registration-occurrence-field">
        <span>Дата / сеанс</span>
        <select
          aria-label="Выбор даты сеанса"
          disabled={occurrencesLoading || occurrences.length === 0}
          onChange={(event) => onSelectOccurrence(event.target.value || null)}
          value={selectedOccurrenceId ?? ""}
        >
          {occurrences.length === 0 ? (
            <option value="">
              {occurrencesLoading ? "Загрузка..." : "Нет доступных дат"}
            </option>
          ) : (
            occurrences.map((occurrence) => {
              const isPast = isPastOccurrence(occurrence);
              const titleSuffix = occurrence.title ? ` · ${occurrence.title}` : "";
              const pastSuffix = isPast ? " · Прошло" : "";
              return (
                <option key={occurrence.id} value={occurrence.id}>
                  {formatDateTime(occurrence.startsAt)}
                  {titleSuffix}
                  {pastSuffix}
                </option>
              );
            })
          )}
        </select>
      </label>

      <label className="registration-occurrence-toggle">
        <input
          checked={showPastOccurrences}
          onChange={(event) => onToggleArchive(event.target.checked)}
          type="checkbox"
        />
        <span>Архив дат</span>
      </label>

      {isSelectedPast ? <Badge tone="muted">Архив</Badge> : null}

      {occurrencesError ? (
        <span className="registration-occurrence-error" role="alert">
          {occurrencesError}
        </span>
      ) : null}
    </div>
  );
}

function isPastOccurrence(occurrence: AdminEventOccurrence): boolean {
  const reference = occurrence.endsAt ?? occurrence.startsAt;
  if (!reference) {
    return false;
  }

  const timestamp = new Date(reference).getTime();
  if (!Number.isFinite(timestamp)) {
    return false;
  }

  return timestamp < Date.now();
}

function RegistrationConfirmDialog({
  actionError,
  isLoading,
  onCancel,
  onConfirm,
  pendingAction,
}: {
  actionError: string | null;
  isLoading: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  pendingAction: PendingRegistrationAction;
}) {
  const nextStatus = pendingAction.action.status;

  return (
    <div
      className="event-action-dialog-backdrop"
      onMouseDown={(mouseEvent) => {
        if (mouseEvent.target === mouseEvent.currentTarget && !isLoading) {
          onCancel();
        }
      }}
    >
      <section
        aria-labelledby="registration-action-dialog-title"
        aria-modal="true"
        className="event-action-dialog registration-action-dialog"
        role="dialog"
      >
        <div className="event-action-dialog__head">
          <div>
            <Badge tone={getRegistrationStatusTone(nextStatus)}>
              {getRegistrationStatusLabel(nextStatus)}
            </Badge>
            <h2 id="registration-action-dialog-title">Подтвердить действие</h2>
          </div>
          <Button disabled={isLoading} onClick={onCancel} variant="ghost">
            Закрыть
          </Button>
        </div>

        <div className="event-action-dialog__event">
          <span>Заявка</span>
          <strong>{pendingAction.registration.participantDisplayName}</strong>
        </div>

        <div className="event-action-dialog__states">
          <div className="event-action-state">
            <span>Сейчас</span>
            <Badge tone={getRegistrationStatusTone(pendingAction.registration.status)}>
              {getRegistrationStatusLabel(pendingAction.registration.status)}
            </Badge>
          </div>

          <div className="event-action-state event-action-state--next">
            <span>Будет</span>
            <Badge tone={getRegistrationStatusTone(nextStatus)}>
              {getRegistrationStatusLabel(nextStatus)}
            </Badge>
          </div>
        </div>

        <div className="event-action-dialog__notice event-action-dialog__notice--danger">
          <p>{getDestructiveActionDescription(nextStatus)}</p>
        </div>

        {actionError ? (
          <div className="form-error" role="alert">
            {actionError}
          </div>
        ) : null}

        <div className="event-action-dialog__actions">
          <Button disabled={isLoading} onClick={onCancel} variant="secondary">
            Отмена
          </Button>
          <Button disabled={isLoading} onClick={onConfirm} variant="primary">
            {isLoading ? pendingAction.action.loadingLabel : pendingAction.action.label}
          </Button>
        </div>
      </section>
    </div>
  );
}

function ToastViewport({
  onRemove,
  toasts,
}: {
  onRemove: (toastId: number) => void;
  toasts: ToastMessage[];
}) {
  if (toasts.length === 0 || typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <div className="registration-toast-stack" role="status">
      {toasts.map((toast) => (
        <button
          className={`registration-toast registration-toast--${toast.kind}`}
          key={toast.id}
          onClick={() => onRemove(toast.id)}
          type="button"
        >
          {toast.message}
        </button>
      ))}
    </div>,
    document.body,
  );
}
