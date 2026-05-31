import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { GlassCard } from "../components/ui/GlassCard";
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
import type { AdminBadgeTone } from "../types/admin";
import type { AdminEventOccurrence } from "../types/eventOccurrences";
import type {
  AdminEventRegistrationRow,
  AdminRegistrationAttendanceStatus,
  AdminRegistrationEventSummary,
  AdminRegistrationOptionSelectionSummary,
  AdminRegistrationStatus,
  AdminRegistrationStatusUpdate,
} from "../types/registrations";
import type { AdminRegistrationCapacityBucket } from "../types/registrationCapacity";

type RegistrationStatusFilter = AdminRegistrationStatus | "all";
type ToastKind = "success" | "error";

type ToastMessage = {
  id: number;
  kind: ToastKind;
  message: string;
};

type RegistrationAction =
  | {
      kind: "status";
      status: AdminRegistrationStatusUpdate;
      label: string;
      loadingLabel: string;
      destructive?: boolean;
      variant?: "primary" | "secondary" | "ghost" | "gold";
    }
  | {
      kind: "attendance";
      status: AdminRegistrationAttendanceStatus;
      label: string;
      loadingLabel: string;
      destructive?: boolean;
      variant?: "primary" | "secondary" | "ghost" | "gold";
    };

type PendingRegistrationAction = {
  action: RegistrationAction;
  registration: AdminEventRegistrationRow;
};

type ActionInFlight = {
  registrationId: string;
  status: AdminRegistrationStatus;
};

type RegistrationActionMenuState = {
  registrationId: string;
  left: number;
  top: number;
};

type CapacityOverviewMode = "total" | "options" | "buckets";

type CapacityOptionStat = {
  key: string;
  title: string;
  quantity: number;
  seatsCount: number;
  isDonation: boolean;
  countsTowardCapacity: boolean;
};

type CapacityBucketView = AdminRegistrationCapacityBucket & {
  effectiveCapacity: number | null;
  effectiveRemainingSeats: number | null;
  effectiveFillPercent: number | null;
  effectiveFreePercent: number | null;
  usesFallbackCapacity: boolean;
};

const CAPACITY_OVERVIEW_MODES: Array<{
  value: CapacityOverviewMode;
  label: string;
}> = [
  { value: "total", label: "Все места выбранной даты" },
  { value: "options", label: "По вариантам участия" },
];

const CAPACITY_OVERVIEW_MODE_OPTIONS: Array<{
  value: CapacityOverviewMode;
  label: string;
}> = [
  { value: "total", label: "Все места выбранной даты" },
  { value: "options", label: "По вариантам участия" },
  { value: "buckets", label: "По слотам мест" },
];

const CAPACITY_OCCUPIED_STATUSES = new Set<string>([
  "confirmed",
  "pending",
  "attended",
  "no_show",
]);

const CAPACITY_REGISTRATION_LIMIT = 1000;
const REGISTRATION_PAGE_SIZE = 50;
const REGISTRATION_MENU_WIDTH = 232;
const REGISTRATION_MENU_HEIGHT = 318;

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

          return nextRegistrations[0]?.id ?? null;
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
        <GlassCard className="registrations-events-panel" elevated>
          <div className="registrations-panel__head">
            <div>
              <span>События</span>
              <strong>{events.length}</strong>
            </div>
            <Button disabled={eventsLoading} onClick={refreshAll} size="sm">
              {eventsLoading ? "..." : "Обновить"}
            </Button>
          </div>

          <label className="registration-search-field">
            <span>Поиск события</span>
            <input
              onChange={(event) => setEventQuery(event.target.value)}
              placeholder="Название или дата"
              type="search"
              value={eventQuery}
            />
          </label>

          <div className="registration-event-list">
            {eventsLoading ? (
              <RegistrationsState
                description="Читаем admin_list_registration_events."
                title="Загрузка событий"
              />
            ) : eventsError ? (
              <RegistrationsState description={eventsError} title="События не загрузились">
                <Button onClick={() => void loadRegistrationEventSummaries()} size="sm">
                  Повторить
                </Button>
              </RegistrationsState>
            ) : filteredEvents.length === 0 ? (
              <RegistrationsState
                description={
                  events.length === 0
                    ? "Для текущей сессии нет событий с доступными регистрациями."
                    : "Измените поиск по событиям."
                }
                title={events.length === 0 ? "Нет событий" : "Нет совпадений"}
              />
            ) : (
              filteredEvents.map((event) => (
                <RegistrationEventCard
                  event={event}
                  isSelected={event.eventId === selectedEventId}
                  key={event.eventId}
                  onSelect={handleSelectEvent}
                />
              ))
            )}
          </div>
        </GlassCard>

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
                <div className="registrations-main-actions">
                  <div className="registrations-export-group">
                    <Button
                      disabled={
                        !selectedEvent ||
                        registrationsLoading ||
                        eventsLoading ||
                        excelExportLoading
                      }
                      onClick={handleExportExcel}
                      size="sm"
                      variant="gold"
                    >
                      {excelExportLoading ? "Готовим Excel..." : "Экспорт Excel"}
                    </Button>
                    <small className="registrations-export-hint">{exportHint}</small>
                  </div>
                  <Button
                    disabled={registrationsLoading || eventsLoading}
                    onClick={refreshAll}
                    size="sm"
                  >
                    {registrationsLoading ? "Обновляем..." : "Обновить"}
                  </Button>
                </div>
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

        <GlassCard className="registration-detail-panel" elevated>
          <RegistrationDetailPanel
            actionInFlight={actionInFlight}
            event={selectedEvent}
            onAction={requestRegistrationAction}
            registration={selectedRegistration}
          />
        </GlassCard>
      </div>

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

