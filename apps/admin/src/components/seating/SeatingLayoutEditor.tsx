import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { createPortal } from "react-dom";

import { formatDateTime } from "../registrations/formatters";
import { Button } from "../ui/Button";
import { useAdminAuth } from "../../context/AdminAuthContext";
import {
  CHAIR_OFFSET,
  TABLE_H,
  TABLE_W,
  computeTableSeats,
  normalizeAngle,
  tableSideSeats,
} from "../../lib/seatingGeometry";
import {
  TABLE_ADD_DX,
  TABLE_ADD_DY,
  clampTableToCanvasStart,
  createEditorTable,
  ensureOneRabbiTable,
  normalizeEditorTables,
} from "../../lib/seatingEditorTables";
import {
  guestPoolSlotKey,
  hasGuestPoolMismatch as getGuestPoolMismatch,
  isGuestPoolPending,
} from "../../lib/seatingGuestPoolStatus";
import { computeSeatingMetricsDisplaySummary } from "../../lib/seatingCapacity";
import {
  autoAssignResultToAssignments,
  autoAssignSeating,
  deriveSeatingAssignmentRestoreState,
  seatIndexFromSeatKey,
} from "../../lib/seatingAutoAssign";
import {
  reconcileAfterGeometryChange,
  reconcileSeatingAssignments,
  type SeatingReconcileCounts,
} from "../../lib/seatingAssignmentReconcile";
import { buildSeatingPrintModel } from "../../lib/seatingPrint";
import {
  applySeatingDragDrop,
  type SeatingDragDropRejection,
  type SeatingDragSourceRef,
  type SeatingDropTargetRef,
} from "../../lib/seatingDragDrop";
import {
  createSeatingTemplateFromLayout,
  deleteSeatingTemplate,
  getSeatingLayout,
  listSeatingTemplates,
  saveSeatingAssignments,
  saveSeatingLayout,
} from "../../services/adminSeatingService";
import { updateCapacityUnitLimit } from "../../services/adminCapacityService";
import { getAdminRegistrationCapacityGuestPool } from "../../services/adminRegistrationCapacityService";
import type { AdminEventOccurrence } from "../../types/eventOccurrences";
import type { AdminRegistrationCapacityBucket } from "../../types/registrationCapacity";
import type { AdminRegistrationEventSummary } from "../../types/registrations";
import type {
  SeatingAssignment,
  SeatingAssignmentEntry,
  SeatingAssignmentsSaveResult,
  SeatingConnection,
  SeatingGuestPoolItem,
  SeatingLayoutRow,
  SeatingPrintModel,
  SeatingReservePoolItem,
  SeatingTable,
  SeatingTemplate,
} from "../../types/seating";
import { SeatingAssignmentsPanel } from "./SeatingAssignmentsPanel";
import { SeatingCanvas } from "./SeatingCanvas";
import { SeatingCapacitySyncDialog } from "./SeatingCapacitySyncDialog";
import { SeatingMetricsPanel } from "./SeatingMetricsPanel";
import { SeatingPrintDocument } from "./SeatingPrintDocument";
import { SeatingReserveDialog } from "./SeatingReserveDialog";
import {
  DEFAULT_SEATING_TEMPLATE_VALUE,
  SeatingTemplateSelector,
  isBuiltInSeatingTemplateId,
  parseUserSeatingTemplateValue,
  userSeatingTemplateValue,
  type BuiltInSeatingTemplateId,
  type SeatingTemplateValue,
} from "./SeatingTemplateSelector";
import { SeatingShortcutLegend, SeatingToolbar } from "./SeatingToolbar";

export type SeatingLayoutEditorSlot = {
  bucket: AdminRegistrationCapacityBucket;
  event: AdminRegistrationEventSummary;
  occurrence: AdminEventOccurrence | null;
};

type EditorFeedback = {
  message: string;
  tone: "muted" | "success" | "error";
};

const GRID_TABLE_CAPACITY = 8;
const HOLIDAY_TABLE_CAPACITY = 6.5;

let clientReserveSequence = 0;

