import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { createPortal } from "react-dom";

import { formatDateTime } from "../registrations/formatters";
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
  getSeatingLayout,
  saveSeatingLayout,
} from "../../services/adminSeatingService";
import type { AdminEventOccurrence } from "../../types/eventOccurrences";
import type { AdminRegistrationCapacityBucket } from "../../types/registrationCapacity";
import type { AdminRegistrationEventSummary } from "../../types/registrations";
import type {
  SeatingConnection,
  SeatingTable,
} from "../../types/seating";
import { SeatingCanvas } from "./SeatingCanvas";
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
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [selectedTableId, setSelectedTableId] = useState<string | null>(null);
  const [tables, setTables] = useState<SeatingTable[]>([]);

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
      setConnections([]);
      setSelectedTableId(null);
      setTables([]);
      return undefined;
    }

    let cancelled = false;

    setFeedback({ message: "Загружаем схему...", tone: "muted" });
    setIsLoading(true);
    setIsSaving(false);

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
  const saveDisabled = !slot || tables.length === 0;

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

  const handleSave = useCallback(() => {
    if (!slot || tables.length === 0) {
      return;
    }

    const nextTables = ensureOneRabbiTable(tables);
    const nextConnections = filterConnectionsForTables(connections, nextTables);

    setIsSaving(true);
    setFeedback({ message: "Сохраняем схему...", tone: "muted" });

    void saveSeatingLayout({
      activeTemplateId: "builtin:blank",
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
      selectedTableId: selectedTableId ?? pickSelectedTableId(nextTables),
      tableConnections: nextConnections,
    })
      .then(() => {
        setTables(nextTables);
        setConnections(nextConnections);
        setSelectedTableId(selectedTableId ?? pickSelectedTableId(nextTables));
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
  }, [capacityLimit, connections, selectedTableId, slot, tables]);

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

        <SeatingToolbar
          isLoading={isLoading}
          isSaving={isSaving}
          onSave={handleSave}
          saveDisabled={saveDisabled}
          statusMessage={feedback?.message ?? null}
          statusTone={feedback?.tone ?? "muted"}
          variant="templates"
        />

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

function createEditorTable({
  angle = 0,
  cx = TABLE_START_CX,
  cy = TABLE_START_CY,
  isRabbiTable = false,
  sideSeats = 3,
}: Partial<SeatingTable> = {}): SeatingTable {
  return {
    angle: normalizeAngle(angle),
    cx,
    cy,
    h: TABLE_H,
    id: createClientTableId(),
    isRabbiTable,
    sideSeats: sideSeats === 2 ? 2 : 3,
    w: TABLE_W,
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
