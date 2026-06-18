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
  tableBounds,
  tableSideSeats,
} from "../../lib/seatingGeometry";
import {
  autoAssignResultToAssignments,
  autoAssignSeating,
  deriveSeatingAssignmentRestoreState,
} from "../../lib/seatingAutoAssign";
import {
  reconcileSeatingAssignments,
  type SeatingReconcileCounts,
} from "../../lib/seatingAssignmentReconcile";
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
  SeatingReservePoolItem,
  SeatingTable,
  SeatingTemplate,
} from "../../types/seating";
import { SeatingAssignmentsPanel } from "./SeatingAssignmentsPanel";
import { SeatingCanvas } from "./SeatingCanvas";
import { SeatingCapacitySummary } from "./SeatingCapacitySummary";
import { SeatingCapacitySyncDialog } from "./SeatingCapacitySyncDialog";
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
import { SeatingToolbar } from "./SeatingToolbar";

export type SeatingLayoutEditorSlot = {
  bucket: AdminRegistrationCapacityBucket;
  event: AdminRegistrationEventSummary;
  occurrence: AdminEventOccurrence | null;
};

type EditorFeedback = {
  message: string;
  tone: "muted" | "success" | "error";
};

const TABLE_START_CX = TABLE_W + CHAIR_OFFSET * 2;
const TABLE_START_CY = TABLE_H + CHAIR_OFFSET * 2;
const TABLE_ADD_DX = TABLE_W + CHAIR_OFFSET * 2;
const TABLE_ADD_DY = TABLE_H / 2;
const TABLE_MIN_PADDING = CHAIR_OFFSET + 24;
const GRID_TABLE_CAPACITY = 8;
const HOLIDAY_TABLE_CAPACITY = 6.5;