export function SeatingLayoutEditor({
  onCapacityLimitUpdated,
  onClose,
  slot,
}: {
  onCapacityLimitUpdated?: (capacityUnitId: string, capacity: number | null) => void;
  onClose: () => void;
  slot: SeatingLayoutEditorSlot | null;
}) {
  const auth = useAdminAuth();
  const [connections, setConnections] = useState<SeatingConnection[]>([]);
  const [assignments, setAssignments] = useState<SeatingAssignment[]>([]);
  const [dragSource, setDragSource] = useState<SeatingDragSourceRef | null>(null);
  const [pendingGuestKey, setPendingGuestKey] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<EditorFeedback | null>(null);
  const [guestPool, setGuestPool] = useState<SeatingGuestPoolItem[]>([]);
  const [guestPoolError, setGuestPoolError] = useState<string | null>(null);
  const [layoutLoadError, setLayoutLoadError] = useState<string | null>(null);
  const [canvasCancelVersion, setCanvasCancelVersion] = useState(0);
  const [capacityLimitOverride, setCapacityLimitOverride] = useState<
    number | null | undefined
  >(undefined);
  const [capacitySyncError, setCapacitySyncError] = useState<string | null>(null);
  const [isCapacitySyncDialogOpen, setIsCapacitySyncDialogOpen] = useState(false);
  const [isCapacitySyncing, setIsCapacitySyncing] = useState(false);
  const [activeTemplateValue, setActiveTemplateValue] =
    useState<SeatingTemplateValue>(DEFAULT_SEATING_TEMPLATE_VALUE);
  const [isApplyingTemplate, setIsApplyingTemplate] = useState(false);
  const [isDeletingTemplate, setIsDeletingTemplate] = useState(false);
  const [isAutoAssigning, setIsAutoAssigning] = useState(false);
  const [loadedGuestPoolSlotKey, setLoadedGuestPoolSlotKey] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isReserveDialogOpen, setIsReserveDialogOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isSavingTemplate, setIsSavingTemplate] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [seatEditEnabled, setSeatEditEnabled] = useState(false);
  const [isTemplateListLoading, setIsTemplateListLoading] = useState(false);
  const [hasLoadedTemplates, setHasLoadedTemplates] = useState(false);
  const [printModel, setPrintModel] = useState<SeatingPrintModel | null>(null);
  const [selectedTableId, setSelectedTableId] = useState<string | null>(null);
  const [isSeatingDone, setIsSeatingDone] = useState(false);
  const [tables, setTables] = useState<SeatingTable[]>([]);
  const [templates, setTemplates] = useState<SeatingTemplate[]>([]);
  const currentGuestPoolSlotKey = guestPoolSlotKey(
    slot
      ? {
          capacityUnitId: slot.bucket.capacityUnitId,
          eventId: slot.event.eventId,
          occurrenceId: slot.occurrence?.id ?? null,
        }
      : null,
  );

  useEffect(() => {
    if (!slot) {
      setActiveTemplateValue(DEFAULT_SEATING_TEMPLATE_VALUE);
      setAssignments([]);
      setCapacityLimitOverride(undefined);
      setCapacitySyncError(null);
      setConnections([]);
      setDragSource(null);
      setPendingGuestKey(null);
      setLayoutLoadError(null);
      setCanvasCancelVersion((version) => version + 1);
      setIsCapacitySyncDialogOpen(false);
      setIsCapacitySyncing(false);
      setIsAutoAssigning(false);
      setIsReserveDialogOpen(false);
      setIsSeatingDone(false);
      setPrintModel(null);
      setSelectedTableId(null);
      setTables([]);
      setHasUnsavedChanges(false);
      setSeatEditEnabled(false);
      return undefined;
    }

    let cancelled = false;

    setFeedback({ message: "Загружаем схему...", tone: "muted" });
    setCapacityLimitOverride(undefined);
    setCapacitySyncError(null);
    setLayoutLoadError(null);
    setCanvasCancelVersion((version) => version + 1);
    setPendingGuestKey(null);
    setIsReserveDialogOpen(false);
    setIsCapacitySyncDialogOpen(false);
    setIsCapacitySyncing(false);
    setActiveTemplateValue(DEFAULT_SEATING_TEMPLATE_VALUE);
    setIsLoading(true);
    setIsApplyingTemplate(false);
    setIsAutoAssigning(false);
    setIsDeletingTemplate(false);
    setIsSaving(false);
    setIsSavingTemplate(false);
    setHasUnsavedChanges(false);
    setSeatEditEnabled(false);

    getSeatingLayout({
      capacityUnitId: slot.bucket.capacityUnitId,
      eventId: slot.event.eventId,
      occurrenceId: slot.occurrence?.id ?? null,
    })
      .then((layout) => {
        if (cancelled) {
          return;
        }

        const nextTables = normalizeEditorTables(
          layout?.tables && layout.tables.length > 0
            ? layout.tables
            : [createEditorTable({ isRabbiTable: true })],
        );
        const nextConnections = filterConnectionsForTables(
          layout?.connections ?? [],
          nextTables,
        );

        setTables(nextTables);
        setConnections(nextConnections);
        setLayoutLoadError(null);
        setAssignments(layout?.assignments ?? []);
        setPendingGuestKey(null);
        setIsSeatingDone(Boolean(layout?.seatingDone));
        setActiveTemplateValue(
          layout?.templateId
            ? userSeatingTemplateValue(layout.templateId)
            : DEFAULT_SEATING_TEMPLATE_VALUE,
        );
        setSelectedTableId(layout?.seatingDone ? null : pickSelectedTableId(nextTables));
        setHasUnsavedChanges(false);
        setFeedback(
          layout
            ? null
            : { message: "Пустой конструктор готов к редактированию.", tone: "muted" },
        );
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }

        const fallbackTables = normalizeEditorTables([
          createEditorTable({ isRabbiTable: true }),
        ]);
        setTables(fallbackTables);
        setConnections([]);
        setAssignments([]);
        setPendingGuestKey(null);
        setIsSeatingDone(false);
        setActiveTemplateValue(DEFAULT_SEATING_TEMPLATE_VALUE);
        setSelectedTableId(pickSelectedTableId(fallbackTables));
        const layoutErrorMessage =
          error instanceof Error
            ? error.message
            : "Не удалось загрузить схему рассадки.";
        setLayoutLoadError(layoutErrorMessage);
        setFeedback({ message: layoutErrorMessage, tone: "error" });
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [slot]);

  useEffect(() => {
    if (!slot) {
      setGuestPool([]);
      setGuestPoolError(null);
      setLoadedGuestPoolSlotKey(null);
      return undefined;
    }

    let cancelled = false;

    setGuestPool([]);
    setGuestPoolError(null);

    getAdminRegistrationCapacityGuestPool({
      capacityUnitId: slot.bucket.capacityUnitId,
      eventId: slot.event.eventId,
      occurrenceId: slot.occurrence?.id ?? null,
    })
      .then((nextGuestPool) => {
        if (!cancelled) {
          setGuestPool(nextGuestPool);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setGuestPool([]);
          setGuestPoolError(
            error instanceof Error
              ? error.message
              : "Не удалось загрузить гостей для рассадки.",
          );
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoadedGuestPoolSlotKey(currentGuestPoolSlotKey);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [currentGuestPoolSlotKey, slot]);

  const refreshTemplates = useCallback(() => {
    if (!slot) {
      setTemplates([]);
      setHasLoadedTemplates(false);
      return Promise.resolve();
    }

    setIsTemplateListLoading(true);

    return listSeatingTemplates()
      .then((nextTemplates) => {
        setTemplates(nextTemplates);
        setHasLoadedTemplates(true);
      })
      .catch((error) => {
        setTemplates([]);
        setHasLoadedTemplates(false);
        setFeedback({
          message:
            error instanceof Error
              ? error.message
              : "Не удалось загрузить сохранённые шаблоны.",
          tone: "error",
        });
      })
      .finally(() => {
        setIsTemplateListLoading(false);
      });
  }, [slot]);

  useEffect(() => {
    let cancelled = false;

    if (!slot) {
      setIsTemplateListLoading(false);
      setTemplates([]);
      setHasLoadedTemplates(false);
      return undefined;
    }

    setIsTemplateListLoading(true);

    listSeatingTemplates()
      .then((nextTemplates) => {
        if (!cancelled) {
          setTemplates(nextTemplates);
          setHasLoadedTemplates(true);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setTemplates([]);
          setHasLoadedTemplates(false);
          setFeedback({
            message:
              error instanceof Error
                ? error.message
                : "Не удалось загрузить сохранённые шаблоны.",
            tone: "error",
          });
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsTemplateListLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [slot]);

  useEffect(() => {
    if (!printModel || typeof window === "undefined" || typeof document === "undefined") {
      return undefined;
    }

    const body = document.body;
    let frameId: number | null = null;

    const handleAfterPrint = () => {
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId);
        frameId = null;
      }
      window.removeEventListener("afterprint", handleAfterPrint);
      body.classList.remove("seat-print-mode");
      setPrintModel(null);
    };

    body.classList.add("seat-print-mode");
    window.addEventListener("afterprint", handleAfterPrint);
    frameId = window.requestAnimationFrame(() => {
      frameId = null;
      if (typeof window.print === "function") {
        window.print();
        return;
      }

      setFeedback({
        message: "Печать недоступна в этом браузере.",
        tone: "error",
      });
      handleAfterPrint();
    });

    return () => {
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId);
      }
      window.removeEventListener("afterprint", handleAfterPrint);
      body.classList.remove("seat-print-mode");
    };
  }, [printModel]);

  const selectedTable = useMemo(
    () => tables.find((table) => table.id === selectedTableId) ?? null,
    [selectedTableId, tables],
  );

  const geometry = useMemo(
    () => computeTableSeats({ connections, tables }),
    [connections, tables],
  );
  const assignmentRestoreState = useMemo(
    () =>
      deriveSeatingAssignmentRestoreState({
        assignments,
        geometry,
        guestPool,
      }),
    [assignments, geometry, guestPool],
  );
  const seatOccupants = useMemo(
    () => assignmentRestoreState.occupants,
    [assignmentRestoreState.occupants],
  );
  const seatedGuestCount = useMemo(
    () => seatOccupants.filter((occupant) => occupant.type === "guest").length,
    [seatOccupants],
  );
  const currentAssignments = useMemo(
    () => assignmentRestoreState.currentAssignments,
    [assignmentRestoreState.currentAssignments],
  );
  const unassignedGuestPool = useMemo(
    () => assignmentRestoreState.unassignedGuests,
    [assignmentRestoreState.unassignedGuests],
  );
  const placementByGuestKey = useMemo(() => {
    const placement = new Map<string, string>();
    const unused = new Set(guestPool.map((guest) => guest.key));
    currentAssignments.forEach((assignment) => {
      if (assignment.type !== "guest" || !assignment.seatKey) return;
      const seatIndex = seatIndexFromSeatKey(assignment.seatKey, geometry); const seat = seatIndex === null ? null : geometry.seats[seatIndex];
      if (!seat || seat.isDisabled) return;
      const tableIndex = tables.findIndex((table) => table.id === seat.tableId); if (tableIndex < 0) return;
      const signature = seatingGuestSignature(assignment.registrationId, assignment.guestLabel, assignment.guestInitials);
      const match = guestPool.find((guest) => unused.has(guest.key) && seatingGuestSignature(guest.registrationId, guest.displayName, guest.initials) === signature) ?? (!assignment.guestLabel && !assignment.guestInitials ? guestPool.find((guest) => unused.has(guest.key) && guest.registrationId === assignment.registrationId) : undefined);
      if (match) { unused.delete(match.key); placement.set(match.key, `Стол ${tableIndex + 1}`); }
    });
    return placement;
  }, [currentAssignments, geometry, guestPool, tables]);
  const visibleGuestPool = unassignedGuestPool;
  const hasBucketOccupancy = Boolean(
    slot &&
      ((slot.bucket.occupiedSeats ?? 0) > 0 ||
        (slot.bucket.reservationsCount ?? 0) > 0),
  );
  const isGuestPoolLoading = isGuestPoolPending({
    loadedSlotKey: loadedGuestPoolSlotKey,
    slotKey: currentGuestPoolSlotKey,
  });
  const hasGuestPoolMismatch = getGuestPoolMismatch({
    error: guestPoolError,
    guestPoolLength: guestPool.length,
    hasBucketOccupancy,
    loadedSlotKey: loadedGuestPoolSlotKey,
    slotKey: currentGuestPoolSlotKey,
  });
  const invalidSeatKeyWarning =
    !hasUnsavedChanges && assignmentRestoreState.invalidAssignments.length > 0
      ? "Часть сохранённых мест больше не существует в текущей схеме."
      : null;
  const guestPoolWarning =
    invalidSeatKeyWarning ??
    (hasGuestPoolMismatch
      ? "В слоте есть занятость, но guest pool пуст. Проверьте confirmed/active registrations, " +
        "выбранный event/occurrence и bucket; donation-only registrations не занимают места."
      : null);

  const capacityLimit =
    capacityLimitOverride !== undefined
      ? capacityLimitOverride
      : slot?.bucket.capacity ?? null;
  const canPerformAdminActions = auth.canAccessAdmin && (auth.isAdmin || auth.isEventManager);
  const rabbiReserveCount = useMemo(
    () => geometry.seats.filter((seat) => seat.isRabbiTable && !seat.isDisabled).length,
    [geometry.seats],
  );
  const slotTitle = slot ? formatSlotTitle(slot) : "Схема рассадки";
  const slotSubtitle = slot ? formatSlotSubtitle(slot) : null;
  const hasValidGeometry = tables.length > 0 && countRabbiTables(tables) === 1;
  const isTemplateBusy =
    isApplyingTemplate ||
    isDeletingTemplate ||
    isSavingTemplate;
  const nonErrorFeedback: { message: string; tone: "muted" | "success" } | null =
    feedback?.tone === "muted"
      ? { message: feedback.message, tone: "muted" }
      : feedback?.tone === "success"
        ? { message: feedback.message, tone: "success" }
        : null;
  const toolbarStatus: { message: string; tone: "dirty" | "muted" | "success" } | null =
    isSaving || isAutoAssigning || isTemplateBusy
      ? nonErrorFeedback?.tone === "muted"
        ? nonErrorFeedback
        : null
      : hasUnsavedChanges
        ? { message: "Есть несохранённые изменения", tone: "dirty" }
        : nonErrorFeedback;
  const layoutBusyReason = getLayoutBusyReason({
    isApplyingTemplate,
    isAutoAssigning,
    isCapacitySyncing,
    isDeletingTemplate,
    isGuestPoolLoading,
    isLoading,
    isSaving,
    isSavingTemplate,
  });
  const isLayoutActionBusy = Boolean(layoutBusyReason);
  const canEditLayout = Boolean(slot) && !isLayoutActionBusy;
  const canAddTable = canEditLayout;
  const canRotateSelectedTable = canEditLayout && Boolean(selectedTable);
  const canChangeSelectedTableSideSeats = canEditLayout && Boolean(selectedTable);
  const canSetAllSideSeats = canEditLayout && tables.length > 0;
  const canRemoveSelectedTable =
    canEditLayout && Boolean(selectedTable) && tables.length > 1;
  const addTableDisabledReason = layoutBusyReason;
  const rotateTableDisabledReason =
    layoutBusyReason ?? (selectedTable ? null : "Выберите стол для поворота.");
  const sideSeatsDisabledReason =
    layoutBusyReason ?? (selectedTable ? null : "Выберите стол для изменения мест.");
  const allSideSeatsDisabledReason =
    layoutBusyReason ?? (tables.length > 0 ? null : "Сначала добавьте стол.");
  const removeTableDisabledReason =
    layoutBusyReason ??
    (selectedTable
      ? tables.length <= 1
        ? "Нельзя удалить последний обязательный стол."
        : null
      : "Выберите стол для удаления.");
  const saveDisabled =
    !slot || !hasValidGeometry || isLayoutActionBusy;
  const autoAssignDisabled =
    !slot ||
    !hasValidGeometry ||
    isLoading ||
    isGuestPoolLoading ||
    isSaving ||
    isAutoAssigning ||
    isCapacitySyncing ||
    isTemplateBusy ||
    hasGuestPoolMismatch ||
    guestPool.length === 0 ||
    geometry.physicalSeatCount === 0;
  const autoAssignDisabledReason = autoAssignDisabled
    ? getAutoAssignDisabledReason({
        guestPoolLength: guestPool.length,
        hasGuestPoolMismatch,
        hasValidGeometry,
        isLayoutActionBusy,
        layoutBusyReason,
        physicalSeatCount: geometry.physicalSeatCount,
      })
    : null;
  const manualSeatingEnabled = hasValidGeometry && !isLayoutActionBusy;
  useEffect(() => { if (pendingGuestKey && (!manualSeatingEnabled || !unassignedGuestPool.some((guest) => guest.key === pendingGuestKey))) setPendingGuestKey(null); }, [manualSeatingEnabled, pendingGuestKey, unassignedGuestPool]);
  const canShowCapacitySyncAction = Boolean(
    slot?.bucket.capacityUnitId &&
      canPerformAdminActions &&
      !isLoading &&
      hasValidGeometry &&
      geometry.physicalSeatCount > 0 &&
      capacityLimit !== geometry.physicalSeatCount,
  );
  const canPrintSeating = Boolean(
    slot &&
      isSeatingDone &&
      hasValidGeometry &&
      !isLayoutActionBusy &&
      !layoutLoadError &&
      geometry.physicalSeatCount > 0,
  );
  const printDisabledReason = canPrintSeating
    ? null
    : getPrintDisabledReason({
        hasValidGeometry,
        isLayoutActionBusy,
        isSeatingDone,
        layoutBusyReason,
        layoutLoadError,
        physicalSeatCount: geometry.physicalSeatCount,
      });
  // PR 16: unseated reserves live in the assignments array as pooled
  // (`seatKey === null`) `type: "reserve"` entries; placed reserves are occupants.
  const allPooledReserves = useMemo(
    () => derivePooledReserves(currentAssignments),
    [currentAssignments],
  );
  const pooledReserves = useMemo(
    () => allPooledReserves,
    [allPooledReserves],
  );
  const placedReserveCount = useMemo(
    () =>
      assignmentRestoreState.occupants.filter((occupant) => occupant.type === "reserve")
        .length,
    [assignmentRestoreState.occupants],
  );
  const allTablesSideSeats = useMemo<2 | 3 | null>(() => {
    if (tables.length === 0) return null;
    const sideSeats = tableSideSeats(tables[0]);
    return tables.every((table) => tableSideSeats(table) === sideSeats)
      ? (sideSeats as 2 | 3)
      : null;
  }, [tables]);
  const metricsSummary = useMemo(
    () => computeSeatingMetricsDisplaySummary({
      capacityLimit,
      physicalOccupiedSeats: seatOccupants.length,
      physicalSeatCount: geometry.physicalSeatCount,
      registrationOccupiedSeats: slot?.bucket.occupiedSeats ?? 0,
      reserveSeats: placedReserveCount,
      seatedGuestCount,
    }),
    [capacityLimit, geometry.physicalSeatCount, placedReserveCount, seatOccupants.length, seatedGuestCount, slot?.bucket.occupiedSeats],
  );

  useEffect(() => {
    if (!slot || !hasGuestPoolMismatch) {
      return;
    }

    console.warn("Seating guest pool empty despite bucket occupancy", {
      capacityUnitId: slot.bucket.capacityUnitId,
      eventId: slot.event.eventId,
      occurrenceId: slot.occurrence?.id ?? null,
      occupiedSeats: slot.bucket.occupiedSeats,
      reservationsCount: slot.bucket.reservationsCount,
    });
  }, [hasGuestPoolMismatch, slot]);

  const handlePrintSeating = useCallback(() => {
    if (!slot || !canPrintSeating) {
      return;
    }

    setPrintModel(
      buildSeatingPrintModel({
        capacityBucketTitle: formatSlotTitle(slot),
        eventTitle: slot.event.title,
        geometry,
        occupants: seatOccupants,
        occurrenceSubtitle: formatPrintSlotSubtitle(slot),
        printedAt: new Date(),
        tables,
        unseatedGuests: unassignedGuestPool,
        unseatedReserves: allPooledReserves,
      }),
    );
  }, [
    allPooledReserves,
    canPrintSeating,
    geometry,
    seatOccupants,
    slot,
    tables,
    unassignedGuestPool,
  ]);

  const handleOpenCapacitySyncDialog = useCallback(() => {
    setCapacitySyncError(null);
    setIsCapacitySyncDialogOpen(true);
  }, []);

  const handleCancelCapacitySyncDialog = useCallback(() => {
    if (isCapacitySyncing) {
      return;
    }

    setCapacitySyncError(null);
    setIsCapacitySyncDialogOpen(false);
  }, [isCapacitySyncing]);

  const handleConfirmCapacitySync = useCallback(() => {
    if (!slot || isCapacitySyncing) {
      return;
    }

    const nextCapacity = Math.max(0, Math.round(geometry.physicalSeatCount));
    const occupiedSeats = Math.max(0, Math.round(slot.bucket.occupiedSeats ?? 0));

    if (nextCapacity <= 0 || nextCapacity === capacityLimit) {
      return;
    }

    if (nextCapacity < occupiedSeats) {
      setCapacitySyncError(
        `Нельзя понизить лимит до ${formatCount(nextCapacity)}: уже занято ${formatCount(
          occupiedSeats,
        )} мест. Сначала разберите регистрации или добавьте физические места.`,
      );
      return;
    }

    setIsCapacitySyncing(true);
    setCapacitySyncError(null);
    setFeedback({ message: "Обновляем лимит регистрации...", tone: "muted" });

    void updateCapacityUnitLimit(
      slot.event.eventId,
      slot.bucket.capacityUnitId,
      nextCapacity,
    )
      .then((updatedUnit) => {
        setCapacityLimitOverride(updatedUnit.capacity);
        setIsCapacitySyncDialogOpen(false);
        setFeedback({
          message: `Лимит регистрации обновлён до ${formatCount(updatedUnit.capacity ?? nextCapacity)}.`,
          tone: "success",
        });
        onCapacityLimitUpdated?.(updatedUnit.id, updatedUnit.capacity);
      })
      .catch((error) => {
        const message = formatCapacitySyncError(error);
        setCapacitySyncError(message);
        setFeedback({ message, tone: "error" });
      })
      .finally(() => {
        setIsCapacitySyncing(false);
      });
  }, [
    capacityLimit,
    geometry.physicalSeatCount,
    isCapacitySyncing,
    onCapacityLimitUpdated,
    slot,
  ]);

  const reconcileGeometryChange = useCallback((nextTables: SeatingTable[], nextConnections: SeatingConnection[]) => {
    const result = reconcileAfterGeometryChange({
      assignments,
      geometry: computeTableSeats({ connections: nextConnections, tables: nextTables }),
      guestPool,
    });
    setAssignments(result.assignments);
    if (result.returnedCount > 0) {
      setFeedback({
        message: `Вернулись в список: ${result.returnedCount} — их места исчезли после изменения столов.`,
        tone: "muted",
      });
    }
    return result;
  }, [assignments, guestPool]);

  const handleAddTable = useCallback(() => {
    if (!canAddTable) {
      return;
    }

    const currentTables =
      tables.length > 0
        ? tables
        : normalizeEditorTables([createEditorTable({ isRabbiTable: true })]);
    const base =
      currentTables.find((table) => table.id === selectedTableId) ??
      currentTables[currentTables.length - 1];
    const nextTable = createEditorTable({
      angle: base.angle,
      cx: base.cx + TABLE_ADD_DX,
      cy: base.cy + TABLE_ADD_DY,
      sideSeats: tableSideSeats(base),
    });
    const nextTables = ensureOneRabbiTable([...currentTables, nextTable]);
    const nextConnections = connections;

    setTables(nextTables);
    reconcileGeometryChange(nextTables, nextConnections);
    setSelectedTableId(nextTable.id);
    setHasUnsavedChanges(true);
  }, [canAddTable, connections, reconcileGeometryChange, selectedTableId, tables]);

  const handleMoveTable = useCallback(
    (tableId: string, center: { cx: number; cy: number }) => {
      if (!canEditLayout) {
        return;
      }
      const currentTable = tables.find((table) => table.id === tableId);
      if (!currentTable || (currentTable.cx === center.cx && currentTable.cy === center.cy)) {
        return;
      }

      const nextTables = ensureOneRabbiTable(tables.map((table) =>
        table.id === tableId
          ? clampTableToCanvasStart({ ...table, cx: center.cx, cy: center.cy })
          : table,
      ));
      const nextConnections = connections.filter((connection) => !connectionTouchesTable(connection, tableId));
      setTables(nextTables);
      setConnections(nextConnections);
      setHasUnsavedChanges(true);
    },
    [canEditLayout, connections, tables],
  );

  const handleMoveTableEnd = useCallback((tableId: string, center: { cx: number; cy: number }) => {
    if (!canEditLayout || !tables.some((table) => table.id === tableId)) return;
    const nextTables = ensureOneRabbiTable(tables.map((table) =>
      table.id === tableId
        ? clampTableToCanvasStart({ ...table, cx: center.cx, cy: center.cy })
        : table,
    ));
    const nextConnections = connections.filter((connection) => !connectionTouchesTable(connection, tableId));
    setTables(nextTables);
    setConnections(nextConnections);
    reconcileGeometryChange(nextTables, nextConnections);
  }, [canEditLayout, connections, reconcileGeometryChange, tables]);

  const handleRemoveTable = useCallback(() => {
    if (!canRemoveSelectedTable || !selectedTableId) {
      return;
    }

    const nextTables = ensureOneRabbiTable(
      tables.filter((table) => table.id !== selectedTableId),
    );
    const nextConnections = connections.filter(
      (connection) => !connectionTouchesTable(connection, selectedTableId),
    );

    setTables(nextTables);
    setConnections(nextConnections);
    reconcileGeometryChange(nextTables, nextConnections);
    setSelectedTableId(pickSelectedTableId(nextTables));
    setHasUnsavedChanges(true);
  }, [canRemoveSelectedTable, connections, reconcileGeometryChange, selectedTableId, tables]);

  const handleRotateTable = useCallback(() => {
    if (!canRotateSelectedTable || !selectedTableId) {
      return;
    }

    const nextTables = ensureOneRabbiTable(tables.map((table) =>
      table.id === selectedTableId
        ? clampTableToCanvasStart({ ...table, angle: normalizeAngle((table.angle || 0) + 90) })
        : table,
    ));
    const nextConnections = connections.filter(
      (connection) => !connectionTouchesTable(connection, selectedTableId),
    );
    setTables(nextTables);
    setConnections(nextConnections);
    reconcileGeometryChange(nextTables, nextConnections);
    setHasUnsavedChanges(true);
  }, [canRotateSelectedTable, connections, reconcileGeometryChange, selectedTableId, tables]);

  const handleSetSelectedSideSeats = useCallback((sideSeats: 2 | 3) => {
    if (!canChangeSelectedTableSideSeats || !selectedTableId) {
      return;
    }
    if (tableSideSeats(selectedTable!) === sideSeats) return;

    const nextTables = ensureOneRabbiTable(tables.map((table) =>
      table.id === selectedTableId ? { ...table, sideSeats } : table,
    ));
    setTables(nextTables);
    reconcileGeometryChange(nextTables, connections);
    setHasUnsavedChanges(true);
  }, [canChangeSelectedTableSideSeats, connections, reconcileGeometryChange, selectedTable, selectedTableId, tables]);

  const handleSetAllSideSeats = useCallback((sideSeats: 2 | 3) => {
    if (!canSetAllSideSeats) {
      return;
    }
    if (allTablesSideSeats === sideSeats) return;

    const nextTables = ensureOneRabbiTable(tables.map((table) => ({ ...table, sideSeats })));
    setTables(nextTables);
    reconcileGeometryChange(nextTables, connections);
    setHasUnsavedChanges(true);
  }, [allTablesSideSeats, canSetAllSideSeats, connections, reconcileGeometryChange, tables]);

  const saveLayoutGeometry = useCallback(
    async ({
      nextConnections,
      nextSeatingDone = false,
      nextSelectedTableId,
      nextTables,
      templateValue,
    }: {
      nextConnections: SeatingConnection[];
      nextSeatingDone?: boolean;
      nextSelectedTableId: string | null;
      nextTables: SeatingTable[];
      templateValue: SeatingTemplateValue;
    }): Promise<SeatingLayoutRow> => {
      if (!slot) {
        throw new Error("Не выбран слот для схемы рассадки.");
      }

      return saveSeatingLayout({
        activeTemplateId: templateIdForSavePayload(
          templateValue,
          templates,
          hasLoadedTemplates && !isTemplateListLoading,
        ),
        capacity: capacityLimit ?? 0,
        capacityUnitId: slot.bucket.capacityUnitId,
        chairs: [],
        customTables: nextTables,
        eventId: slot.event.eventId,
        layout: "islands",
        occurrenceId: slot.occurrence?.id ?? null,
        pool: [],
        reserveIds: [],
        seatingDone: nextSeatingDone,
        selectedTableId: nextSeatingDone ? null : nextSelectedTableId,
        tableConnections: nextConnections,
      });
    },
    [capacityLimit, hasLoadedTemplates, isTemplateListLoading, slot, templates],
  );

  const commitGeometry = useCallback(
    ({
      nextConnections,
      nextSelectedTableId,
      nextTables,
      templateValue,
    }: {
      nextConnections: SeatingConnection[];
      nextSelectedTableId: string | null;
      nextTables: SeatingTable[];
      templateValue: SeatingTemplateValue;
    }) => {
      setTables(nextTables);
      setConnections(nextConnections);
      setSelectedTableId(nextSelectedTableId);
      setActiveTemplateValue(templateValue);
    },
    [],
  );

  const handleTemplateChange = useCallback(
    (value: SeatingTemplateValue) => {
      if (!slot || value === activeTemplateValue || isLayoutActionBusy) {
        return;
      }

      const clearsSeating = isSeatingDone || currentAssignments.some((assignment) => Boolean(assignment.seatKey));
      if (clearsSeating && !window.confirm("Применить расстановку? Текущая рассадка будет сброшена, все гости вернутся в список.")) {
        return;
      }

      let rawGeometry: TemplateGeometry | null = null;

      if (isBuiltInSeatingTemplateId(value)) {
        rawGeometry = createBuiltInTemplateGeometry(
          value,
          capacityLimit ?? geometry.physicalSeatCount,
        );
      } else {
        const templateId = parseUserSeatingTemplateValue(value);
        const template = templates.find((item) => item.id === templateId) ?? null;

        if (!template) {
          setFeedback({ message: "Шаблон не найден.", tone: "error" });
          return;
        }

        rawGeometry = cloneTemplateGeometry(template);
      }

      const nextTables = normalizeEditorTables(rawGeometry.tables);
      const nextConnections = filterConnectionsForTables(
        rawGeometry.connections,
        nextTables,
      );
      const nextSelectedTableId = pickSelectedTableId(nextTables);
      const clearedAssignments = currentAssignments.map((assignment) => ({
        ...assignment,
        locked: false,
        placementSource: undefined,
        seatKey: null,
      }));
      const clearedAssignmentPayload = assignmentsToPayloadEntries(clearedAssignments);

      setIsApplyingTemplate(true);
      setFeedback({ message: "Применяем шаблон...", tone: "muted" });

      void saveLayoutGeometry({
        nextConnections,
        nextSeatingDone: clearsSeating ? false : isSeatingDone,
        nextSelectedTableId,
        nextTables,
        templateValue: value,
      })
        .then(() => clearsSeating ? saveSeatingAssignments({
          capacityUnitId: slot.bucket.capacityUnitId,
          chairs: clearedAssignmentPayload.chairs,
          eventId: slot.event.eventId,
          occurrenceId: slot.occurrence?.id ?? null,
          pool: clearedAssignmentPayload.pool,
          reserveIds: [],
        }).then((saveResult) => {
          assertAssignmentSaveResultMatchesPayload(saveResult, clearedAssignmentPayload);
        }) : null)
        .then(() => {
          commitGeometry({
            nextConnections,
            nextSelectedTableId,
            nextTables,
            templateValue: value,
          });
          if (clearsSeating) {
            setAssignments(clearedAssignments);
            setIsSeatingDone(false);
          }
          setFeedback({ message: "Шаблон применён.", tone: "success" });
          setHasUnsavedChanges(true);
        })
        .catch((error) => {
          setFeedback({
            message:
              error instanceof Error
                ? error.message
                : "Не удалось применить шаблон.",
            tone: "error",
          });
        })
        .finally(() => {
          setIsApplyingTemplate(false);
        });
    },
    [
      activeTemplateValue,
      capacityLimit,
      commitGeometry,
      geometry.physicalSeatCount,
      isLayoutActionBusy,
      currentAssignments,
      isSeatingDone,
      saveLayoutGeometry,
      slot,
      templates,
    ],
  );

  const handleSaveTemplate = useCallback(() => {
    if (!slot || !hasValidGeometry || isLayoutActionBusy) {
      return;
    }

    const title = window.prompt("Название шаблона", "")?.trim();

    if (!title) {
      return;
    }

    const nextTables = normalizeEditorTables(tables);
    const nextConnections = filterConnectionsForTables(connections, nextTables);
    const nextSelectedTableId = selectedTableId ?? pickSelectedTableId(nextTables);

    setIsSavingTemplate(true);
    setFeedback({ message: "Сохраняем шаблон...", tone: "muted" });

    void saveLayoutGeometry({
      nextConnections,
      nextSeatingDone: isSeatingDone,
      nextSelectedTableId,
      nextTables,
      templateValue: activeTemplateValue,
    })
      .then((nextLayout) => {
        commitGeometry({
          nextConnections,
          nextSelectedTableId: isSeatingDone ? null : nextSelectedTableId,
          nextTables,
          templateValue: activeTemplateValue,
        });

        return createSeatingTemplateFromLayout(nextLayout.id, title);
      })
      .then((template) => {
        const nextTemplateValue = userSeatingTemplateValue(template.id);
        setTemplates((currentTemplates) => upsertTemplate(currentTemplates, template));
        setActiveTemplateValue(nextTemplateValue);
        setFeedback({ message: "Шаблон сохранён.", tone: "success" });
        void refreshTemplates();
      })
      .catch((error) => {
        setFeedback({
          message:
            error instanceof Error
              ? error.message
              : "Не удалось сохранить шаблон.",
          tone: "error",
        });
      })
      .finally(() => {
        setIsSavingTemplate(false);
      });
  }, [
    activeTemplateValue,
    commitGeometry,
    connections,
    hasValidGeometry,
    isLayoutActionBusy,
    isSeatingDone,
    refreshTemplates,
    saveLayoutGeometry,
    selectedTableId,
    slot,
    tables,
  ]);

  const handleDeleteTemplate = useCallback(
    (template: SeatingTemplate) => {
      if (template.isBuiltin) {
        return;
      }

      const confirmed = window.confirm(
        `Удалить шаблон «${template.title || "Без названия"}»?`,
      );

      if (!confirmed) {
        return;
      }

      setIsDeletingTemplate(true);
      setFeedback({ message: "Удаляем шаблон...", tone: "muted" });

      void deleteSeatingTemplate(template.id)
        .then(() => {
          setTemplates((currentTemplates) =>
            currentTemplates.filter((item) => item.id !== template.id),
          );
          if (activeTemplateValue === userSeatingTemplateValue(template.id)) {
            setActiveTemplateValue(DEFAULT_SEATING_TEMPLATE_VALUE);
          }
          setFeedback({ message: "Шаблон удалён.", tone: "success" });
          void refreshTemplates();
        })
        .catch((error) => {
          setFeedback({
            message:
              error instanceof Error
                ? error.message
                : "Не удалось удалить шаблон.",
            tone: "error",
          });
        })
        .finally(() => {
          setIsDeletingTemplate(false);
        });
    },
    [activeTemplateValue, refreshTemplates],
  );

  const handleSave = useCallback(() => {
    if (saveDisabled) {
      return;
    }

    const nextTables = normalizeEditorTables(tables);
    const nextConnections = filterConnectionsForTables(connections, nextTables);
    const nextSelectedTableId = isSeatingDone
      ? null
      : selectedTableId ?? pickSelectedTableId(nextTables);
    const shouldSaveAssignments = isSeatingDone || currentAssignments.length > 0;
    const assignmentPayloadEntries = shouldSaveAssignments
      ? assignmentsToPayloadEntries(currentAssignments)
      : null;
    const savedTemplateValue = templateValueAfterSave(
      activeTemplateValue,
      templates,
      hasLoadedTemplates && !isTemplateListLoading,
    );

    setIsSaving(true);
    setFeedback({ message: "Сохраняем схему...", tone: "muted" });

    void saveLayoutGeometry({
      nextConnections,
      nextSeatingDone: isSeatingDone,
      nextSelectedTableId,
      nextTables,
      templateValue: savedTemplateValue,
    })
      .then(() => {
        if (!assignmentPayloadEntries) {
          return null;
        }

        // PR 14 persistence: layout save keeps geometry only; assignments are
        // replaced by the dedicated RPC and must succeed before showing success.
        return saveSeatingAssignments({
          capacityUnitId: slot.bucket.capacityUnitId,
          chairs: assignmentPayloadEntries.chairs,
          eventId: slot.event.eventId,
          occurrenceId: slot.occurrence?.id ?? null,
          pool: assignmentPayloadEntries.pool,
          reserveIds: [],
        }).then((saveResult) => {
          assertAssignmentSaveResultMatchesPayload(
            saveResult,
            assignmentPayloadEntries,
          );
          return saveResult;
        });
      })
      .then(() => {
        commitGeometry({
          nextConnections,
          nextSelectedTableId,
          nextTables,
          templateValue: savedTemplateValue,
        });
        setFeedback({
          message: shouldSaveAssignments
            ? "Схема и рассадка сохранены."
            : "Схема сохранена.",
          tone: "success",
        });
        setHasUnsavedChanges(false);
      })
      .catch((error) => {
        setFeedback({
          message: formatLayoutSaveError(error, isSeatingDone),
          tone: "error",
        });
      })
      .finally(() => {
        setIsSaving(false);
      });
  }, [
    activeTemplateValue,
    commitGeometry,
    connections,
    currentAssignments,
    hasLoadedTemplates,
     isSeatingDone,
    isTemplateListLoading,
    saveLayoutGeometry,
    saveDisabled,
    selectedTableId,
    slot,
    tables,
    templates,
  ]);

  // PR 17: shared seating commit. Recomputes the physical seats for the current
  // (possibly just-edited) geometry, reconciles the preserved assignments against
  // them, optionally auto-fills the remaining free seats, then saves the layout +
  // reconciled assignments through the existing RPC. `autoFill === false` is the
  // "вернуться к рассадке" exit path: it only restores valid placements and leaves
  // freed occupants in "Не рассажены"; `autoFill === true` additionally re-seats the
  // still-unassigned/unlocked registration guests ("Сделать рассадку").
  const performSeating = useCallback(
    (autoFill: boolean) => {
      if (!slot || !hasValidGeometry) {
        return;
      }

      const nextTables = normalizeEditorTables(tables);
      const nextConnections = filterConnectionsForTables(connections, nextTables);
      const autoGeometry = computeTableSeats({
        connections: nextConnections,
        tables: nextTables,
      });

      // Reconcile the current assignments with the (possibly changed) geometry:
      // keep valid placements (manual/locked + reserves win conflicts), return
      // missing/blocked/duplicate occupants to the pool.
      const reconcile = reconcileSeatingAssignments({
        assignments: currentAssignments,
        geometry: autoGeometry,
        guestPool,
      });
      // Kept placements (guests + reserves) block their seats for any re-seating and
      // exclude their guests from the auto queue. Unseated reserves are carried so
      // auto never drops them; ordinary guests freed by reconcile stay in the pool
      // and are picked up by auto from `guestPool`.
      const keptAssignments = reconcile.keptAssignments;
      const pooledReserves = reconcile.assignments.filter(
        (assignment) => !assignment.seatKey && assignment.type === "reserve",
      );

      let mergedAssignments: SeatingAssignment[];
      let overflowCount = 0;
      let newlySeatedGuestCount = 0;

      if (autoFill) {
        const result = autoAssignSeating({
          capacityUnitId: slot.bucket.capacityUnitId,
          connections: nextConnections,
          geometry: autoGeometry,
          guestPool,
          lockedAssignments: keptAssignments,
          occurrenceId: slot.occurrence?.id ?? null,
          tables: nextTables,
        });

        if (result.warning?.code === "no_tables") {
          setFeedback({
            message: "Сначала добавьте столы в схему рассадки.",
            tone: "error",
          });
          return;
        }

        if (
          result.warning?.code === "empty_guest_pool" &&
          keptAssignments.length === 0 &&
          pooledReserves.length === 0
        ) {
          setFeedback({ message: "Нет гостей для авторассадки.", tone: "muted" });
          return;
        }

        mergedAssignments = [
          ...keptAssignments,
          ...pooledReserves,
          ...autoAssignResultToAssignments(result),
        ];
        overflowCount = result.remainingUnassignedGuests.length;
        newlySeatedGuestCount = result.assignedSeats.length;
      } else {
        // Restore-only exit: kept placements + returned/pooled occupants as-is.
        mergedAssignments = reconcile.assignments;
      }

      const payloadEntries = assignmentsToPayloadEntries(mergedAssignments);
      const nextSelectedTableId = null;
      const savedTemplateValue = templateValueAfterSave(
        activeTemplateValue,
        templates,
        hasLoadedTemplates && !isTemplateListLoading,
      );

      setIsAutoAssigning(true);
      setFeedback({ message: "Делаем рассадку...", tone: "muted" });

      void saveLayoutGeometry({
        nextConnections,
        nextSeatingDone: false,
        nextSelectedTableId: pickSelectedTableId(nextTables),
        nextTables,
        templateValue: savedTemplateValue,
      })
        .then(() =>
          saveSeatingAssignments({
            capacityUnitId: slot.bucket.capacityUnitId,
            chairs: payloadEntries.chairs,
            eventId: slot.event.eventId,
            occurrenceId: slot.occurrence?.id ?? null,
            pool: payloadEntries.pool,
            reserveIds: [],
          }),
        )
        .then((saveResult) => {
          assertAssignmentSaveResultMatchesPayload(saveResult, payloadEntries);
        })
        .then(() =>
          saveLayoutGeometry({
            nextConnections,
            nextSeatingDone: true,
            nextSelectedTableId,
            nextTables,
            templateValue: savedTemplateValue,
          }),
        )
        .then(() => {
          commitGeometry({
            nextConnections,
            nextSelectedTableId,
            nextTables,
            templateValue: savedTemplateValue,
          });
          setDragSource(null);
          setAssignments(mergedAssignments);
          setIsSeatingDone(true);
          setFeedback(
            autoFill &&
            newlySeatedGuestCount === 0 &&
            overflowCount === 0 &&
            pooledReserves.length > 0
              ? {
                  message:
                    "Свободных гостей нет. Резервы рассаживаются вручную — перетащите их на свободные места.",
                  tone: "muted",
                }
              : buildSeatingFeedback(reconcile.counts, overflowCount),
          );
          setHasUnsavedChanges(false);
        })
        .catch((error) => {
          console.error("Auto seating save failed", error);
          setFeedback({
            message: formatAutoAssignSaveError(error),
            tone: "error",
          });
        })
        .finally(() => {
          setIsAutoAssigning(false);
        });
    },
    [
      activeTemplateValue,
      commitGeometry,
      connections,
      currentAssignments,
      guestPool,
      hasLoadedTemplates,
      hasValidGeometry,
      isTemplateListLoading,
      saveLayoutGeometry,
      slot,
      tables,
      templates,
    ],
  );

  const handleAutoAssign = useCallback(() => {
    if (!slot || autoAssignDisabled) {
      return;
    }
    performSeating(true);
  }, [autoAssignDisabled, performSeating, slot]);

  const handleManualDragEnd = useCallback(() => {
    setDragSource(null);
  }, []);

  const handleSeatDragStart = useCallback((seatIndex: number) => {
    setPendingGuestKey(null);
    setDragSource({ kind: "seat", seatIndex });
  }, []);

  const handleGuestDragStart = useCallback((guestKey: string) => {
    setPendingGuestKey(null);
    setDragSource({ kind: "pool", guestKey });
  }, []);

  const handleSelectGuestForPlacement = useCallback((guestKey: string): boolean => {
    if (!manualSeatingEnabled) return false;
    const guest = guestPool.find((item) => item.key === guestKey);
    if (!guest) return false;
    const placement = placementByGuestKey.get(guestKey);
    if (placement) { setFeedback({ message: `${guest.displayName} уже за столом · ${placement}.`, tone: "muted" }); return false; }
    if (!unassignedGuestPool.some((item) => item.key === guestKey)) return false;
    setPendingGuestKey(guestKey); setFeedback({ message: "Выберите свободное место на схеме.", tone: "muted" }); return true;
  }, [guestPool, manualSeatingEnabled, placementByGuestKey, unassignedGuestPool]);

  const handlePendingGuestSeatClick = useCallback((seatIndex: number) => {
    if (!pendingGuestKey || !manualSeatingEnabled) return;
    const result = applySeatingDragDrop({ assignments: currentAssignments, geometry, guestPool, source: { kind: "pool", guestKey: pendingGuestKey }, target: { kind: "seat", seatIndex } });
    if (!result.changed) { const rejection = result.rejection ? manualDropRejectionFeedback(result.rejection) : null; if (rejection) setFeedback(rejection); return; }
    setAssignments(result.assignments); setPendingGuestKey(null); setIsSeatingDone(true); setHasUnsavedChanges(true); setFeedback({ message: "Изменения рассадки не сохранены. Нажмите «Сохранить схему рассадки».", tone: "muted" });
  }, [currentAssignments, geometry, guestPool, manualSeatingEnabled, pendingGuestKey]);

  const handleManualDrop = useCallback(
    (target: SeatingDropTargetRef) => {
      if (!dragSource || !manualSeatingEnabled) {
        setDragSource(null);
        return;
      }

      const result = applySeatingDragDrop({
        assignments: currentAssignments,
        geometry,
        guestPool,
        source: dragSource,
        target,
      });

      setDragSource(null);

      if (!result.changed) {
        const rejectionFeedback = result.rejection
          ? manualDropRejectionFeedback(result.rejection)
          : null;
        if (rejectionFeedback) {
          setFeedback(rejectionFeedback);
        }
        return;
      }

      setAssignments(result.assignments);
      setIsSeatingDone(true);
      setFeedback({
        message: "Изменения рассадки не сохранены. Нажмите «Сохранить схему рассадки».",
        tone: "muted",
      });
      setHasUnsavedChanges(true);
    },
    [currentAssignments, dragSource, geometry, guestPool, manualSeatingEnabled],
  );

  const handleSeatDrop = useCallback(
    (seatIndex: number) => {
      handleManualDrop({ kind: "seat", seatIndex });
    },
    [handleManualDrop],
  );

  const handlePoolDrop = useCallback(() => {
    handleManualDrop({ kind: "pool" });
  }, [handleManualDrop]);

  const handleToggleSeat = useCallback((seatIndex: number) => {
    if (isLayoutActionBusy) return;
    const seat = geometry.seats[seatIndex];
    if (!seat) return;
    const stablePart = seat.kind === "side" && seat.edge && typeof seat.slot === "number"
      ? `side:${seat.edge}:${seat.slot}`
      : seat.kind === "end" && seat.end ? `end:${seat.end}` : null;
    if (!stablePart) return;
    const table = tables.find((item) => item.id === seat.tableId);
    if (!table) return;
    const occupant = currentAssignments.find(
      (assignment) =>
        assignment.seatKey &&
        seatIndexFromSeatKey(assignment.seatKey, geometry) === seatIndex,
    ) ?? null;
    const wasDisabled = Boolean(table.disabledSeats?.includes(stablePart));

    const nextTables = tables.map((item) => item.id !== table.id ? item : {
      ...item,
      disabledSeats: wasDisabled
        ? (item.disabledSeats ?? []).filter((part) => part !== stablePart)
        : [...(item.disabledSeats ?? []), stablePart],
    });
    setTables(nextTables);
    const reconcile = reconcileGeometryChange(nextTables, connections);
    setHasUnsavedChanges(true);
    if (!wasDisabled && occupant && reconcile.returnedCount === 1) {
      setFeedback({ message: `«${occupant.guestLabel}» снят с выключенного места.`, tone: "muted" });
    } else if (wasDisabled || !occupant) {
      setFeedback(wasDisabled
        ? { message: "Место включено обратно.", tone: "muted" }
        : { message: "Место выключено и не входит в схему.", tone: "muted" });
    }
  }, [connections, currentAssignments, geometry.seats, isLayoutActionBusy, reconcileGeometryChange, tables]);

  const handleToggleSeatEdit = useCallback(() => {
    if (isLayoutActionBusy) return;
    setSeatEditEnabled((enabled) => {
      setFeedback({ message: enabled ? "Режим мест выключен." : "Режим мест: клик по стулу выключает или включает его.", tone: "muted" });
      return !enabled;
    });
  }, [isLayoutActionBusy]);

  const handleAddReserve = useCallback(() => {
    if (!manualSeatingEnabled) {
      return;
    }
    setIsReserveDialogOpen(true);
  }, [manualSeatingEnabled]);

  const handleCancelReserve = useCallback(() => {
    setIsReserveDialogOpen(false);
  }, []);

  const handleCreateReserve = useCallback((label: string) => {
    const trimmed = label.trim();
    if (!trimmed) {
      return;
    }

    const reserve = createReserveAssignment(trimmed);
    setAssignments((current) => [...current, reserve]);
    setIsReserveDialogOpen(false);
    setFeedback({
      message: `Резерв «${trimmed}» добавлен в «Не рассажены». Перетащите его на место и нажмите «Сохранить».`,
      tone: "muted",
    });
    setHasUnsavedChanges(true);
  }, []);

  const handleDeleteReserve = useCallback((reserveId: string) => {
    setDragSource(null);
    setAssignments((current) =>
      current.filter(
        (assignment) => !(assignment.type === "reserve" && assignment.id === reserveId),
      ),
    );
    setFeedback({
      message: "Резерв удалён. Нажмите «Сохранить», чтобы зафиксировать изменение.",
      tone: "muted",
    });
    setHasUnsavedChanges(true);
  }, []);

  const handleReserveDragStart = useCallback((reserveId: string) => {
    setPendingGuestKey(null);
    setDragSource({ kind: "reserve", reserveId });
  }, []);

  useEffect(() => {
    if (!slot) {
      return undefined;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (isShortcutEditableTarget(event.target)) {
        return;
      }

      if (event.key === "Escape") {
        if (isReserveDialogOpen || isCapacitySyncDialogOpen) {
          return;
        }
        if (pendingGuestKey) { event.preventDefault(); setPendingGuestKey(null); return; }

        if (dragSource || selectedTableId) {
          event.preventDefault();
          setDragSource(null);
          setSelectedTableId(null);
          setCanvasCancelVersion((version) => version + 1);
          return;
        }

        onClose();
        return;
      }

      if (event.repeat || event.altKey || event.ctrlKey || event.metaKey) {
        return;
      }

      if (event.code === "KeyN" || event.key.toLowerCase() === "n") {
        if (!canAddTable) {
          return;
        }

        event.preventDefault();
        handleAddTable();
        return;
      }

      if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();

        if (!canRemoveSelectedTable) {
          return;
        }

        handleRemoveTable();
        return;
      }

      if (event.key.toLowerCase() === "r") {
        if (!canRotateSelectedTable) {
          return;
        }

        event.preventDefault();
        handleRotateTable();
      }
    };

    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [
    canAddTable,
    canRemoveSelectedTable,
    canRotateSelectedTable,
    dragSource,
    handleAddTable,
    handleRemoveTable,
    handleRotateTable,
    isCapacitySyncDialogOpen,
    isReserveDialogOpen,
    pendingGuestKey,
    onClose,
    selectedTableId,
    slot,
  ]);

  const capacitySyncButton = canShowCapacitySyncAction ? (
    <Button
      className="seat-capacity-sync-button"
      disabled={isLayoutActionBusy}
      onClick={handleOpenCapacitySyncDialog}
      size="sm"
      title={layoutBusyReason ?? "Обновить лимит выбранного слота вручную"}
      variant="secondary"
    >
      Обновить лимит слота до количества физических мест
    </Button>
  ) : null;

  if (!slot || typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <>
      <div
        className="seat-modal-overlay"
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) {
            onClose();
          }
        }}
      >
      <section
        aria-labelledby="seat-modal-title"
        aria-modal="true"
        className="seat-modal"
        role="dialog"
      >
        <header className="seat-modal__head">
          <div className="seat-modal__title-block">
            <span>Схема рассадки</span>
            <h2 id="seat-modal-title">{slotTitle}</h2>
            {slotSubtitle ? <p>{slotSubtitle}</p> : null}
          </div>
          <SeatingMetricsPanel
            capacityLimit={capacityLimit}
            disabledSeatCount={geometry.disabledSeatCount}
            physicalOccupiedSeats={seatOccupants.length}
            physicalSeatCount={geometry.physicalSeatCount}
            rabbiReserveCount={rabbiReserveCount}
            registrationOccupiedSeats={slot.bucket.occupiedSeats}
            reserveSeats={placedReserveCount}
            seatedGuestCount={seatedGuestCount}
            tableCount={tables.length}
            unseatedCount={unassignedGuestPool.length + pooledReserves.length}
          />
          <button
            aria-label="Закрыть схему рассадки"
            className="seat-modal__close"
            onClick={onClose}
            type="button"
          >
            ×
          </button>
        </header>

        <div className="seat-toolbar">
          <SeatingTemplateSelector
            canSaveTemplate={hasValidGeometry && !isLayoutActionBusy}
            disabled={isLayoutActionBusy}
            isApplyingTemplate={isApplyingTemplate}
            isDeletingTemplate={isDeletingTemplate}
            isLoadingTemplates={isTemplateListLoading}
            isSavingTemplate={isSavingTemplate}
            onDeleteTemplate={handleDeleteTemplate}
            onSaveTemplate={handleSaveTemplate}
            onTemplateChange={handleTemplateChange}
            selectedValue={activeTemplateValue}
            templates={templates}
          />

          {toolbarStatus ? (
            <span
              className={`seat-save-status seat-save-status--${toolbarStatus.tone}`}
              role="status"
              title={toolbarStatus.message}
            >
              {toolbarStatus.message}
            </span>
          ) : null}

          <div className="seat-toolbar__save-slot"><Button
            className={`seat-toolbar__save${hasUnsavedChanges ? " is-dirty" : ""}`}
            disabled={saveDisabled}
            onClick={handleSave}
            size="sm"
            title={saveDisabled ? layoutBusyReason ?? "Нужна валидная схема с одним раввинским столом." : "Сохранить схему рассадки"}
            variant="gold"
          >
            <SaveIcon />
            {isSaving ? "Сохраняем..." : "Сохранить схему рассадки"}
          </Button></div>
        </div>

        <div className="seat-body">
          <div className="seat-stage">
            <div className="seat-canvas-shell">
              {layoutLoadError || (feedback?.tone === "error" && feedback.message !== layoutLoadError) ? (
                <div className="seat-canvas-error-slot" role="alert">
                  {layoutLoadError ? (
                    <div className="seat-canvas-banner seat-canvas-banner--error">
                      <strong>Не удалось загрузить сохраненную схему.</strong>
                      <span>{layoutLoadError}</span>
                    </div>
                  ) : null}
                  {feedback?.tone === "error" && feedback.message !== layoutLoadError ? (
                    <div className="seat-canvas-error-slot__action">
                      <div className="seat-canvas-banner seat-canvas-banner--error">
                        <strong>Не удалось выполнить действие.</strong>
                        <span>{feedback.message}</span>
                      </div>
                      <button
                        aria-label="Скрыть ошибку"
                        className="seat-canvas-error-slot__close"
                        onClick={() => setFeedback(null)}
                        type="button"
                      >
                        ×
                      </button>
                    </div>
                  ) : null}
                </div>
              ) : null}

            {isLoading && tables.length === 0 ? (
              <div className="seat-canvas-state" role="status">
                Загружаем схему...
              </div>
            ) : tables.length === 0 ? (
              <div className="seat-canvas-state" role="status">
                Нет схемы для выбранного слота.
              </div>
            ) : (
              <SeatingCanvas
                cancelVersion={canvasCancelVersion}
                connections={connections}
                geometry={geometry}
                isSeatingDone={isSeatingDone}
                manualSeatingEnabled={manualSeatingEnabled}
                onMoveTable={handleMoveTable}
                onMoveTableEnd={handleMoveTableEnd}
                onSeatClick={handlePendingGuestSeatClick}
                onSeatDragEnd={handleManualDragEnd}
                onSeatDragStart={handleSeatDragStart}
                onSeatDrop={handleSeatDrop}
                onToggleSeat={handleToggleSeat}
                onSelectTable={setSelectedTableId}
                occupants={seatOccupants}
                selectedTableId={selectedTableId}
                seatEditEnabled={seatEditEnabled}
                seatPlacementPending={pendingGuestKey !== null}
                tables={tables}
              />
            )}
            </div>

          </div>

          <aside className="seat-side-panel">
            {metricsSummary.missingPhysical > 0 || (metricsSummary.capacityLimit !== null && metricsSummary.physicalSeatCount < metricsSummary.capacityLimit) ? <div className="seat-capacity-alert" role="alert">
              <span>{metricsSummary.missingPhysical > 0 ? <>Не хватает физических мест: {formatCount(metricsSummary.registrationOccupiedSeats + metricsSummary.reserveSeats)} {pluralizeRu(metricsSummary.registrationOccupiedSeats + metricsSummary.reserveSeats, "гость", "гостя", "гостей")} на {formatCount(metricsSummary.physicalSeatCount)} {pluralizeRu(metricsSummary.physicalSeatCount, "стул", "стула", "стульев")}</> : <>В схеме {formatCount(metricsSummary.physicalSeatCount)} {pluralizeRu(metricsSummary.physicalSeatCount, "место", "места", "мест")} при лимите {formatCount(metricsSummary.capacityLimit!)} — не хватает {formatCount(metricsSummary.capacityLimit! - metricsSummary.physicalSeatCount)}. Лимит регистрации сам по схеме не меняется.</>}</span>{capacitySyncButton}</div> : null}

            <SeatingAssignmentsPanel
              canAddReserve={manualSeatingEnabled}
              error={guestPoolError}
              fullListGuests={guestPool}
              guests={visibleGuestPool}
              isSeatingDone={isSeatingDone}
              isLoading={isGuestPoolLoading}
              manualSeatingEnabled={manualSeatingEnabled}
              onAddReserve={handleAddReserve}
              onDeleteReserve={handleDeleteReserve}
              onGuestDragEnd={handleManualDragEnd}
              onGuestDragStart={handleGuestDragStart}
              onGuestSelect={handleSelectGuestForPlacement}
              onPoolDrop={handlePoolDrop}
              onReserveDragEnd={handleManualDragEnd}
              onReserveDragStart={handleReserveDragStart}
              reserves={pooledReserves}
              pendingGuestKey={pendingGuestKey}
              placementByGuestKey={placementByGuestKey}
              warning={guestPoolWarning}
            />

            <div className="seat-side-actions">
              <Button className="seat-side-actions__primary" disabled={autoAssignDisabled} onClick={handleAutoAssign} size="md" title={autoAssignDisabledReason ?? "Сделать рассадку по текущей схеме"} variant="success"><SparkleIcon />{isAutoAssigning ? "Делаем рассадку..." : isSeatingDone ? "Дорассадить свободных" : "Рассадить гостей"}</Button>
              <Button
                className="seat-print-sidebar-action"
                disabled={!canPrintSeating}
                onClick={handlePrintSeating}
                size="md"
                title={printDisabledReason ?? "Напечатать текущую рассадку"}
                variant="secondary"
              >
                <PrinterIcon />Печать рассадки
              </Button>
            </div>
          </aside>
        </div>
        <footer className="seat-footer">
          <SeatingToolbar
            addDisabled={!canAddTable}
            addDisabledReason={addTableDisabledReason}
            allSideSeatsDisabled={!canSetAllSideSeats}
            allSideSeatsDisabledReason={allSideSeatsDisabledReason}
            allSideSeats={allTablesSideSeats}
            onAddTable={handleAddTable}
            onRemoveTable={handleRemoveTable}
            onRotateTable={handleRotateTable}
            onSetAllSideSeats={handleSetAllSideSeats}
            onSetSelectedSideSeats={handleSetSelectedSideSeats}
            onToggleSeatEdit={handleToggleSeatEdit}
            removeDisabled={!canRemoveSelectedTable}
            removeDisabledReason={removeTableDisabledReason}
            rotateDisabled={!canRotateSelectedTable}
            rotateDisabledReason={rotateTableDisabledReason}
            selectedTableSideSeats={selectedTable ? tableSideSeats(selectedTable) : null}
            sideSeatsDisabled={!canChangeSelectedTableSideSeats}
            sideSeatsDisabledReason={sideSeatsDisabledReason}
            seatEditDisabled={isLayoutActionBusy}
            seatEditDisabledReason={layoutBusyReason}
            seatEditEnabled={seatEditEnabled}
            variant="layout"
          />
          <SeatingShortcutLegend />
        </footer>
      </section>

      {isReserveDialogOpen ? (
        <SeatingReserveDialog
          onClose={handleCancelReserve}
          onCreate={handleCreateReserve}
        />
      ) : null}

        {isCapacitySyncDialogOpen ? (
          <SeatingCapacitySyncDialog
            capacityLimit={capacityLimit}
            error={capacitySyncError}
            isSubmitting={isCapacitySyncing}
            occupiedSeats={slot.bucket.occupiedSeats}
            onCancel={handleCancelCapacitySyncDialog}
            onConfirm={handleConfirmCapacitySync}
            physicalSeatCount={geometry.physicalSeatCount}
          />
        ) : null}
      </div>

      {printModel ? <SeatingPrintDocument model={printModel} /> : null}
    </>,
    document.body,
  );
}

function getLayoutBusyReason({
  isApplyingTemplate,
  isAutoAssigning,
  isCapacitySyncing,
  isDeletingTemplate,
  isGuestPoolLoading,
  isLoading,
  isSaving,
  isSavingTemplate,
}: {
  isApplyingTemplate: boolean;
  isAutoAssigning: boolean;
  isCapacitySyncing: boolean;
  isDeletingTemplate: boolean;
  isGuestPoolLoading: boolean;
  isLoading: boolean;
  isSaving: boolean;
  isSavingTemplate: boolean;
}): string | null {
  if (isLoading) {
    return "Загружаем схему.";
  }

  if (isGuestPoolLoading) {
    return "Загружаем гостей.";
  }

  if (isSaving) {
    return "Сохраняем изменения.";
  }

  if (isAutoAssigning) {
    return "Идет авторассадка.";
  }

  if (isCapacitySyncing) {
    return "Обновляем лимит слота.";
  }

  if (isApplyingTemplate) {
    return "Применяем шаблон.";
  }

  if (isSavingTemplate) {
    return "Сохраняем шаблон.";
  }

  if (isDeletingTemplate) {
    return "Удаляем шаблон.";
  }

  return null;
}

function getPrintDisabledReason({
  hasValidGeometry,
  isLayoutActionBusy,
  isSeatingDone,
  layoutBusyReason,
  layoutLoadError,
  physicalSeatCount,
}: {
  hasValidGeometry: boolean;
  isLayoutActionBusy: boolean;
  isSeatingDone: boolean;
  layoutBusyReason: string | null;
  layoutLoadError: string | null;
  physicalSeatCount: number;
}): string {
  if (isLayoutActionBusy) {
    return layoutBusyReason ?? "Идет операция.";
  }

  if (layoutLoadError) {
    return "Сначала загрузите сохраненную схему без ошибок.";
  }

  if (!isSeatingDone) {
    return "Сначала завершите рассадку.";
  }

  if (!hasValidGeometry) {
    return "Нужна валидная схема с одним раввинским столом.";
  }

  if (physicalSeatCount <= 0) {
    return "В схеме нет физических мест для печати.";
  }

  return "Печать рассадки недоступна.";
}

function getAutoAssignDisabledReason({
  guestPoolLength,
  hasGuestPoolMismatch,
  hasValidGeometry,
  isLayoutActionBusy,
  layoutBusyReason,
  physicalSeatCount,
}: {
  guestPoolLength: number;
  hasGuestPoolMismatch: boolean;
  hasValidGeometry: boolean;
  isLayoutActionBusy: boolean;
  layoutBusyReason: string | null;
  physicalSeatCount: number;
}): string {
  if (isLayoutActionBusy) {
    return layoutBusyReason ?? "Идет операция.";
  }

  if (!hasValidGeometry) {
    return "Нужна валидная схема с одним раввинским столом.";
  }

  if (hasGuestPoolMismatch) {
    return "Список гостей не загружен для занятого слота.";
  }

  if (guestPoolLength === 0) {
    return "Нет гостей для рассадки.";
  }

  if (physicalSeatCount === 0) {
    return "В схеме нет физических мест.";
  }

  return "Авторассадка недоступна.";
}

function isShortcutEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  if (target.isContentEditable) {
    return true;
  }

  const tagName = target.tagName.toLowerCase();
  return tagName === "input" || tagName === "textarea" || tagName === "select";
}

function assignmentsToPayloadEntries(assignments: SeatingAssignment[]): {
  chairs: SeatingAssignmentEntry[];
  pool: SeatingAssignmentEntry[];
} {
  return {
    chairs: assignments
      .filter((assignment) => assignment.seatKey)
      .map(assignmentToPayloadEntry),
    pool: assignments
      .filter((assignment) => !assignment.seatKey)
      .map(assignmentToPayloadEntry),
  };
}

function assignmentToPayloadEntry(assignment: SeatingAssignment): SeatingAssignmentEntry {
  return {
    initials: assignment.guestInitials,
    name: assignment.guestLabel,
    registrationId: assignment.registrationId,
    seatKey: assignment.seatKey,
    type: assignment.type,
  };
}

function assertAssignmentSaveResultMatchesPayload(
  saveResult: SeatingAssignmentsSaveResult,
  payloadEntries: {
    chairs: SeatingAssignmentEntry[];
    pool: SeatingAssignmentEntry[];
  },
): void {
  const entries = [...payloadEntries.chairs, ...payloadEntries.pool];
  const reserveCount = entries.filter((entry) => entry.type === "reserve").length;

  if (
    saveResult.placedCount !== payloadEntries.chairs.length ||
    saveResult.pooledCount !== payloadEntries.pool.length ||
    saveResult.reserveCount !== reserveCount
  ) {
    throw new Error("Seating assignments save returned unexpected row counts.");
  }
}

function formatLayoutSaveError(error: unknown, expectedAssignmentsSave: boolean): string {
  if (expectedAssignmentsSave) {
    return formatAutoAssignSaveError(error);
  }

  return "Не удалось сохранить схему. Обновите страницу и попробуйте ещё раз.";
}

function manualDropRejectionFeedback(
  reason: SeatingDragDropRejection,
): EditorFeedback | null {
  switch (reason) {
    case "rabbi_reserved_seat":
      return {
        message:
          "Это место раввинского стола — обычного гостя сюда посадить нельзя.",
        tone: "error",
      };
    case "duplicate_guest":
      return { message: "Этот гость уже рассажен.", tone: "muted" };
    case "disabled_seat":
      return { message: "Место выключено — включите его, чтобы посадить гостя.", tone: "error" };
    case "noop":
    case "missing_guest":
    case "missing_source_occupant":
    case "seat_out_of_range":
    default:
      return null;
  }
}

// PR 17: the status shown after a reconcile/seating commit. When the geometry
// change freed occupants, surface how many placements survived and how many guests
// /reserves went back to "Не рассажены"; otherwise a calm success/overflow note.
function buildSeatingFeedback(
  counts: SeatingReconcileCounts,
  overflowCount: number,
): EditorFeedback {
  if (counts.returnedCount > 0) {
    const overflow = overflowCount > 0 ? ` Не поместились: ${overflowCount}.` : "";
    return {
      message: `После изменения схемы сохранено ${counts.keptCount} посадок, ${counts.returnedCount} гостей/резервов вернулись в список.${overflow}`,
      tone: "muted",
    };
  }

  if (overflowCount > 0) {
    return {
      message: `Рассадка сохранена. Не поместились: ${overflowCount}.`,
      tone: "muted",
    };
  }

  return { message: "Рассадка сохранена.", tone: "success" };
}

function formatAutoAssignSaveError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);

  if (message.includes("does not belong to this event/occurrence/capacity unit")) {
    return "Не удалось сохранить рассадку: часть гостей не относится к выбранному слоту мест.";
  }

  if (message.includes("unexpected row counts")) {
    return "Не удалось подтвердить сохранение рассадки. Обновите данные и попробуйте ещё раз.";
  }

  return "Не удалось сохранить схему. Обновите страницу и попробуйте ещё раз.";
}