function RegistrationCapacityOverview({
  error,
  event,
  isLoading,
  registrations,
  selectedOccurrence,
}: {
  error: string | null;
  event: AdminRegistrationEventSummary;
  isLoading: boolean;
  registrations: AdminEventRegistrationRow[];
  selectedOccurrence: AdminEventOccurrence | null;
}) {
  const [mode, setMode] = useState<CapacityOverviewMode>("total");
  const isOccurrenceMissing = event.occurrenceCount > 0 && !selectedOccurrence;
  const selectedModeLabel =
    CAPACITY_OVERVIEW_MODES.find((entry) => entry.value === mode)?.label ??
    CAPACITY_OVERVIEW_MODES[0].label;
  const occupiedRegistrations = useMemo(
    () => registrations.filter((registration) => isCapacityOccupiedStatus(registration.status)),
    [registrations],
  );
  const occupiedSeats = useMemo(
    () =>
      occupiedRegistrations.reduce(
        (total, registration) => total + Math.max(0, registration.seatsCount),
        0,
      ),
    [occupiedRegistrations],
  );
  const optionStats = useMemo(
    () => buildCapacityOptionStats(occupiedRegistrations),
    [occupiedRegistrations],
  );
  const capacity = selectedOccurrence?.capacity ?? event.capacity ?? null;
  const hasCapacity = capacity !== null;
  const safeCapacity = Math.max(0, capacity ?? 0);
  const fillPercent =
    hasCapacity && safeCapacity > 0
      ? Math.min(100, Math.round((occupiedSeats / safeCapacity) * 100))
      : null;
  const remainingSeats = hasCapacity ? Math.max(0, safeCapacity - occupiedSeats) : null;
  const freePercent =
    hasCapacity && safeCapacity > 0 && remainingSeats !== null
      ? Math.max(0, 100 - (fillPercent ?? 0))
      : null;

  return (
    <section className="registration-capacity-overview" aria-label="Занятость мест">
      <div className="registration-capacity-overview__head">
        <div>
          <span>{formatCapacityScopeLabel(event, selectedOccurrence)}</span>
          <strong>{selectedModeLabel}</strong>
        </div>
        <label className="registration-capacity-overview__mode">
          <span>Статистика</span>
          <select
            onChange={(selectEvent) =>
              setMode(selectEvent.target.value as CapacityOverviewMode)
            }
            value={mode}
          >
            {CAPACITY_OVERVIEW_MODES.map((entry) => (
              <option key={entry.value} value={entry.value}>
                {entry.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {isOccurrenceMissing ? (
        <div className="registration-capacity-soft-state">
          Выберите дату/сеанс, чтобы увидеть занятость мест.
        </div>
      ) : isLoading ? (
        <div className="registration-capacity-soft-state">
          Загружаем данные занятости мест...
        </div>
      ) : error ? (
        <div className="registration-capacity-soft-state registration-capacity-soft-state--error">
          <strong>Не удалось загрузить данные занятости мест.</strong>
          <span>{error}</span>
        </div>
      ) : mode === "total" ? (
        <div className="registration-capacity-total">
          <div className="registration-capacity-total__main">
            <span>Зарегистрировалось</span>
            <strong>
              {hasCapacity
                ? `${occupiedSeats} из ${safeCapacity} мест`
                : `${occupiedSeats} мест`}
            </strong>
            <small>
              {hasCapacity && remainingSeats !== null
                ? `Осталось ${remainingSeats} мест`
                : "Лимит мест не задан"}
            </small>
          </div>

          <div className="registration-capacity-meter">
            <div
              aria-valuemax={hasCapacity ? 100 : undefined}
              aria-valuemin={hasCapacity ? 0 : undefined}
              aria-valuenow={fillPercent ?? undefined}
              className="registration-capacity-meter__track"
              role={hasCapacity ? "progressbar" : undefined}
            >
              <span style={{ width: `${fillPercent ?? 0}%` }} />
            </div>
            <div className="registration-capacity-meter__labels">
              <span>
                {fillPercent !== null
                  ? `${fillPercent}% заполнено`
                  : "Лимит мест не задан"}
              </span>
              {freePercent !== null && remainingSeats !== null ? (
                <span>
                  {remainingSeats} ({freePercent}%) свободно
                </span>
              ) : null}
            </div>
          </div>

          <div className="registration-capacity-total__free">
            <span>Свободные места</span>
            <strong>
              {remainingSeats !== null && freePercent !== null
                ? `${remainingSeats} (${freePercent}%)`
                : "Лимит не задан"}
            </strong>
            <small>
              {remainingSeats !== null
                ? `Осталось ${remainingSeats} мест`
                : "Без расчёта процента"}
            </small>
          </div>
        </div>
      ) : (
        <div className="registration-capacity-options">
          {optionStats.length > 0 ? (
            optionStats.map((option) => {
              const doesNotOccupySeats =
                option.isDonation || option.countsTowardCapacity === false;

              return (
                <div className="registration-capacity-option-row" key={option.key}>
                  <div>
                    <strong>{option.title}</strong>
                    {doesNotOccupySeats ? <span>места не занимает</span> : null}
                  </div>
                  <span>{option.quantity} шт.</span>
                  <span>{option.seatsCount} мест</span>
                </div>
              );
            })
          ) : (
            <div className="registration-capacity-options__empty">
              В загруженных заявках нет выбранных вариантов участия.
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function RegistrationCapacityBucketsOverview({
  bucketError,
  buckets,
  bucketsLoading,
  error,
  event,
  isLoading,
  registrations,
  selectedOccurrence,
}: {
  bucketError: string | null;
  buckets: AdminRegistrationCapacityBucket[];
  bucketsLoading: boolean;
  error: string | null;
  event: AdminRegistrationEventSummary;
  isLoading: boolean;
  registrations: AdminEventRegistrationRow[];
  selectedOccurrence: AdminEventOccurrence | null;
}) {
  const [mode, setMode] = useState<CapacityOverviewMode>("total");
  const isOccurrenceMissing = event.occurrenceCount > 0 && !selectedOccurrence;
  const hasBuckets = buckets.length > 0;
  const selectedModeLabel =
    CAPACITY_OVERVIEW_MODE_OPTIONS.find((entry) => entry.value === mode)?.label ??
    CAPACITY_OVERVIEW_MODE_OPTIONS[0].label;
  const occupiedRegistrations = useMemo(
    () => registrations.filter((registration) => isCapacityOccupiedStatus(registration.status)),
    [registrations],
  );
  const occupiedSeats = useMemo(
    () =>
      occupiedRegistrations.reduce(
        (total, registration) => total + Math.max(0, registration.seatsCount),
        0,
      ),
    [occupiedRegistrations],
  );
  const optionStats = useMemo(
    () => buildCapacityOptionStats(occupiedRegistrations),
    [occupiedRegistrations],
  );
  const legacyCapacity = selectedOccurrence?.capacity ?? event.capacity ?? null;
  const legacySafeCapacity = Math.max(0, legacyCapacity ?? 0);
  const legacyFillPercent =
    legacyCapacity !== null && legacySafeCapacity > 0
      ? Math.min(100, Math.round((occupiedSeats / legacySafeCapacity) * 100))
      : null;
  const legacyRemainingSeats =
    legacyCapacity !== null ? Math.max(0, legacySafeCapacity - occupiedSeats) : null;
  const legacyFreePercent =
    legacyCapacity !== null && legacySafeCapacity > 0 && legacyRemainingSeats !== null
      ? Math.max(0, 100 - (legacyFillPercent ?? 0))
      : null;
  const bucketViews = useMemo(
    () => buckets.map((bucket) => buildCapacityBucketView(bucket, legacyCapacity)),
    [buckets, legacyCapacity],
  );
  const bucketAggregate = useMemo(
    () => buildCapacityBucketAggregate(bucketViews),
    [bucketViews],
  );

  useEffect(() => {
    setMode(hasBuckets ? "buckets" : "total");
  }, [event.eventId, hasBuckets, selectedOccurrence?.id]);

  const renderLegacyTotal = () => {
    if (isLoading) {
      return (
        <div className="registration-capacity-soft-state">
          Загружаем данные занятости мест...
        </div>
      );
    }

    if (error) {
      return (
        <div className="registration-capacity-soft-state registration-capacity-soft-state--error">
          <strong>Не удалось загрузить данные занятости мест.</strong>
          <span>{error}</span>
        </div>
      );
    }

    return (
      <div className="registration-capacity-total">
        <div className="registration-capacity-total__main">
          <span>Зарегистрировалось</span>
          <strong>
            {legacyCapacity !== null
              ? `${occupiedSeats} из ${legacySafeCapacity} мест`
              : `${occupiedSeats} мест`}
          </strong>
          <small>
            {legacyCapacity !== null && legacyRemainingSeats !== null
              ? `Осталось ${legacyRemainingSeats} мест`
              : "Лимит мест не задан"}
          </small>
        </div>

        <RegistrationCapacityMeter
          fillPercent={legacyFillPercent}
          label={
            legacyFillPercent !== null
              ? `${legacyFillPercent}% заполнено`
              : "Лимит мест не задан"
          }
          secondaryLabel={
            legacyFreePercent !== null && legacyRemainingSeats !== null
              ? `${legacyRemainingSeats} (${legacyFreePercent}%) свободно`
              : null
          }
        />

        <div className="registration-capacity-total__free">
          <span>Свободные места</span>
          <strong>
            {legacyRemainingSeats !== null && legacyFreePercent !== null
              ? `${legacyRemainingSeats} (${legacyFreePercent}%)`
              : "Лимит не задан"}
          </strong>
          <small>
            {legacyRemainingSeats !== null
              ? `Осталось ${legacyRemainingSeats} мест`
              : "Без расчёта процента"}
          </small>
        </div>
      </div>
    );
  };

  const renderBucketAggregate = () => (
    <>
      <div className="registration-capacity-total">
        <div className="registration-capacity-total__main">
          <span>Занято по слотам</span>
          <strong>
            {bucketAggregate.knownCapacity > 0 && !bucketAggregate.hasUnlimitedBuckets
              ? `${bucketAggregate.occupiedSeats} из ${bucketAggregate.knownCapacity} мест`
              : `${bucketAggregate.occupiedSeats} мест`}
          </strong>
          <small>
            {bucketAggregate.knownCapacity > 0
              ? `Осталось ${bucketAggregate.remainingSeats} мест в слотах с лимитом`
              : "Лимит мест не задан"}
          </small>
        </div>

        <RegistrationCapacityMeter
          fillPercent={bucketAggregate.fillPercent}
          label={
            bucketAggregate.fillPercent !== null
              ? `${bucketAggregate.fillPercent}% заполнено`
              : "Лимит мест не задан"
          }
          secondaryLabel={
            bucketAggregate.freePercent !== null
              ? `${bucketAggregate.remainingSeats} (${bucketAggregate.freePercent}%) свободно`
              : null
          }
        />

        <div className="registration-capacity-total__free">
          <span>Свободные места</span>
          <strong>
            {bucketAggregate.knownCapacity > 0 && bucketAggregate.freePercent !== null
              ? `${bucketAggregate.remainingSeats} (${bucketAggregate.freePercent}%)`
              : "Лимит не задан"}
          </strong>
          <small>
            {bucketAggregate.knownCapacity > 0
              ? `По ${bucketAggregate.limitedBucketCount} слотам с лимитом`
              : "Без расчёта процента"}
          </small>
        </div>
      </div>

      {bucketAggregate.hasUnlimitedBuckets ? (
        <p className="registration-capacity-helper">
          Есть слоты без лимита, общий процент рассчитан только по слотам с лимитом.
        </p>
      ) : null}
    </>
  );

  const renderTotal = () => {
    if (hasBuckets) {
      return renderBucketAggregate();
    }

    return (
      <>
        {bucketsLoading ? (
          <div className="registration-capacity-soft-state">
            Загружаем слоты мест...
          </div>
        ) : bucketError ? (
          <div className="registration-capacity-soft-state registration-capacity-soft-state--error">
            <strong>Не удалось загрузить слоты мест.</strong>
            <span>{bucketError}</span>
          </div>
        ) : null}
        {renderLegacyTotal()}
      </>
    );
  };

  const renderBuckets = () => {
    if (bucketsLoading) {
      return (
        <div className="registration-capacity-soft-state">
          Загружаем слоты мест...
        </div>
      );
    }

    if (bucketError) {
      return (
        <div className="registration-capacity-soft-state registration-capacity-soft-state--error">
          <strong>Не удалось загрузить слоты мест.</strong>
          <span>{bucketError}</span>
        </div>
      );
    }

    if (bucketViews.length === 0) {
      return (
        <div className="registration-capacity-soft-state">
          Слоты мест для выбранной даты не найдены. Используется общий overview.
        </div>
      );
    }

    return (
      <div className="registration-capacity-buckets">
        {bucketViews.map((bucket) => {
          const hasCapacity = bucket.effectiveCapacity !== null;
          const title = bucket.title || "Слот мест";
          const bucketKey = bucket.key || bucket.capacityUnitId;

          return (
            <div className="registration-capacity-bucket-row" key={bucket.capacityUnitId}>
              <div className="registration-capacity-bucket-row__head">
                <div className="registration-capacity-bucket-row__title">
                  <strong>{title}</strong>
                  <span>{bucketKey}</span>
                </div>
                <div className="registration-capacity-bucket-row__count">
                  <strong>
                    {hasCapacity
                      ? `${bucket.occupiedSeats} из ${bucket.effectiveCapacity} мест`
                      : `${bucket.occupiedSeats} мест`}
                  </strong>
                  <span>
                    {hasCapacity && bucket.effectiveRemainingSeats !== null
                      ? `Осталось ${bucket.effectiveRemainingSeats}`
                      : "Лимит не задан"}
                  </span>
                </div>
              </div>

              <RegistrationCapacityMeter
                fillPercent={bucket.effectiveFillPercent}
                label={
                  bucket.effectiveFillPercent !== null
                    ? `${bucket.effectiveFillPercent}% заполнено`
                    : "Лимит не задан"
                }
                secondaryLabel={
                  bucket.effectiveFreePercent !== null && bucket.effectiveRemainingSeats !== null
                    ? `${bucket.effectiveRemainingSeats} (${bucket.effectiveFreePercent}%) свободно`
                    : null
                }
              />

              <div className="registration-capacity-bucket-row__meta">
                {bucket.optionTitles.length > 0 ? (
                  <span>Варианты: {bucket.optionTitles.join(", ")}</span>
                ) : null}
                {bucket.reservationsCount > 0 ? (
                  <span>{bucket.reservationsCount} резерв.</span>
                ) : null}
                {bucket.usesFallbackCapacity ? (
                  <span>лимит взят из выбранной даты/события</span>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  const renderOptions = () => {
    if (isLoading) {
      return (
        <div className="registration-capacity-soft-state">
          Загружаем варианты участия...
        </div>
      );
    }

    if (error) {
      return (
        <div className="registration-capacity-soft-state registration-capacity-soft-state--error">
          <strong>Не удалось загрузить варианты участия.</strong>
          <span>{error}</span>
        </div>
      );
    }

    return (
      <>
        <div className="registration-capacity-options">
          {optionStats.length > 0 ? (
            optionStats.map((option) => {
              const doesNotOccupySeats =
                option.isDonation || option.countsTowardCapacity === false;

              return (
                <div className="registration-capacity-option-row" key={option.key}>
                  <div>
                    <strong>{option.title}</strong>
                    {doesNotOccupySeats ? <span>места не занимает</span> : null}
                  </div>
                  <span>{option.quantity} шт.</span>
                  <span>{option.seatsCount} мест</span>
                </div>
              );
            })
          ) : (
            <div className="registration-capacity-options__empty">
              В загруженных заявках нет выбранных вариантов участия.
            </div>
          )}
        </div>
        <p className="registration-capacity-helper">
          Фактическая занятость мест считается по слотам мест.
        </p>
      </>
    );
  };

  return (
    <section className="registration-capacity-overview" aria-label="Занятость мест">
      <div className="registration-capacity-overview__head">
        <div>
          <span>{formatCapacityScopeLabel(event, selectedOccurrence)}</span>
          <strong>{selectedModeLabel}</strong>
        </div>
        <label className="registration-capacity-overview__mode">
          <span>Статистика</span>
          <select
            onChange={(selectEvent) =>
              setMode(selectEvent.target.value as CapacityOverviewMode)
            }
            value={mode}
          >
            {CAPACITY_OVERVIEW_MODE_OPTIONS.map((entry) => (
              <option key={entry.value} value={entry.value}>
                {entry.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {isOccurrenceMissing ? (
        <div className="registration-capacity-soft-state">
          Выберите дату/сеанс, чтобы увидеть занятость мест.
        </div>
      ) : mode === "buckets" ? (
        renderBuckets()
      ) : mode === "total" ? (
        renderTotal()
      ) : (
        renderOptions()
      )}
    </section>
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

function formatCapacityScopeLabel(
  event: AdminRegistrationEventSummary,
  selectedOccurrence: AdminEventOccurrence | null,
): string {
  if (selectedOccurrence) {
    const titleSuffix = selectedOccurrence.title ? ` · ${selectedOccurrence.title}` : "";
    return `${formatDateTime(selectedOccurrence.startsAt)}${titleSuffix}`;
  }

  return event.startsAt ? formatDateTime(event.startsAt) : "Дата события";
}

function isCapacityOccupiedStatus(status: string): boolean {
  return CAPACITY_OCCUPIED_STATUSES.has(status);
}

function buildCapacityOptionStats(
  registrations: AdminEventRegistrationRow[],
): CapacityOptionStat[] {
  const statsByKey = new Map<string, CapacityOptionStat>();

  registrations.forEach((registration) => {
    registration.selectedOptions.forEach((option) => {
      const key = getCapacityOptionKey(option);
      const current = statsByKey.get(key);

      if (current) {
        current.quantity += option.quantity;
        current.seatsCount += option.seatsCount;
        current.isDonation = current.isDonation || option.isDonation;
        current.countsTowardCapacity =
          current.countsTowardCapacity && option.countsTowardCapacity;
        return;
      }

      statsByKey.set(key, {
        key,
        title: option.title,
        quantity: option.quantity,
        seatsCount: option.seatsCount,
        isDonation: option.isDonation,
        countsTowardCapacity: option.countsTowardCapacity,
      });
    });
  });

  return Array.from(statsByKey.values()).sort((left, right) =>
    left.title.localeCompare(right.title, "ru"),
  );
}

function buildCapacityBucketView(
  bucket: AdminRegistrationCapacityBucket,
  fallbackCapacity: number | null,
): CapacityBucketView {
  const effectiveCapacity =
    bucket.capacity !== null ? Math.max(0, bucket.capacity) : fallbackCapacity;
  const safeEffectiveCapacity =
    effectiveCapacity !== null ? Math.max(0, effectiveCapacity) : null;
  const effectiveRemainingSeats =
    safeEffectiveCapacity !== null
      ? Math.max(0, safeEffectiveCapacity - bucket.occupiedSeats)
      : null;
  const effectiveFillPercent =
    safeEffectiveCapacity !== null && safeEffectiveCapacity > 0
      ? Math.min(100, Math.round((bucket.occupiedSeats / safeEffectiveCapacity) * 100))
      : null;
  const effectiveFreePercent =
    effectiveFillPercent !== null ? Math.max(0, 100 - effectiveFillPercent) : null;

  return {
    ...bucket,
    effectiveCapacity: safeEffectiveCapacity,
    effectiveRemainingSeats,
    effectiveFillPercent,
    effectiveFreePercent,
    usesFallbackCapacity: bucket.capacity === null && fallbackCapacity !== null,
  };
}

function buildCapacityBucketAggregate(buckets: CapacityBucketView[]) {
  const occupiedSeats = buckets.reduce((total, bucket) => total + bucket.occupiedSeats, 0);
  const limitedBuckets = buckets.filter((bucket) => bucket.effectiveCapacity !== null);
  const knownCapacity = limitedBuckets.reduce(
    (total, bucket) => total + (bucket.effectiveCapacity ?? 0),
    0,
  );
  const knownOccupiedSeats = limitedBuckets.reduce(
    (total, bucket) => total + bucket.occupiedSeats,
    0,
  );
  const remainingSeats = limitedBuckets.reduce(
    (total, bucket) => total + (bucket.effectiveRemainingSeats ?? 0),
    0,
  );
  const fillPercent =
    knownCapacity > 0
      ? Math.min(100, Math.round((knownOccupiedSeats / knownCapacity) * 100))
      : null;
  const freePercent = fillPercent !== null ? Math.max(0, 100 - fillPercent) : null;

  return {
    occupiedSeats,
    knownCapacity,
    remainingSeats,
    fillPercent,
    freePercent,
    limitedBucketCount: limitedBuckets.length,
    hasUnlimitedBuckets: limitedBuckets.length < buckets.length,
  };
}

function RegistrationCapacityMeter({
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

function getCapacityOptionKey(option: AdminRegistrationOptionSelectionSummary): string {
  return [
    option.optionId ?? option.title,
    option.optionType,
    option.isDonation ? "donation" : "seat",
    option.countsTowardCapacity ? "capacity" : "no-capacity",
  ].join("|");
}

function RegistrationsTable({
  actionInFlight,
  event,
  onAction,
  onSelectRegistration,
  registrations,
  selectedRegistrationId,
}: {
  actionInFlight: ActionInFlight | null;
  event: AdminRegistrationEventSummary;
  onAction: (registration: AdminEventRegistrationRow, action: RegistrationAction) => void;
  onSelectRegistration: (registrationId: string) => void;
  registrations: AdminEventRegistrationRow[];
  selectedRegistrationId: string | null;
}) {
  const [openActionMenu, setOpenActionMenu] = useState<RegistrationActionMenuState | null>(null);

  useEffect(() => {
    if (!openActionMenu) {
      return undefined;
    }

    const handleKeyDown = (keyboardEvent: KeyboardEvent) => {
      if (keyboardEvent.key === "Escape") {
        setOpenActionMenu(null);
      }
    };

    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [openActionMenu]);

  const openRegistration = openActionMenu
    ? registrations.find((registration) => registration.id === openActionMenu.registrationId)
    : null;

  const openActionsMenu = useCallback(
    (registration: AdminEventRegistrationRow, button: HTMLButtonElement) => {
      const rect = button.getBoundingClientRect();
      const safePadding = 12;
      const left = Math.max(
        safePadding,
        Math.min(
          rect.right - REGISTRATION_MENU_WIDTH,
          window.innerWidth - REGISTRATION_MENU_WIDTH - safePadding,
        ),
      );
      const top = Math.max(
        safePadding,
        Math.min(
          rect.bottom + 8,
          window.innerHeight - REGISTRATION_MENU_HEIGHT - safePadding,
        ),
      );

      setOpenActionMenu((current) =>
        current?.registrationId === registration.id
          ? null
          : {
              registrationId: registration.id,
              left,
              top,
            },
      );
    },
    [],
  );

  return (
    <div className="registrations-table-scroll">
      <div
        aria-label="Регистрации события"
        className="data-table data-table--registrations"
        role="table"
      >
        <div className="data-table__row data-table__row--head" role="row">
          <span role="columnheader">Участник</span>
          <span role="columnheader">Контакты</span>
          <span role="columnheader">Статус</span>
          <span role="columnheader">Дата/сеанс</span>
          <span role="columnheader">Мест</span>
          <span role="columnheader">Опции</span>
          <span role="columnheader">Оплата</span>
          <span role="columnheader">Заявка</span>
          <span role="columnheader">Действия</span>
        </div>

        {registrations.map((registration) => {
          const isSelected = registration.id === selectedRegistrationId;
          const fullOptionsLabel = formatOptionsFull(registration.selectedOptions);

          return (
            <div
              className={`data-table__row data-table__row--registration${
                isSelected ? " data-table__row--registration-selected" : ""
              }`}
              key={registration.id}
              onClick={() => onSelectRegistration(registration.id)}
              onKeyDown={(keyboardEvent) => {
                if (keyboardEvent.key === "Enter" || keyboardEvent.key === " ") {
                  keyboardEvent.preventDefault();
                  onSelectRegistration(registration.id);
                }
              }}
              role="row"
              tabIndex={0}
            >
              <div className="registration-table-person" role="cell">
                <span className="registration-avatar" aria-hidden="true">
                  {getInitials(registration.participantDisplayName)}
                </span>
                <div>
                  <strong>{registration.participantDisplayName}</strong>
                  {registration.guestNames.length > 0 ? (
                    <small>{registration.guestNames.length} гост.</small>
                  ) : null}
                </div>
              </div>
              <div className="registration-table-stack" role="cell">
                <span>{registration.email ?? "email не указан"}</span>
                <small>{registration.phone ?? "телефон не указан"}</small>
              </div>
              <span role="cell">
                <Badge tone={getRegistrationStatusTone(registration.status)}>
                  {getRegistrationStatusLabel(registration.status)}
                </Badge>
              </span>
              <div className="registration-table-stack" role="cell">
                <span>{formatOccurrenceLabel(registration, event)}</span>
                {registration.occurrenceTitle ? <small>{registration.occurrenceTitle}</small> : null}
              </div>
              <span role="cell">{registration.seatsCount}</span>
              <div
                aria-label={`Опции: ${fullOptionsLabel}`}
                className="registration-table-stack registration-table-stack--options"
                role="cell"
                title={fullOptionsLabel}
              >
                <span>{formatOptionsCompact(registration.selectedOptions)}</span>
                {registration.selectedOptions.length > 2 ? (
                  <small>+{registration.selectedOptions.length - 2} ещё</small>
                ) : null}
              </div>
              <div className="registration-table-stack" role="cell">
                <span>{formatPaymentStatus(registration.paymentStatus)}</span>
                {isSimulatedPaymentId(registration.paymentId) ? (
                  <Badge tone="gold">Тестовая оплата</Badge>
                ) : null}
                <small>{formatRegistrationAmount(registration)}</small>
              </div>
              <span role="cell">{formatDateTime(registration.registeredAt)}</span>
              <div
                aria-label={`Действия: ${registration.participantDisplayName}`}
                className="event-table__actions"
                role="cell"
              >
                <button
                  aria-expanded={openActionMenu?.registrationId === registration.id}
                  aria-haspopup="menu"
                  aria-label={`Действия регистрации: ${registration.participantDisplayName}`}
                  className="event-action-dots"
                  disabled={Boolean(actionInFlight)}
                  onClick={(clickEvent) => {
                    clickEvent.stopPropagation();
                    openActionsMenu(registration, clickEvent.currentTarget);
                  }}
                  onMouseDown={(mouseEvent) => {
                    mouseEvent.stopPropagation();
                  }}
                  type="button"
                >
                  ...
                </button>
              </div>
            </div>
          );
        })}

        {openActionMenu && openRegistration ? (
          <RegistrationOverflowMenu
            actionInFlight={actionInFlight}
            left={openActionMenu.left}
            onAction={(registration, action) => {
              setOpenActionMenu(null);
              onAction(registration, action);
            }}
            onClose={() => setOpenActionMenu(null)}
            registration={openRegistration}
            top={openActionMenu.top}
          />
        ) : null}
      </div>
    </div>
  );
}

function RegistrationOverflowMenu({
  actionInFlight,
  left,
  onAction,
  onClose,
  registration,
  top,
}: {
  actionInFlight: ActionInFlight | null;
  left: number;
  onAction: (registration: AdminEventRegistrationRow, action: RegistrationAction) => void;
  onClose: () => void;
  registration: AdminEventRegistrationRow;
  top: number;
}) {
  if (typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <div className="event-overflow-layer" onClick={onClose}>
      <div
        className="event-overflow-menu registration-action-menu"
        onClick={(clickEvent) => clickEvent.stopPropagation()}
        role="menu"
        style={{ left, top }}
      >
        {REGISTRATION_ACTIONS.map((action) => {
          const isCurrentStatus = registration.status === action.status;
          const isLoading =
            actionInFlight?.registrationId === registration.id &&
            actionInFlight.status === action.status;

          return (
            <button
              className={`event-overflow-menu__item registration-action-menu__item${
                action.destructive ? " registration-action-menu__item--danger" : ""
              }`}
              disabled={Boolean(actionInFlight) || isCurrentStatus}
              key={`${action.kind}-${action.status}`}
              onClick={() => onAction(registration, action)}
              role="menuitem"
              type="button"
            >
              {isLoading ? action.loadingLabel : action.label}
            </button>
          );
        })}
      </div>
    </div>,
    document.body,
  );
}

function RegistrationDetailPanel({
  actionInFlight,
  event,
  onAction,
  registration,
}: {
  actionInFlight: ActionInFlight | null;
  event: AdminRegistrationEventSummary | null;
  onAction: (registration: AdminEventRegistrationRow, action: RegistrationAction) => void;
  registration: AdminEventRegistrationRow | null;
}) {
  if (!registration || !event) {
    return (
      <RegistrationsState
        description="Выберите строку в таблице, чтобы открыть контакты, опции и историю статусов."
        title="Заявка не выбрана"
      />
    );
  }

  return (
    <div className="registration-detail">
      <div className="registration-detail__profile">
        <span className="registration-avatar registration-avatar--large" aria-hidden="true">
          {getInitials(registration.participantDisplayName)}
        </span>
        <h2>{registration.participantDisplayName}</h2>
        <div className="badge-row">
          <Badge tone={getRegistrationStatusTone(registration.status)}>
            {getRegistrationStatusLabel(registration.status)}
          </Badge>
          <Badge tone="glass">{registration.seatsCount} мест</Badge>
        </div>
      </div>

      <DetailSection title="Контакты">
        <DetailRow label="Email" value={registration.email ?? "Не указан"} />
        <DetailRow label="Телефон" value={registration.phone ?? "Не указан"} />
        <DetailRow label="User ID" value={registration.userId} />
      </DetailSection>

      <DetailSection title="Событие и сеанс">
        <DetailRow label="Событие" value={event.title} />
        <DetailRow label="Дата" value={formatOccurrenceLabel(registration, event)} />
        <DetailRow
          label="Сеанс"
          value={registration.occurrenceTitle ?? "Без отдельного сеанса"}
        />
      </DetailSection>

      <DetailSection title="Опции участия">
        {registration.selectedOptions.length > 0 ? (
          <div className="registration-options-list">
            {registration.selectedOptions.map((option) => (
              <div className="registration-option-row" key={option.id || option.title}>
                <div>
                  <strong>{option.title}</strong>
                  <span>
                    {option.isDonation ? "Пожертвование" : option.optionType} × {option.quantity}
                  </span>
                </div>
                <div>
                  <strong>{formatMoney(option.totalAmount, option.currency)}</strong>
                  <span>{option.isDonation ? "не место" : `${option.seatsCount} мест`}</span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="registration-detail__muted">Опции не выбраны.</p>
        )}
      </DetailSection>

      <DetailSection title="Гости и комментарий">
        {registration.guestNames.length > 0 ? (
          <div className="registration-guest-list">
            {registration.guestNames.map((guestName) => (
              <span key={guestName}>{guestName}</span>
            ))}
          </div>
        ) : (
          <p className="registration-detail__muted">Гости не указаны.</p>
        )}
        <DetailRow label="Комментарий" value={registration.comment ?? "Нет комментария"} />
      </DetailSection>

      <DetailSection title="Оплата">
        <DetailRow label="Статус" value={formatPaymentStatus(registration.paymentStatus)} />
        {isSimulatedPaymentId(registration.paymentId) ? (
          <div className="registration-detail-row">
            <span>Тип оплаты</span>
            <strong>
              <Badge tone="gold">Тестовая оплата</Badge>
            </strong>
          </div>
        ) : null}
        <DetailRow label="Сумма" value={formatRegistrationAmount(registration)} />
        <DetailRow label="Payment ID" value={registration.paymentId ?? "Не указан"} />
      </DetailSection>

      <DetailSection title="История">
        <DetailRow label="Зарегистрирован" value={formatDateTime(registration.registeredAt)} />
        <DetailRow label="Подтверждён" value={formatDateTime(registration.confirmedAt)} />
        <DetailRow label="Отменён/отклонён" value={formatDateTime(registration.cancelledAt)} />
      </DetailSection>

      <DetailSection title="Действия">
        <div className="registration-detail-actions">
          {REGISTRATION_ACTIONS.map((action) => {
            const isCurrentStatus = registration.status === action.status;
            const isLoading =
              actionInFlight?.registrationId === registration.id &&
              actionInFlight.status === action.status;

            return (
              <Button
                disabled={Boolean(actionInFlight) || isCurrentStatus}
                key={`${action.kind}-${action.status}`}
                onClick={() => onAction(registration, action)}
                size="sm"
                variant={action.variant ?? "secondary"}
              >
                {isLoading ? action.loadingLabel : action.label}
              </Button>
            );
          })}
        </div>
      </DetailSection>
    </div>
  );
}

function DetailSection({
  children,
  title,
}: {
  children: ReactNode;
  title: string;
}) {
  return (
    <section className="registration-detail-section">
      <h3>{title}</h3>
      {children}
    </section>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="registration-detail-row">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
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

function RegistrationsState({
  children,
  description,
  title,
}: {
  children?: ReactNode;
  description: string;
  title: string;
}) {
  return (
    <div className="registrations-state" role="status">
      <h3>{title}</h3>
      <p>{description}</p>
      {children ? <div className="registrations-state__actions">{children}</div> : null}
    </div>
  );
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

function formatOccurrenceLabel(
  registration: AdminEventRegistrationRow,
  event: AdminRegistrationEventSummary,
): string {
  if (registration.occurrenceStartsAt) {
    return formatDateTime(registration.occurrenceStartsAt);
  }

  if (event.startsAt) {
    return formatDateTime(event.startsAt);
  }

  return "Без отдельного сеанса";
}

function formatOptionsCompact(options: AdminRegistrationOptionSelectionSummary[]): string {
  if (options.length === 0) {
    return "Без опций";
  }

  return options
    .slice(0, 2)
    .map((option) => {
      const title = option.isDonation ? `Пожертвование: ${option.title}` : option.title;
      const amount =
        option.totalAmount > 0
          ? ` · ${formatMoney(option.totalAmount, option.currency)}`
          : "";
      return `${title} × ${option.quantity}${amount}`;
    })
    .join(", ");
}

function formatOptionsFull(options: AdminRegistrationOptionSelectionSummary[]): string {
  if (options.length === 0) {
    return "Без опций";
  }

  return options
    .map((option) => {
      const title = option.isDonation ? `Пожертвование: ${option.title}` : option.title;
      const amount =
        option.totalAmount > 0
          ? ` · ${formatMoney(option.totalAmount, option.currency)}`
          : "";
      const seats = option.isDonation ? "не место" : `${option.seatsCount} мест`;

      return `${title} × ${option.quantity}${amount} · ${seats}`;
    })
    .join("\n");
}

function formatRegistrationAmount(registration: AdminEventRegistrationRow): string {
  const amount =
    registration.totalAmount ??
    registration.selectedOptions.reduce((sum, option) => sum + option.totalAmount, 0);
  const hasAmount =
    registration.totalAmount !== null ||
    registration.selectedOptions.some((option) => option.totalAmount > 0);
  const currency = registration.selectedOptions[0]?.currency ?? "RUB";

  return hasAmount ? formatMoney(amount, currency) : "Без суммы";
}

function formatRegistrationCount(count: number): string {
  const remainder100 = count % 100;
  const remainder10 = count % 10;

  if (remainder100 >= 11 && remainder100 <= 14) {
    return `${count} регистраций`;
  }

  if (remainder10 === 1) {
    return `${count} регистрация`;
  }

  if (remainder10 >= 2 && remainder10 <= 4) {
    return `${count} регистрации`;
  }

  return `${count} регистраций`;
}

function formatMoney(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat("ru-RU", {
      currency,
      maximumFractionDigits: Number.isInteger(amount) ? 0 : 2,
      style: "currency",
    }).format(amount);
  } catch {
    return `${amount.toLocaleString("ru-RU")} ${currency}`;
  }
}

function formatPaymentStatus(status: string): string {
  const labels: Record<string, string> = {
    cancelled: "Отменено",
    failed: "Ошибка оплаты",
    not_required: "Не требуется",
    paid: "Оплачено",
    pending: "Ожидает оплаты",
    refunded: "Возврат",
    succeeded: "Оплачено",
  };

  return labels[status] ?? status;
}

function isSimulatedPaymentId(paymentId: string | null): boolean {
  return paymentId?.startsWith("simulated:") === true;
}

function getRegistrationStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    attended: "Пришёл",
    cancelled: "Отменено",
    confirmed: "Подтверждено",
    no_show: "No-show",
    pending: "Заявка",
    rejected: "Отклонено",
    waitlisted: "Лист ожидания",
  };

  return labels[status] ?? status;
}

function getRegistrationStatusTone(status: string): AdminBadgeTone {
  if (status === "confirmed" || status === "attended") {
    return "green";
  }

  if (status === "pending") {
    return "gold";
  }

  if (status === "waitlisted") {
    return "purple";
  }

  if (status === "rejected" || status === "no_show") {
    return "red";
  }

  if (status === "cancelled") {
    return "muted";
  }

  return "glass";
}

function getDestructiveActionDescription(status: string): string {
  if (status === "cancelled") {
    return "Заявка будет отменена через admin_update_registration_status. Участник исчезнет из текущего фильтра, если он не показывает отменённые заявки.";
  }

  if (status === "rejected") {
    return "Заявка будет отклонена через admin_update_registration_status. Используйте это только для заявок, которые не должны попасть в подтверждённые.";
  }

  return "Регистрация будет отмечена как No-show через admin_mark_registration_attendance.";
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);

  if (parts.length === 0) {
    return "?";
  }

  return parts
    .slice(0, 2)
    .map((part) => part.slice(0, 1).toLocaleUpperCase("ru"))
    .join("");
}

function formatEventKind(eventKind: string): string {
  const labels: Record<string, string> = {
    recurring: "повторяющееся",
    single: "одно событие",
  };

  return labels[eventKind] ?? eventKind;
}
