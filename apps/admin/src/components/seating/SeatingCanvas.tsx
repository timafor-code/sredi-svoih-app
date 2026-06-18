import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";

import type {
  SeatingConnection,
  SeatingGeometryResult,
  SeatingSeatOccupant,
  SeatingTable,
} from "../../types/seating";

const SEAT_SIZE = 34;
const MIN_CANVAS_WIDTH = 360;
const MIN_CANVAS_HEIGHT = 260;

type DragState = {
  id: string;
  origCx: number;
  origCy: number;
  startX: number;
  startY: number;
};

export function SeatingCanvas({
  connections,
  geometry,
  isSeatingDone,
  onMoveTable,
  onSelectTable,
  occupants,
  selectedTableId,
  tables,
}: {
  connections: SeatingConnection[];
  geometry: SeatingGeometryResult;
  isSeatingDone: boolean;
  onMoveTable: (tableId: string, center: { cx: number; cy: number }) => void;
  onSelectTable: (tableId: string) => void;
  occupants: SeatingSeatOccupant[];
  selectedTableId: string | null;
  tables: SeatingTable[];
}) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [scale, setScale] = useState(1);

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

    setScale(Math.max(0.35, Math.min(1.25, nextScale)));
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

  const canvasStyle: CSSProperties = {
    height: canvasHeight,
    transform: `scale(${scale})`,
    width: canvasWidth,
  };

  return (
    <div className="seat-canvas-wrap" ref={wrapRef}>
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

          return (
            <div
              aria-label={occupant ? occupant.displayName : undefined}
              className={[
                "seat",
                isOccupied ? "seat--occupied" : "seat--empty",
                !isSeatingDone ? "seat--preview" : "",
                seat.isRabbiTable ? "seat--rabbi-reserved" : "",
                occupant?.isRabbiHead ? "seat--rabbi-head" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              key={`${seat.tableId}:${seat.kind}:${seat.edge ?? seat.end ?? "seat"}:${seat.slot ?? index}`}
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
                    occupant.isRabbiHead ? "seat-occupant--rabbi" : "seat-occupant--guest",
                  ]
                    .filter(Boolean)
                    .join(" ")}
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
  );
}

function getCanvasScale(canvas: HTMLDivElement | null): number {
  if (!canvas) {
    return 1;
  }

  const rect = canvas.getBoundingClientRect();
  return rect.width && canvas.offsetWidth ? rect.width / canvas.offsetWidth : 1;
}