function formatCapacitySyncError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);

  if (message.includes("Capacity cannot be lower than occupied seats")) {
    return "Нельзя обновить лимит: уже занято больше мест, чем в схеме.";
  }

  if (message.includes("Admin role required")) {
    return "Недостаточно прав для обновления лимита регистрации.";
  }

  if (message.includes("Auth required")) {
    return "Нужно войти в admin UI, чтобы обновить лимит регистрации.";
  }

  return message || "Не удалось обновить лимит регистрации.";
}

function formatCount(value: number): string {
  return new Intl.NumberFormat("ru-RU").format(value);
}

function pluralizeRu(count: number, one: string, few: string, many: string): string {
  const mod100 = Math.abs(count) % 100;
  const mod10 = mod100 % 10;
  if (mod100 >= 11 && mod100 <= 14) return many;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;
  return many;
}

type TemplateGeometry = {
  connections: SeatingConnection[];
  tables: SeatingTable[];
};

function createBuiltInTemplateGeometry(
  templateId: BuiltInSeatingTemplateId,
  capacity: number,
): TemplateGeometry {
  if (templateId === "builtin:holiday_p_row") {
    return createHolidayTemplateGeometry(capacity);
  }

  if (templateId === "builtin:grid") {
    return {
      connections: [],
      tables: createGridTemplateTables(capacity),
    };
  }

  return {
    connections: [],
    tables: [createEditorTable({ isRabbiTable: true })],
  };
}

