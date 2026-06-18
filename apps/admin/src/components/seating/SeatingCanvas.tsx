import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  CSSProperties,
  DragEvent as ReactDragEvent,
  PointerEvent as ReactPointerEvent,
} from "react";

import type {
  SeatingConnection,
  SeatingGeometryResult,
  SeatingSeatOccupant,
  SeatingTable,
} from "../../types/seating";

const SEAT_SIZE = 34;
const MIN_CANVAS_WIDTH = 360;
const MIN_CANVAS_HEIGHT = 260;
const MIN_SCALE = 0.35;
const MAX_SCALE = 1.5;
const SCALE_STEP = 0.1;

type DragState = {
  id: string;
  origCx: number;
  origCy: number;
  startX: number;
  startY: number;
};

export function SeatingCanvas({
  cancelVersion,
  connections,
  geometry,
  isSeatingDone,
  manualSeatingEnabled = false,
  onMoveTable,
  onSeatDragEnd,
  onSeatDragStart,
  onSeatDrop,
  onSelectTable,
  occupants,
  selectedTableId,
  tables,
}: {
  cancelVersion?: number;
  connections: SeatingConnection[];
  geometry: SeatingGeometryResult;
  isSeatingDone: boolean;
  /** PR 15: when true, occupied seats can be dragged and seats accept drops. */
  manualSeatingEnabled?: boolean;
  onMoveTable: (tableId: string, center: { cx: number; cy: number }) => void;
  onSeatDragEnd?: () => void;
  onSeatDragStart?: (seatIndex: number) => void;
  onSeatDrop?: (seatIndex: number) => void;
  onSelectTable: (tableId: string) => void;
  occupants: SeatingSeatOccupant[];
  selectedTableId: string | null;
  tables: SeatingTable[];
}) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [scale, setScale] = useState(1);
  const [dropTargetSeatIndex, setDropTargetSeatIndex] = useState<number | null>(null);
  const [draggingSeatIndex, setDraggingSeatIndex] = useState<number | null>(null);

  const canvasWidth = Math.max(MIN_CANVAS_WIDTH, Math.ceil(geometry.width));
  const canvasHeight = Math.max(MIN_CANVAS_HEIGHT, Math.ceil(geometry.height));

  const connectedTableIds = useMemo(() => {
    const ids = new Set<string>();
    connections.forEach((connection) => {
      ids.add(connection.aTableId);
      ids.add(connection.bTableId);
    });
    return ids;
  }, [connections]);

  const occupantsBySeat = useMemo(() => {
    const bySeat = new Map<number, SeatingSeatOccupant>();
    occupants.forEach((occupant) => {
      bySeat.set(occupant.seatIndex, occupant);
    });
    return bySeat;
  }, [occupants]);

  const fitSeatCanvas = useCallback(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;

    if (!wrap || !canvas) {
      return;
    }

    const availableWidth = Math.max(120, wrap.clientWidth - 24);
    const availableHeight = Math.max(
      120,
      (wrap.clientHeight || Math.round(window.innerHeight * 0.7)) - 24,
    );
    let nextScale = Math.min(availableWidth / canvasWidth, availableHeight / canvasHeight);

    if (!Number.isFinite(nextScale) || nextScale <= 0) {
      nextScale = 1;
    }

    setScale(clampScale(nextScale));
  }, [canvasHeight, canvasWidth]);

  useLayoutEffect(() => {
    fitSeatCanvas();
  }, [fitSeatCanvas]);

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) {
      return undefined;
    }

    const resizeObserver =
      typeof ResizeObserver !== "undefined" ? new ResizeObserver(fitSeatCanvas) : null;
    resizeObserver?.observe(wrap);
    window.addEventListener("resize", fitSeatCanvas);

    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener("resize", fitSeatCanvas);
    };
  }, [fitSeatCanvas]);

  useEffect(() => {
    if (!drag) {
      return undefined;
    }

    const handlePointerMove = (event: PointerEvent) => {
      const currentScale = getCanvasScale(canvasRef.current);
      const dx = (event.clientX - drag.startX) / currentScale;
      const dy = (event.clientY - drag.startY) / currentScale;
      onMoveTable(drag.id, {
        cx: drag.origCx + dx,
        cy: drag.origCy + dy,
      });
    };
    const handlePointerUp = () => setDrag(null);

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp, { once: true });

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [drag, onMoveTable]);

  useEffect(() => {
    if (cancelVersion === undefined) {
      return;
    }

    setDrag(null);
    setDropTargetSeatIndex(null);
    setDraggingSeatIndex(null);
  }, [cancelVersion]);

  const handleZoomOut = useCallback(() => {
    setScale((currentScale) => clampScale(currentScale - SCALE_STEP));
  }, []);

  const handleZoomIn = useCallback(() => {
    setScale((currentScale) => clampScale(currentScale + SCALE_STEP));
  }, []);

  const handleTablePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>, table: SeatingTable) => {
      if (isSeatingDone) {
        return;
      }

      if (event.button !== 0) {
        return;
      }

      event.preventDefault();
      onSelectTable(table.id);
      setDrag({
        id: table.id,
        origCx: table.cx,
        origCy: table.cy,
        startX: event.clientX,
        startY: event.clientY,
      });
    },
    [isSeatingDone, onSelectTable],
  );

  const handleSeatDragStart = useCallback(
    (event: ReactDragEvent<HTMLSpanElement>, seatIndex: number) => {
      if (!manualSeatingEnabled || !onSeatDragStart) {
        return;
      }
      // dataTransfer must carry something for Firefox to start the drag; the
      // actual source/target handoff is kept in React state, not the payload.
      event.dataTransfer.setData("text/plain", `seat:${seatIndex}`);
      event.dataTransfer.effectAllowed = "move";
      setDraggingSeatIndex(seatIndex);
      onSeatDragStart(seatIndex);
    },
    [manualSeatingEnabled, onSeatDragStart],
  );

  const handleSeatDragOver = useCallback(
    (event: ReactDragEvent<HTMLDivElement>, seatIndex: number) => {
      if (!manualSeatingEnabled) {
        return;
      }
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      setDropTargetSeatIndex(seatIndex);
    },
    [manualSeatingEnabled],
  );

  const handleSeatDragLeave = useCallback((seatIndex: number) => {
    setDropTargetSeatIndex((current) => (current === seatIndex ? null : current));
  }, []);

  const handleSeatDrop = useCallback(
    (event: ReactDragEvent<HTMLDivElement>, seatIndex: number) => {
      if (!manualSeatingEnabled || !onSeatDrop) {
        return;
      }
      event.preventDefault();
      setDropTargetSeatIndex(null);
      setDraggingSeatIndex(null);
      onSeatDrop(seatIndex);
    },
    [manualSeatingEnabled, onSeatDrop],
  );

  const handleSeatDragEnd = useCallback(() => {
    setDraggingSeatIndex(null);
    setDropTargetSeatIndex(null);
    onSeatDragEnd?.();
  }, [onSeatDragEnd]);

  const canvasStyle: CSSProperties = {
    height: canvasHeight,
    transform: `scale(${scale})`,
    width: canvasWidth,
  };
  const viewportStyle: CSSProperties = {
    height: Math.ceil(canvasHeight * scale),
    width: Math.ceil(canvasWidth * scale),
  };
  const scalePercent = Math.round(scale * 100);

  return (
    <div className="seat-canvas-wrap" ref={wrapRef}>
      <div aria-label="Масштаб схемы" className="seat-canvas-tools">
        <button
          aria-label="Уменьшить схему"
          className="seat-canvas-tool"
          disabled={scale <= MIN_SCALE}
          onClick={handleZoomOut}
          title="Уменьшить схему"
          type="button"
        >
          -
        </button>
        <span aria-live="polite" className="seat-canvas-scale">
          {scalePercent}%
        </span>
        <button
          aria-label="Увеличить схему"
          className="seat-canvas-tool"
          disabled={scale >= MAX_SCALE}
          onClick={handleZoomIn}
          title="Увеличить схему"
          type="button"
        >
          +
        </button>
        <button
          className="seat-canvas-tool seat-canvas-tool--fit"
          onClick={fitSeatCanvas}
          title="Подогнать схему под видимую область"
          type="button"
        >
          По размеру
        </button>
      </div>
      <div className="seat-canvas-viewport" style={viewportStyle}>
        <div
        aria-label="Конструктор схемы столов"
        className="seat-canvas"
        ref={canvasRef}
        role="application"
        style={canvasStyle}
        >
          {tables.map((table, index) => {
          const selected = !isSeatingDone && table.id === selectedTableId;
          const sideSeats = table.sideSeats === 2 ? 2 : 3;
          const tableStyle: CSSProperties = {
            height: table.h,
            left: table.cx - table.w / 2,
            top: table.cy - table.h / 2,
            transform: `rotate(${table.angle || 0}deg)`,
            width: table.w,
          };

          return (
            <div
              aria-pressed={isSeatingDone ? undefined : selected}
              className={[
                "seat-table",
                isSeatingDone ? "seat-table--locked" : "seat-table--editable",
                selected ? "seat-table--selected" : "",
                connectedTableIds.has(table.id) ? "seat-table--connected" : "",
                table.isRabbiTable ? "seat-table--rabbi" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              key={table.id}
              onKeyDown={(event) => {
                if (isSeatingDone) {
                  return;
                }

                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onSelectTable(table.id);
                }
              }}
              onPointerDown={(event) => handleTablePointerDown(event, table)}
              role={isSeatingDone ? "img" : "button"}
              style={tableStyle}
              tabIndex={isSeatingDone ? -1 : 0}
              title={`Стол ${index + 1}. Перетащите стол по схеме; поворот — кнопкой ↻ 90°.`}
            >
              <span className="seat-table__label">
                {table.isRabbiTable ? (
                  <span className="seat-table__role">Раввинский стол</span>
                ) : null}
                Стол {index + 1}
                {table.isRabbiTable ? null : ` · ${table.angle || 0}°`}
                <span className="seat-table__size">{sideSeats} места/стор.</span>
              </span>
            </div>
          );
        })}

          {geometry.seams.map((seam, index) => (
          <span
            className="seat-seam"
            key={`${seam.x}:${seam.y}:${index}`}
            style={{ left: seam.x, top: seam.y }}
            title="Торцы соединены: посадка на этом торце отключена"
          />
        ))}

          {geometry.seats.map((seat, index) => {
          const isHead = index === geometry.headIndex;
          const occupant = occupantsBySeat.get(index);
          const isOccupied = Boolean(occupant);
          const isDropTarget = manualSeatingEnabled && dropTargetSeatIndex === index;
          const occupantDraggable = manualSeatingEnabled && isOccupied;

          return (
            <div
              aria-label={occupant ? occupant.displayName : undefined}
              className={[
                "seat",
                isOccupied ? "seat--occupied" : "seat--empty",
                occupant?.type === "reserve" ? "seat--reserve" : "",
                !isSeatingDone ? "seat--preview" : "",
                seat.isRabbiTable ? "seat--rabbi-reserved" : "",
                occupant?.isRabbiHead ? "seat--rabbi-head" : "",
                isDropTarget ? "seat--drop" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              key={`${seat.tableId}:${seat.kind}:${seat.edge ?? seat.end ?? "seat"}:${seat.slot ?? index}`}
              onDragLeave={manualSeatingEnabled ? () => handleSeatDragLeave(index) : undefined}
              onDragOver={manualSeatingEnabled ? (event) => handleSeatDragOver(event, index) : undefined}
              onDrop={manualSeatingEnabled ? (event) => handleSeatDrop(event, index) : undefined}
              style={{
                left: seat.x - SEAT_SIZE / 2,
                top: seat.y - SEAT_SIZE / 2,
              }}
              title={occupant ? occupant.displayName : (
                seat.isRabbiTable
                  ? "Потенциальное место раввинского стола"
                  : "Потенциальное физическое место"
              )}
            >
              {occupant ? (
                <span
                  className={[
                    "seat-occupant",
                    occupant.isRabbiHead
                      ? "seat-occupant--rabbi"
                      : occupant.type === "reserve"
                        ? "seat-occupant--reserve"
                        : "seat-occupant--guest",
                    occupantDraggable ? "seat-occupant--draggable" : "",
                    draggingSeatIndex === index ? "seat-occupant--dragging" : "",
                    occupant.locked ? "seat-occupant--locked" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  draggable={occupantDraggable}
                  onDragEnd={occupantDraggable ? handleSeatDragEnd : undefined}
                  onDragStart={
                    occupantDraggable ? (event) => handleSeatDragStart(event, index) : undefined
                  }
                  title={
                    occupantDraggable
                      ? `${occupant.displayName} · перетащите на свободное место или в «Не рассажены»`
                      : occupant.displayName
                  }
                >
                  {occupant.initials}
                </span>
              ) : null}
              {!occupant && isHead ? (
                <span aria-label="Головное место раввина" className="seat-head-mark">
                  ★
                </span>
              ) : null}
            </div>
          );
        })}
        </div>
      </div>
    </div>
  );
}

function getCanvasScale(canvas: HTMLDivElement | null): number {
  if (!canvas) {
    return 1;
  }

  const rect = canvas.getBoundingClientRect();
  return rect.width && canvas.offsetWidth ? rect.width / canvas.offsetWidth : 1;
}

function clampScale(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return 1;
  }

  const rounded = Math.round(value * 100) / 100;
  return Math.max(MIN_SCALE, Math.min(MAX_SCALE, rounded));
}