let clientTableSequence = 0;
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
  const [feedback, setFeedback] = useState<EditorFeedback | null>(null);
  const [guestPool, setGuestPool] = useState<SeatingGuestPoolItem[]>([]);
  const [guestPoolError, setGuestPoolError] = useState<string | null>(null);
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
  // PR 17: true after "Редактировать столы" reopens geometry editing from a done
  // seating; controls the reconcile/restore exit affordance and warning.
  const [isEditingAfterSeating, setIsEditingAfterSeating] = useState(false);
  const [reconcileNotice, setReconcileNotice] = useState<SeatingReconcileCounts | null>(null);
  const [isGuestPoolLoading, setIsGuestPoolLoading] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isReserveDialogOpen, setIsReserveDialogOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isSavingTemplate, setIsSavingTemplate] = useState(false);
  const [isTemplateListLoading, setIsTemplateListLoading] = useState(false);
  const [selectedTableId, setSelectedTableId] = useState<string | null>(null);
  const [isSeatingDone, setIsSeatingDone] = useState(false);
  const [tables, setTables] = useState<SeatingTable[]>([]);
  const [templates, setTemplates] = useState<SeatingTemplate[]>([]);

  useEffect(() => {
    if (!slot) {
      return undefined;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        // While the reserve dialog is open, Escape closes only the dialog (it has
        // its own handler); it must not also close the whole seating modal.
        if (isReserveDialogOpen) {
          return;
        }
        onClose();
      }
    };

    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isReserveDialogOpen, onClose, slot]);

  useEffect(() => {
    if (!slot) {
      setActiveTemplateValue(DEFAULT_SEATING_TEMPLATE_VALUE);
      setAssignments([]);
      setCapacityLimitOverride(undefined);
      setCapacitySyncError(null);
      setConnections([]);
      setDragSource(null);
      setIsCapacitySyncDialogOpen(false);
      setIsCapacitySyncing(false);
      setIsAutoAssigning(false);
      setIsEditingAfterSeating(false);
      setReconcileNotice(null);
      setIsReserveDialogOpen(false);
      setIsSeatingDone(false);
      setSelectedTableId(null);
      setTables([]);
      return undefined;
    }

    let cancelled = false;

    setFeedback({ message: "Загружаем схему...", tone: "muted" });
    setCapacityLimitOverride(undefined);
    setCapacitySyncError(null);
    setIsReserveDialogOpen(false);
    setIsCapacitySyncDialogOpen(false);
    setIsCapacitySyncing(false);
    setIsEditingAfterSeating(false);
    setReconcileNotice(null);
    setActiveTemplateValue(DEFAULT_SEATING_TEMPLATE_VALUE);
    setIsLoading(true);
    setIsApplyingTemplate(false);
    setIsAutoAssigning(false);
    setIsDeletingTemplate(false);
    setIsSaving(false);
    setIsSavingTemplate(false);

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
        setAssignments(layout?.assignments ?? []);
        setIsSeatingDone(Boolean(layout?.seatingDone));
        setActiveTemplateValue(
          layout?.templateId
            ? userSeatingTemplateValue(layout.templateId)
            : DEFAULT_SEATING_TEMPLATE_VALUE,
        );
        setSelectedTableId(layout?.seatingDone ? null : pickSelectedTableId(nextTables));
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
        setIsSeatingDone(false);
        setActiveTemplateValue(DEFAULT_SEATING_TEMPLATE_VALUE);
        setSelectedTableId(pickSelectedTableId(fallbackTables));
        setFeedback({
          message:
            error instanceof Error
              ? error.message
              : "Не удалось загрузить схему рассадки.",
          tone: "error",
        });
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
      setIsGuestPoolLoading(false);
      return undefined;
    }

    let cancelled = false;

    setGuestPool([]);
    setGuestPoolError(null);
    setIsGuestPoolLoading(true);

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
          setIsGuestPoolLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [slot]);

  const refreshTemplates = useCallback(() => {
    if (!slot) {
      setTemplates([]);
      return Promise.resolve();
    }

    setIsTemplateListLoading(true);

    return listSeatingTemplates()
      .then((nextTemplates) => {
        setTemplates(nextTemplates);
      })
      .catch((error) => {
        setTemplates([]);
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
      return undefined;
    }

    setIsTemplateListLoading(true);

    listSeatingTemplates()
      .then((nextTemplates) => {
        if (!cancelled) {
          setTemplates(nextTemplates);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setTemplates([]);
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
    () => (isSeatingDone ? assignmentRestoreState.occupants : []),
    [assignmentRestoreState.occupants, isSeatingDone],
  );
  const currentAssignments = useMemo(
    () => (isSeatingDone ? assignmentRestoreState.currentAssignments : assignments),
    [assignmentRestoreState.currentAssignments, assignments, isSeatingDone],
  );
  const unassignedGuestPool = useMemo(
    () => (isSeatingDone ? assignmentRestoreState.unassignedGuests : guestPool),
    [assignmentRestoreState.unassignedGuests, guestPool, isSeatingDone],
  );
  const visibleGuestPool = unassignedGuestPool;
  const hasBucketOccupancy = Boolean(
    slot &&
      ((slot.bucket.occupiedSeats ?? 0) > 0 ||
        (slot.bucket.reservationsCount ?? 0) > 0),
  );
  const hasGuestPoolMismatch = Boolean(
    slot &&
      !isGuestPoolLoading &&
      !guestPoolError &&
      hasBucketOccupancy &&
      guestPool.length === 0,
  );
  const invalidSeatKeyWarning =
    isSeatingDone && assignmentRestoreState.invalidAssignments.length > 0
      ? "Часть сохранённых мест больше не существует в текущей схеме."
      : null;
  const guestPoolWarning =
    invalidSeatKeyWarning ??
    (hasGuestPoolMismatch
      ? "Есть занятые места, но список гостей для рассадки не загружен."
      : null);

  const capacityLimit =
    capacityLimitOverride !== undefined
      ? capacityLimitOverride
      : slot?.bucket.capacity ?? null;
  const canPerformAdminActions = auth.canAccessAdmin && (auth.isAdmin || auth.isEventManager);
  const seatsModeLabel = useMemo(() => formatSeatsMode(tables), [tables]);
  const rabbiReserveCount = useMemo(
    () => geometry.seats.filter((seat) => seat.isRabbiTable).length,
    [geometry.seats],
  );
  const slotTitle = slot ? formatSlotTitle(slot) : "Схема рассадки";
  const slotSubtitle = slot ? formatSlotSubtitle(slot) : null;
  const hasValidGeometry = tables.length > 0 && countRabbiTables(tables) === 1;
  const isTemplateBusy =
    isApplyingTemplate ||
    isDeletingTemplate ||
    isSavingTemplate;
  const saveDisabled = !slot || !hasValidGeometry || isTemplateBusy || isAutoAssigning;
  const autoAssignDisabled =
    !slot ||
    !hasValidGeometry ||
    isLoading ||
    isGuestPoolLoading ||
    isSaving ||
    isAutoAssigning ||
    isTemplateBusy ||
    hasGuestPoolMismatch ||
    guestPool.length === 0 ||
    geometry.physicalSeatCount === 0;
  const manualSeatingEnabled =
    isSeatingDone && hasValidGeometry && !isLoading && !isSaving && !isAutoAssigning;
  const canShowCapacitySyncAction = Boolean(
    slot?.bucket.capacityUnitId &&
      canPerformAdminActions &&
      !isLoading &&
      hasValidGeometry &&
      geometry.physicalSeatCount > 0 &&
      capacityLimit !== geometry.physicalSeatCount,
  );
  // PR 16: unseated reserves live in the assignments array as pooled
  // (`seatKey === null`) `type: "reserve"` entries; placed reserves are occupants.
  const pooledReserves = useMemo(
    () => (manualSeatingEnabled ? derivePooledReserves(currentAssignments) : []),
    [currentAssignments, manualSeatingEnabled],
  );
  const placedReserveCount = useMemo(
    () =>
      assignmentRestoreState.occupants.filter((occupant) => occupant.type === "reserve")
        .length,
    [assignmentRestoreState.occupants],
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

    void updateCapacityUnitLimit(slot.bucket.capacityUnitId, nextCapacity)
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

  const handleAddTable = useCallback(() => {
    if (isSeatingDone) {
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

    setTables(nextTables);
    setSelectedTableId(nextTable.id);
  }, [isSeatingDone, selectedTableId, tables]);

  const handleMoveTable = useCallback(
    (tableId: string, center: { cx: number; cy: number }) => {
      if (isSeatingDone) {
        return;
      }

      setTables((currentTables) =>
        ensureOneRabbiTable(
          currentTables.map((table) =>
            table.id === tableId
              ? clampTableToCanvasStart({ ...table, cx: center.cx, cy: center.cy })
              : table,
          ),
        ),
      );
      setConnections((currentConnections) =>
        currentConnections.filter((connection) => !connectionTouchesTable(connection, tableId)),
      );
    },
    [isSeatingDone],
  );

  const handleRemoveTable = useCallback(() => {
    if (isSeatingDone) {
      return;
    }

    if (!selectedTableId || tables.length <= 1) {
      return;
    }

    const nextTables = ensureOneRabbiTable(
      tables.filter((table) => table.id !== selectedTableId),
    );

    setTables(nextTables);
    setConnections((currentConnections) =>
      currentConnections.filter(
        (connection) => !connectionTouchesTable(connection, selectedTableId),
      ),
    );
    setSelectedTableId(pickSelectedTableId(nextTables));
  }, [isSeatingDone, selectedTableId, tables]);

  const handleRotateTable = useCallback(() => {
    if (isSeatingDone) {
      return;
    }

    if (!selectedTableId) {
      return;
    }

    setTables((currentTables) =>
      ensureOneRabbiTable(
        currentTables.map((table) =>
          table.id === selectedTableId
            ? clampTableToCanvasStart({
                ...table,
                angle: normalizeAngle((table.angle || 0) + 90),
              })
            : table,
        ),
      ),
    );
    setConnections((currentConnections) =>
      currentConnections.filter(
        (connection) => !connectionTouchesTable(connection, selectedTableId),
      ),
    );
  }, [isSeatingDone, selectedTableId]);

  const handleToggleSelectedSideSeats = useCallback(() => {
    if (isSeatingDone) {
      return;
    }

    if (!selectedTableId) {
      return;
    }

    setTables((currentTables) =>
      ensureOneRabbiTable(
        currentTables.map((table) =>
          table.id === selectedTableId
            ? { ...table, sideSeats: tableSideSeats(table) === 2 ? 3 : 2 }
            : table,
        ),
      ),
    );
  }, [isSeatingDone, selectedTableId]);

  const handleSetAllSideSeats = useCallback((sideSeats: 2 | 3) => {
    if (isSeatingDone) {
      return;
    }

    setTables((currentTables) =>
      ensureOneRabbiTable(currentTables.map((table) => ({ ...table, sideSeats }))),
    );
  }, [isSeatingDone]);

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
        activeTemplateId: templateIdForSavePayload(templateValue),
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
    [capacityLimit, slot],
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
      if (!slot || value === activeTemplateValue || isSeatingDone) {
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

      setIsApplyingTemplate(true);
      setFeedback({ message: "Применяем шаблон...", tone: "muted" });

      void saveLayoutGeometry({
        nextConnections,
        nextSelectedTableId,
        nextTables,
        templateValue: value,
      })
        .then(() => {
          commitGeometry({
            nextConnections,
            nextSelectedTableId,
            nextTables,
            templateValue: value,
          });
          setFeedback({ message: "Шаблон применён.", tone: "success" });
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
      isSeatingDone,
      saveLayoutGeometry,
      slot,
      templates,
    ],
  );

  const handleSaveTemplate = useCallback(() => {
    if (!slot || !hasValidGeometry || isSeatingDone) {
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
    if (!slot || !hasValidGeometry) {
      return;
    }

    const nextTables = normalizeEditorTables(tables);
    const nextConnections = filterConnectionsForTables(connections, nextTables);
    const nextSelectedTableId = isSeatingDone
      ? null
      : selectedTableId ?? pickSelectedTableId(nextTables);
    const assignmentPayloadEntries = isSeatingDone
      ? assignmentsToPayloadEntries(currentAssignments)
      : null;

    setIsSaving(true);
    setFeedback({ message: "Сохраняем схему...", tone: "muted" });

    void saveLayoutGeometry({
      nextConnections,
      nextSeatingDone: isSeatingDone,
      nextSelectedTableId,
      nextTables,
      templateValue: activeTemplateValue,
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
          templateValue: activeTemplateValue,
        });
        setFeedback({
          message: isSeatingDone
            ? "Схема и рассадка сохранены."
            : "Схема сохранена.",
          tone: "success",
        });
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
    hasValidGeometry,
    isSeatingDone,
    saveLayoutGeometry,
    selectedTableId,
    slot,
    tables,
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
      } else {
        // Restore-only exit: kept placements + returned/pooled occupants as-is.
        mergedAssignments = reconcile.assignments;
      }

      const payloadEntries = assignmentsToPayloadEntries(mergedAssignments);
      const nextSelectedTableId = null;

      setIsAutoAssigning(true);
      setFeedback({ message: "Делаем рассадку...", tone: "muted" });

      void saveLayoutGeometry({
        nextConnections,
        nextSeatingDone: false,
        nextSelectedTableId: pickSelectedTableId(nextTables),
        nextTables,
        templateValue: activeTemplateValue,
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
            templateValue: activeTemplateValue,
          }),
        )
        .then(() => {
          commitGeometry({
            nextConnections,
            nextSelectedTableId,
            nextTables,
            templateValue: activeTemplateValue,
          });
          setDragSource(null);
          setAssignments(mergedAssignments);
          setIsSeatingDone(true);
          setIsEditingAfterSeating(false);
          setReconcileNotice(reconcile.counts.returnedCount > 0 ? reconcile.counts : null);
          setFeedback(buildSeatingFeedback(reconcile.counts, overflowCount));
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
      hasValidGeometry,
      saveLayoutGeometry,
      slot,
      tables,
    ],
  );

  const handleAutoAssign = useCallback(() => {
    if (!slot || autoAssignDisabled) {
      return;
    }
    performSeating(true);
  }, [autoAssignDisabled, performSeating, slot]);

  const handleReturnToSeating = useCallback(() => {
    if (!slot || !isEditingAfterSeating || isAutoAssigning || isSaving || isLoading) {
      return;
    }
    performSeating(false);
  }, [isAutoAssigning, isEditingAfterSeating, isLoading, isSaving, performSeating, slot]);

  const handleEditTablesAfterSeating = useCallback(() => {
    if (!isSeatingDone) {
      return;
    }

    const confirmed = window.confirm(
      "Рассадка уже сделана. В режиме редактирования гости скрыты, а текущая рассадка сохраняется. После изменения схемы нажмите «Сделать рассадку» или «Вернуться к рассадке» — посадки восстановятся насколько возможно, освободившиеся гости вернутся в список. Продолжить?",
    );

    if (!confirmed) {
      return;
    }

    setDragSource(null);
    setIsSeatingDone(false);
    setIsEditingAfterSeating(true);
    setReconcileNotice(null);
    setSelectedTableId(pickSelectedTableId(tables));
    setFeedback({
      message:
        "Режим редактирования включён. Гости скрыты; assignments сохранятся и будут восстановлены при возврате к рассадке.",
      tone: "muted",
    });
  }, [isSeatingDone, tables]);

  const handleManualDragEnd = useCallback(() => {
    setDragSource(null);
  }, []);

  const handleSeatDragStart = useCallback((seatIndex: number) => {
    setDragSource({ kind: "seat", seatIndex });
  }, []);

  const handleGuestDragStart = useCallback((guestKey: string) => {
    setDragSource({ kind: "pool", guestKey });
  }, []);

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
      setReconcileNotice(null);
      setFeedback({
        message: "Изменения рассадки не сохранены. Нажмите «Сохранить».",
        tone: "muted",
      });
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
  }, []);

  const handleReserveDragStart = useCallback((reserveId: string) => {
    setDragSource({ kind: "reserve", reserveId });
  }, []);

  const capacitySyncButton = canShowCapacitySyncAction ? (
    <Button
      className="seat-capacity-sync-button"
      disabled={isCapacitySyncing || isSaving || isAutoAssigning || isTemplateBusy}
      onClick={handleOpenCapacitySyncDialog}
      size="sm"
      variant="secondary"
    >
      Обновить лимит слота до количества физических мест
    </Button>
  ) : null;

  if (!slot || typeof document === "undefined") {
    return null;
  }

  return createPortal(
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
          <div>
            <span>Схема рассадки</span>
            <h2 id="seat-modal-title">{slotTitle}</h2>
            {slotSubtitle ? <p>{slotSubtitle}</p> : null}
          </div>
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
            canSaveTemplate={hasValidGeometry && !isSeatingDone}
            disabled={isLoading || isSaving || isAutoAssigning || isSeatingDone}
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

          <Button
            disabled={autoAssignDisabled}
            onClick={handleAutoAssign}
            size="sm"
            variant="success"
          >
            {isAutoAssigning
              ? "Делаем рассадку..."
              : isSeatingDone
                ? "Дорассадить свободных"
                : "Сделать рассадку"}
          </Button>

          {isEditingAfterSeating && !isSeatingDone ? (
            <Button
              disabled={isLoading || isSaving || isAutoAssigning || !hasValidGeometry}
              onClick={handleReturnToSeating}
              size="sm"
              variant="secondary"
            >
              Вернуться к рассадке
            </Button>
          ) : null}

          {feedback?.message ? (
            <span
              className={`seat-save-status seat-save-status--${feedback.tone}`}
              role={feedback.tone === "error" ? "alert" : "status"}
            >
              {feedback.message}
            </span>
          ) : null}

          <Button
            className="seat-toolbar__save"
            disabled={saveDisabled || isLoading || isSaving}
            onClick={handleSave}
            size="sm"
            variant="gold"
          >
            {isSaving ? "Сохраняем..." : "Сохранить"}
          </Button>
        </div>

        <div className="seat-body">
          <div className="seat-stage">
            {isLoading && tables.length === 0 ? (
              <div className="seat-canvas-state" role="status">
                Загружаем схему...
              </div>
            ) : (
              <SeatingCanvas
                connections={connections}
                geometry={geometry}
                isSeatingDone={isSeatingDone}
                manualSeatingEnabled={manualSeatingEnabled}
                onMoveTable={handleMoveTable}
                onSeatDragEnd={handleManualDragEnd}
                onSeatDragStart={handleSeatDragStart}
                onSeatDrop={handleSeatDrop}
                onSelectTable={setSelectedTableId}
                occupants={seatOccupants}
                selectedTableId={selectedTableId}
                tables={tables}
              />
            )}

            {isSeatingDone ? (
              <div className="seat-layout-controls seat-layout-controls--locked">
                <span className="seat-controls-label">Рассадка</span>
                <Button
                  disabled={isLoading || isSaving || isAutoAssigning}
                  onClick={handleEditTablesAfterSeating}
                  size="sm"
                  variant="secondary"
                >
                  Редактировать столы
                </Button>
                <span className="seat-toolbar__sep" />
                <SeatingCapacitySummary
                  capacityLimit={capacityLimit}
                  occupiedSeats={slot.bucket.occupiedSeats}
                  physicalSeatCount={geometry.physicalSeatCount}
                  reserveSeats={placedReserveCount}
                  leadingParts={[`${tables.length} стол.`]}
                  trailingParts={[
                    `раввинский резерв ${rabbiReserveCount}`,
                    `${unassignedGuestPool.length} не рассажены`,
                    "фигура зафиксирована",
                  ]}
                />
                {capacitySyncButton}
              </div>
            ) : (
              <SeatingToolbar
                hasSelectedTable={Boolean(selectedTable)}
                isLoading={isLoading}
                onAddTable={handleAddTable}
                onRemoveTable={handleRemoveTable}
                onRotateTable={handleRotateTable}
                onSetAllSideSeats={handleSetAllSideSeats}
                onToggleSelectedSideSeats={handleToggleSelectedSideSeats}
                removeDisabled={!selectedTable || tables.length <= 1}
                selectedTableSideSeats={selectedTable ? tableSideSeats(selectedTable) : null}
                statusSummary={
                  <>
                    <SeatingCapacitySummary
                      capacityLimit={capacityLimit}
                      occupiedSeats={slot.bucket.occupiedSeats}
                      physicalSeatCount={geometry.physicalSeatCount}
                      reserveSeats={placedReserveCount}
                      leadingParts={[`${tables.length} стол.`]}
                      trailingParts={[
                        `${geometry.seams.length} стык.`,
                        seatsModeLabel,
                        `раввинский резерв ${rabbiReserveCount}`,
                        "фигура без рассадки",
                      ]}
                    />
                    {capacitySyncButton}
                  </>
                }
                tableCount={tables.length}
                variant="layout"
              />
            )}

            {isSeatingDone && reconcileNotice ? (
              <div className="seat-reconcile-status" role="status">
                После изменения схемы сохранено {reconcileNotice.keptCount} посадок,{" "}
                {reconcileNotice.returnedCount} гостей/резервов вернулись в список.
              </div>
            ) : null}
          </div>

          <aside className="seat-side-panel">
            <SeatingAssignmentsPanel
              canAddReserve={manualSeatingEnabled}
              error={guestPoolError}
              guests={visibleGuestPool}
              isSeatingDone={isSeatingDone}
              isLoading={isGuestPoolLoading}
              manualSeatingEnabled={manualSeatingEnabled}
              onAddReserve={handleAddReserve}
              onDeleteReserve={handleDeleteReserve}
              onGuestDragEnd={handleManualDragEnd}
              onGuestDragStart={handleGuestDragStart}
              onPoolDrop={handlePoolDrop}
              onReserveDragEnd={handleManualDragEnd}
              onReserveDragStart={handleReserveDragStart}
              reserves={pooledReserves}
              warning={guestPoolWarning}
            />

            <section className="seat-layout-panel">
              <h4>Фигура столов</h4>
              <p className="seat-layout-note">
                Пустые серые кружки показывают потенциальные физические места.
                Раввинский стол подсвечен золотым; головное место отмечено звездой.
              </p>
              <div className="seat-legend">
                <span>
                  <i className="seat-legend__empty" /> Потенциальное место
                </span>
                <span>
                  <i className="seat-legend__rabbi" /> Раввинский резерв
                </span>
                <span>
                  <i className="seat-legend__head" /> Головное место
                </span>
              </div>
            </section>
          </aside>
        </div>
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
    </div>,
    document.body,
  );
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

  return error instanceof Error
    ? error.message
    : "Не удалось сохранить схему рассадки.";
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

  return "Не удалось сохранить рассадку. Обновите данные и попробуйте ещё раз.";
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

function templateIdForSavePayload(value: SeatingTemplateValue): string | null {
  return parseUserSeatingTemplateValue(value);
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

function createEditorTable({
  angle = 0,
  cx = TABLE_START_CX,
  cy = TABLE_START_CY,
  h = TABLE_H,
  isRabbiTable = false,
  sideSeats = 3,
  w = TABLE_W,
}: Partial<SeatingTable> = {}): SeatingTable {
  return {
    angle: normalizeAngle(angle),
    cx,
    cy,
    h: h > 0 ? h : TABLE_H,
    id: createClientTableId(),
    isRabbiTable,
    sideSeats: sideSeats === 2 ? 2 : 3,
    w: w > 0 ? w : TABLE_W,
  };
}

function createClientTableId(): string {
  clientTableSequence += 1;
  return `table_${Date.now().toString(36)}_${clientTableSequence.toString(36)}`;
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

function normalizeEditorTables(tables: SeatingTable[]): SeatingTable[] {
  const normalizedTables = tables
    .filter((table) => table.id)
    .map((table) =>
      clampTableToCanvasStart({
        angle: normalizeAngle(table.angle || 0),
        cx: Number.isFinite(table.cx) ? table.cx : TABLE_START_CX,
        cy: Number.isFinite(table.cy) ? table.cy : TABLE_START_CY,
        h: table.h > 0 ? table.h : TABLE_H,
        id: table.id,
        isRabbiTable: Boolean(table.isRabbiTable),
        sideSeats: table.sideSeats === 2 ? 2 : 3,
        w: table.w > 0 ? table.w : TABLE_W,
      }),
    );

  return ensureOneRabbiTable(
    normalizedTables.length > 0
      ? normalizedTables
      : [createEditorTable({ isRabbiTable: true })],
  );
}

function ensureOneRabbiTable(tables: SeatingTable[]): SeatingTable[] {
  if (tables.length === 0) {
    return [];
  }

  const rabbiIndex = Math.max(
    0,
    tables.findIndex((table) => table.isRabbiTable),
  );

  return tables.map((table, index) => ({
    ...table,
    isRabbiTable: index === rabbiIndex,
  }));
}

function clampTableToCanvasStart(table: SeatingTable): SeatingTable {
  const bounds = tableBounds(table);
  const dx = bounds.minX < TABLE_MIN_PADDING ? TABLE_MIN_PADDING - bounds.minX : 0;
  const dy = bounds.minY < TABLE_MIN_PADDING ? TABLE_MIN_PADDING - bounds.minY : 0;

  return dx || dy ? { ...table, cx: table.cx + dx, cy: table.cy + dy } : table;
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

function formatSeatsMode(tables: SeatingTable[]): string {
  if (tables.length === 0) {
    return "нет столов";
  }

  const allTwo = tables.every((table) => tableSideSeats(table) === 2);
  const allThree = tables.every((table) => tableSideSeats(table) === 3);

  if (allTwo) {
    return "2 места/стор.";
  }

  if (allThree) {
    return "3 места/стор.";
  }

  return "смешанная вместимость";
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