function createHolidayTemplateGeometry(capacity: number): TemplateGeometry {
  const count = Math.max(7, Math.ceil(normalizeTemplateCapacity(capacity) / HOLIDAY_TABLE_CAPACITY));
  const top = Math.max(3, Math.ceil(count * 0.32));
  const arms = Math.max(2, Math.ceil(count * 0.22));
  const center = Math.max(2, count - top - arms * 2);
  const topStartX = TABLE_W * 2;
  const topStartY = TABLE_H * 2;
  const tables: SeatingTable[] = [];
  const connections: SeatingConnection[] = [];

  for (let index = 0; index < top; index += 1) {
    tables.push(
      createEditorTable({
        cx: topStartX + index * TABLE_W,
        cy: topStartY,
      }),
    );
  }

  for (let index = 0; index < top - 1; index += 1) {
    connections.push({
      aEnd: "b",
      aTableId: tables[index].id,
      bEnd: "a",
      bTableId: tables[index + 1].id,
      x: topStartX + index * TABLE_W + TABLE_W / 2,
      y: topStartY,
    });
  }

  const leftCorner = { x: topStartX - TABLE_W / 2, y: topStartY + TABLE_H / 2 };
  const rightCorner = {
    x: topStartX + (top - 1) * TABLE_W + TABLE_W / 2,
    y: topStartY + TABLE_H / 2,
  };
  let previousLeft: SeatingTable | null = null;
  let previousRight: SeatingTable | null = null;

  for (let index = 0; index < arms; index += 1) {
    const cy = leftCorner.y + TABLE_W / 2 + index * TABLE_W;
    const left = createEditorTable({
      angle: 90,
      cx: leftCorner.x - TABLE_H / 2,
      cy,
    });
    const right = createEditorTable({
      angle: 90,
      cx: rightCorner.x + TABLE_H / 2,
      cy,
    });

    tables.push(left, right);

    if (index === 0) {
      connections.push({
        aEnd: "a",
        aTableId: tables[0].id,
        bEnd: "a",
        bTableId: left.id,
        x: leftCorner.x,
        y: leftCorner.y,
      });
      connections.push({
        aEnd: "b",
        aTableId: tables[top - 1].id,
        bEnd: "a",
        bTableId: right.id,
        x: rightCorner.x,
        y: rightCorner.y,
      });
    } else if (previousLeft && previousRight) {
      connections.push({
        aEnd: "b",
        aTableId: previousLeft.id,
        bEnd: "a",
        bTableId: left.id,
        x: left.cx,
        y: left.cy - TABLE_W / 2,
      });
      connections.push({
        aEnd: "b",
        aTableId: previousRight.id,
        bEnd: "a",
        bTableId: right.id,
        x: right.cx,
        y: right.cy - TABLE_W / 2,
      });
    }

    previousLeft = left;
    previousRight = right;
  }

  const middleY = topStartY + TABLE_H / 2 + TABLE_W * 0.9;
  const centerStartX = topStartX + TABLE_W * 0.8;
  let previousCenter: SeatingTable | null = null;

  for (let index = 0; index < center; index += 1) {
    const table = createEditorTable({
      cx: centerStartX + index * TABLE_W,
      cy: middleY,
    });
    tables.push(table);

    if (previousCenter) {
      connections.push({
        aEnd: "b",
        aTableId: previousCenter.id,
        bEnd: "a",
        bTableId: table.id,
        x: previousCenter.cx + TABLE_W / 2,
        y: previousCenter.cy,
      });
    }

    previousCenter = table;
  }

  const normalizedTables = ensureOneRabbiTable(tables);

  return {
    connections: filterConnectionsForTables(connections, normalizedTables),
    tables: normalizedTables,
  };
}

