import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { createPortal } from "react-dom";

import { formatDateTime } from "../registrations/formatters";
import { Button } from "../ui/Button";
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
  createSeatingTemplateFromLayout,
  deleteSeatingTemplate,
  getSeatingLayout,
  listSeatingTemplates,
  saveSeatingLayout,
} from "../../services/adminSeatingService";
import type { AdminEventOccurrence } from "../../types/eventOccurrences";
import type { AdminRegistrationCapacityBucket } from "../../types/registrationCapacity";
import type { AdminRegistrationEventSummary } from "../../types/registrations";
import type {
  SeatingConnection,
  SeatingLayoutRow,
  SeatingTable,
  SeatingTemplate,
} from "../../types/seating";
import { SeatingCanvas } from "./SeatingCanvas";
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

export function SeatingLayoutEditor({
  onClose,
  slot,
}: {
  onClose: () => void;
  slot: SeatingLayoutEditorSlot | null;
}) {
  const [connections, setConnections] = useState<SeatingConnection[]>([]);
  const [feedback, setFeedback] = useState<EditorFeedback | null>(null);
  const [activeTemplateValue, setActiveTemplateValue] =
    useState<SeatingTemplateValue>(DEFAULT_SEATING_TEMPLATE_VALUE);
  const [isApplyingTemplate, setIsApplyingTemplate] = useState(false);
  const [isDeletingTemplate, setIsDeletingTemplate] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isSavingTemplate, setIsSavingTemplate] = useState(false);
  const [isTemplateListLoading, setIsTemplateListLoading] = useState(false);
  const [selectedTableId, setSelectedTableId] = useState<string | null>(null);
  const [tables, setTables] = useState<SeatingTable[]>([]);
  const [templates, setTemplates] = useState<SeatingTemplate[]>([]);

  useEffect(() => {
    if (!slot) {
      return undefined;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose, slot]);

  useEffect(() => {
    if (!slot) {
      setActiveTemplateValue(DEFAULT_SEATING_TEMPLATE_VALUE);
      setConnections([]);
      setSelectedTableId(null);
      setTables([]);
      return undefined;
    }

    let cancelled = false;

    setFeedback({ message: "Загружаем схему...", tone: "muted" });
    setActiveTemplateValue(DEFAULT_SEATING_TEMPLATE_VALUE);
    setIsLoading(true);
    setIsApplyingTemplate(false);
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
        setActiveTemplateValue(
          layout?.templateId
            ? userSeatingTemplateValue(layout.templateId)
            : DEFAULT_SEATING_TEMPLATE_VALUE,
        );
        setSelectedTableId(pickSelectedTableId(nextTables));
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

  const capacityLimit = slot?.bucket.effectiveCapacity ?? slot?.bucket.capacity ?? null;
  const capacityLabel = formatCapacityLimit(capacityLimit);
  const seatsModeLabel = useMemo(() => formatSeatsMode(tables), [tables]);
  const slotTitle = slot ? formatSlotTitle(slot) : "Схема рассадки";
  const slotSubtitle = slot ? formatSlotSubtitle(slot) : null;
  const hasValidGeometry = tables.length > 0 && countRabbiTables(tables) === 1;
  const isTemplateBusy =
    isApplyingTemplate ||
    isDeletingTemplate ||
    isSavingTemplate;
  const saveDisabled = !slot || !hasValidGeometry || isTemplateBusy;

  const handleAddTable = useCallback(() => {
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
  }, [selectedTableId, tables]);

  const handleMoveTable = useCallback(
    (tableId: string, center: { cx: number; cy: number }) => {
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
    [],
  );

  const handleRemoveTable = useCallback(() => {
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
  }, [selectedTableId, tables]);

  const handleRotateTable = useCallback(() => {
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
  }, [selectedTableId]);

  const handleToggleSelectedSideSeats = useCallback(() => {
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
  }, [selectedTableId]);

  const handleSetAllSideSeats = useCallback((sideSeats: 2 | 3) => {
    setTables((currentTables) =>
      ensureOneRabbiTable(currentTables.map((table) => ({ ...table, sideSeats }))),
    );
  }, []);

  const saveLayoutGeometry = useCallback(
    async ({
      nextConnections,
      nextSelectedTableId,
      nextTables,
      templateValue,
    }: {
      nextConnections: SeatingConnection[];
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
        seatingDone: false,
        selectedTableId: nextSelectedTableId,
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
      if (!slot || value === activeTemplateValue) {
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
      saveLayoutGeometry,
      slot,
      templates,
    ],
  );

  const handleSaveTemplate = useCallback(() => {
    if (!slot || !hasValidGeometry) {
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
      nextSelectedTableId,
      nextTables,
      templateValue: activeTemplateValue,
    })
      .then((nextLayout) => {
        commitGeometry({
          nextConnections,
          nextSelectedTableId,
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
    const nextSelectedTableId = selectedTableId ?? pickSelectedTableId(nextTables);

    setIsSaving(true);
    setFeedback({ message: "Сохраняем схему...", tone: "muted" });

    void saveLayoutGeometry({
      nextConnections,
      nextSelectedTableId,
      nextTables,
      templateValue: activeTemplateValue,
    })
      .then(() => {
        commitGeometry({
          nextConnections,
          nextSelectedTableId,
          nextTables,
          templateValue: activeTemplateValue,
        });
        setFeedback({ message: "Схема сохранена.", tone: "success" });
      })
      .catch((error) => {
        setFeedback({
          message:
            error instanceof Error
              ? error.message
              : "Не удалось сохранить схему рассадки.",
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
    hasValidGeometry,
    saveLayoutGeometry,
    selectedTableId,
    slot,
    tables,
  ]);

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
            canSaveTemplate={hasValidGeometry}
            disabled={isLoading || isSaving}
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
                onMoveTable={handleMoveTable}
                onSelectTable={setSelectedTableId}
                selectedTableId={selectedTableId}
                tables={tables}
              />
            )}

            <SeatingToolbar
              capacityLabel={capacityLabel}
              hasSelectedTable={Boolean(selectedTable)}
              isLoading={isLoading}
              onAddTable={handleAddTable}
              onRemoveTable={handleRemoveTable}
              onRotateTable={handleRotateTable}
              onSetAllSideSeats={handleSetAllSideSeats}
              onToggleSelectedSideSeats={handleToggleSelectedSideSeats}
              physicalSeatCount={geometry.physicalSeatCount}
              rabbiReserveCount={geometry.seats.filter((seat) => seat.isRabbiTable).length}
              removeDisabled={!selectedTable || tables.length <= 1}
              seamCount={geometry.seams.length}
              seatsModeLabel={seatsModeLabel}
              selectedTableSideSeats={selectedTable ? tableSideSeats(selectedTable) : null}
              tableCount={tables.length}
              variant="layout"
            />
          </div>

          <aside className="seat-layout-panel">
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
          </aside>
        </div>
      </section>
    </div>,
    document.body,
  );
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

function formatCapacityLimit(capacity: number | null): string {
  return capacity === null
    ? "без лимита"
    : `лимит ${new Intl.NumberFormat("ru-RU").format(capacity)}`;
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