function createGridTemplateTables(capacity: number): SeatingTable[] {
  const count = Math.max(1, Math.ceil(normalizeTemplateCapacity(capacity) / GRID_TABLE_CAPACITY));
  const cols = Math.max(1, Math.ceil(Math.sqrt(count)));
  const gapX = TABLE_W + CHAIR_OFFSET * 3 + 6;
  const gapY = TABLE_H + CHAIR_OFFSET * 3 + 2;

  return ensureOneRabbiTable(
    Array.from({ length: count }, (_, index) =>
      createEditorTable({
        cx: TABLE_W + (index % cols) * gapX,
        cy: TABLE_H + Math.floor(index / cols) * gapY,
      }),
    ),
  );
}

function cloneTemplateGeometry(template: SeatingTemplate): TemplateGeometry {
  const idMap = new Map<string, string>();
  const tables = template.snapshot.tables.map((sourceTable) => {
    const table = createEditorTable({
      angle: sourceTable.angle,
      cx: sourceTable.cx,
      cy: sourceTable.cy,
      h: sourceTable.h,
      isRabbiTable: sourceTable.isRabbiTable,
      sideSeats: tableSideSeats(sourceTable),
      disabledSeats: sourceTable.disabledSeats,
      w: sourceTable.w,
    });
    idMap.set(sourceTable.id, table.id);
    return table;
  });
  const normalizedTables = normalizeEditorTables(tables);
  const normalizedTableIds = new Set(normalizedTables.map((table) => table.id));
  const connections = template.snapshot.connections
    .map((connection) => ({
      ...connection,
      aTableId: idMap.get(connection.aTableId) ?? connection.aTableId,
      bTableId: idMap.get(connection.bTableId) ?? connection.bTableId,
    }))
    .filter(
      (connection) =>
        normalizedTableIds.has(connection.aTableId) &&
        normalizedTableIds.has(connection.bTableId),
    );

  return {
    connections,
    tables: normalizedTables,
  };
}

function normalizeTemplateCapacity(capacity: number): number {
  return Number.isFinite(capacity) && capacity > 0 ? capacity : GRID_TABLE_CAPACITY;
}

function countRabbiTables(tables: SeatingTable[]): number {
  return tables.filter((table) => table.isRabbiTable).length;
}

function templateIdForSavePayload(
  value: SeatingTemplateValue,
  templates: SeatingTemplate[],
  hasLoadedTemplates: boolean,
): string | null {
  const templateId = parseUserSeatingTemplateValue(value);
  return templateId &&
    (!hasLoadedTemplates || templates.some((template) => template.id === templateId))
    ? templateId
    : null;
}

function templateValueAfterSave(
  value: SeatingTemplateValue,
  templates: SeatingTemplate[],
  hasLoadedTemplates: boolean,
): SeatingTemplateValue {
  return parseUserSeatingTemplateValue(value) &&
    !templateIdForSavePayload(value, templates, hasLoadedTemplates)
    ? DEFAULT_SEATING_TEMPLATE_VALUE
    : value;
}

function upsertTemplate(
  templates: SeatingTemplate[],
  template: SeatingTemplate,
): SeatingTemplate[] {
  const withoutCurrent = templates.filter((item) => item.id !== template.id);
  return [...withoutCurrent, template].sort((a, b) =>
    a.title.localeCompare(b.title, "ru-RU"),
  );
}

// PR 16: a reserve is a pooled `type: "reserve"` assignment with no
// registration_id. The stable client id is its identity for drag/drop and delete;
// after a reopen the DB row id takes over the same role.
function createReserveAssignment(label: string): SeatingAssignment {
  clientReserveSequence += 1;
  return {
    guestInitials: reserveInitials(label),
    guestLabel: label,
    id: `reserve_${Date.now().toString(36)}_${clientReserveSequence.toString(36)}`,
    layoutId: "",
    registrationId: null,
    seatKey: null,
    type: "reserve",
  };
}

function derivePooledReserves(
  assignments: SeatingAssignment[],
): SeatingReservePoolItem[] {
  return assignments
    .filter((assignment) => assignment.type === "reserve" && !assignment.seatKey)
    .map((assignment) => ({
      id: assignment.id,
      initials: assignment.guestInitials?.trim() || "Рез",
      label: assignment.guestLabel?.trim() || "Резерв",
    }));
}

function reserveInitials(label: string): string {
  const words = label.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    return "Рез";
  }
  if (words.length === 1) {
    return words[0].slice(0, 2).toLocaleUpperCase("ru-RU");
  }
  return `${words[0][0]}${words[1][0]}`.toLocaleUpperCase("ru-RU");
}

function filterConnectionsForTables(
  connections: SeatingConnection[],
  tables: SeatingTable[],
): SeatingConnection[] {
  const tableIds = new Set(tables.map((table) => table.id));

  return connections.filter(
    (connection) =>
      tableIds.has(connection.aTableId) && tableIds.has(connection.bTableId),
  );
}

function connectionTouchesTable(connection: SeatingConnection, tableId: string): boolean {
  return connection.aTableId === tableId || connection.bTableId === tableId;
}

function pickSelectedTableId(tables: SeatingTable[]): string | null {
  return tables.find((table) => table.isRabbiTable)?.id ?? tables[0]?.id ?? null;
}

function formatSlotTitle(slot: SeatingLayoutEditorSlot): string {
  return slot.bucket.title || slot.bucket.code || slot.bucket.key || "Слот мест";
}

function formatSlotSubtitle(slot: SeatingLayoutEditorSlot): string {
  const occurrenceLabel = slot.occurrence
    ? slot.occurrence.title || formatDateTime(slot.occurrence.startsAt)
    : "Без отдельного сеанса";
  const bucketCode = slot.bucket.code || slot.bucket.key;

  return [slot.event.title, occurrenceLabel, bucketCode].filter(Boolean).join(" · ");
}

function formatPrintSlotSubtitle(slot: SeatingLayoutEditorSlot): string {
  const occurrenceLabel = slot.occurrence
    ? slot.occurrence.title || formatDateTime(slot.occurrence.startsAt)
    : slot.event.startsAt
      ? formatDateTime(slot.event.startsAt)
      : "Без отдельного сеанса";
  const bucketCode = slot.bucket.code || slot.bucket.key;

  return [occurrenceLabel, bucketCode].filter(Boolean).join(" · ");
}

function seatingGuestSignature(registrationId: string | null, label: string | null, initials: string | null): string {
  return [registrationId ?? "", label?.trim().toLocaleLowerCase("ru-RU") ?? "", initials?.trim().toLocaleLowerCase("ru-RU") ?? ""].join("|");
}

function SaveIcon() { return <svg aria-hidden="true" className="seat-button-icon" fill="none" height="15" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.7" viewBox="0 0 24 24" width="15"><path d="M5 4.5h10.5L19.5 8.5V19.5H5zM8.5 4.5v4.8h6.2V4.5M8 19.5v-5.7h8v5.7" /></svg>; }
function SparkleIcon() { return <svg aria-hidden="true" className="seat-button-icon" fill="none" height="15" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.7" viewBox="0 0 24 24" width="15"><path d="M9 3.6l1.3 3.4 3.4 1.3-3.4 1.3L9 13l-1.3-3.4-3.4-1.3 3.4-1.3zM17 13.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z" /></svg>; }
function PrinterIcon() { return <svg aria-hidden="true" className="seat-button-icon" fill="none" height="15" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.7" viewBox="0 0 24 24" width="15"><path d="M7.5 9V4.5h9V9M5.5 9h13a1.5 1.5 0 0 1 1.5 1.5v5H4v-5A1.5 1.5 0 0 1 5.5 9zM7.5 13.5h9v6h-9z" /></svg>; }
