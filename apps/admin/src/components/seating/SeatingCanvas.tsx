import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, DragEvent as ReactDragEvent, PointerEvent as ReactPointerEvent } from "react";

import { band, createSeatingSpring, projectVelocity, type SeatingSpring } from "../../lib/seatingMotion";
import type { SeatingConnection, SeatingGeometryResult, SeatingSeatOccupant, SeatingTable } from "../../types/seating";

const SEAT_SIZE = 34;
const MIN_CANVAS_WIDTH = 360;
const MIN_CANVAS_HEIGHT = 260;
const MIN_SCALE = 0.35;
const MAX_SCALE = 1.5;
const SCALE_STEP = 0.1;

type CanvasView = { scale: number; autoFit: boolean; panX: number; panY: number };
type DragState = { id: string; origCx: number; origCy: number; startX: number; startY: number; moved: boolean };
type PanState = { pointerId: number; startX: number; startY: number; panX: number; panY: number; samples: Array<{ t: number; x: number; y: number }> };
type SpringKey = "scale" | "panX" | "panY";

export function SeatingCanvas({ cancelVersion, connections, geometry, isSeatingDone, manualSeatingEnabled = false, onMoveTable, onSeatDragEnd, onSeatDragStart, onSeatDrop, onSelectTable, onToggleSeat, occupants, seatEditEnabled = false, selectedTableId, tables }: {
  cancelVersion?: number;
  connections: SeatingConnection[];
  geometry: SeatingGeometryResult;
  isSeatingDone: boolean;
  manualSeatingEnabled?: boolean;
  onMoveTable: (tableId: string, center: { cx: number; cy: number }) => void;
  onSeatDragEnd?: () => void;
  onSeatDragStart?: (seatIndex: number) => void;
  onSeatDrop?: (seatIndex: number) => void;
  onSelectTable: (tableId: string) => void;
  onToggleSeat?: (seatIndex: number) => void;
  occupants: SeatingSeatOccupant[];
  seatEditEnabled?: boolean;
  selectedTableId: string | null;
  tables: SeatingTable[];
}) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [pan, setPan] = useState<PanState | null>(null);
  const [view, setView] = useState<CanvasView>({ scale: 1, autoFit: true, panX: 0, panY: 0 });
  const viewRef = useRef(view);
  const springsRef = useRef<Partial<Record<SpringKey, SeatingSpring>>>({});
  const pendingFitRef = useRef(false);
  const [dropTargetSeatIndex, setDropTargetSeatIndex] = useState<number | null>(null);
  const [draggingSeatIndex, setDraggingSeatIndex] = useState<number | null>(null);
  const canvasWidth = Math.max(MIN_CANVAS_WIDTH, Math.ceil(geometry.width));
  const canvasHeight = Math.max(MIN_CANVAS_HEIGHT, Math.ceil(geometry.height));

  const connectedTableIds = useMemo(() => new Set(connections.flatMap((connection) => [connection.aTableId, connection.bTableId])), [connections]);
  const occupantsBySeat = useMemo(() => new Map(occupants.map((occupant) => [occupant.seatIndex, occupant])), [occupants]);
  const updateView = useCallback((patch: Partial<CanvasView>) => { viewRef.current = { ...viewRef.current, ...patch }; setView(viewRef.current); }, []);
  const stopSpring = useCallback((key: SpringKey) => { springsRef.current[key]?.stop(); delete springsRef.current[key]; }, []);
  const springTo = useCallback((key: SpringKey, target: number, config: { response: number; eps: number; vEps: number; velocity?: number }) => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) { stopSpring(key); updateView({ [key]: target }); return; }
    const existing = springsRef.current[key];
    if (existing?.isRunning()) { existing.setTarget(target); return; }
    springsRef.current[key] = createSeatingSpring({ from: viewRef.current[key], target, response: config.response, damping: 1, velocity: config.velocity, eps: config.eps, vEps: config.vEps, onUpdate: (value) => updateView({ [key]: value }) });
  }, [stopSpring, updateView]);
  const fitTarget = useCallback(() => {
    const wrap = wrapRef.current;
    if (!wrap) return 1;
    const availableWidth = Math.max(120, wrap.clientWidth - 24);
    const availableHeight = Math.max(120, (wrap.clientHeight || Math.round(window.innerHeight * 0.7)) - 24);
    return clampScale(Math.min(availableWidth / canvasWidth, availableHeight / canvasHeight));
  }, [canvasHeight, canvasWidth]);
  const applyFit = useCallback(() => {
    if (drag) { pendingFitRef.current = true; return; }
    if (viewRef.current.autoFit) springTo("scale", fitTarget(), { response: 0.35, eps: 0.002, vEps: 0.02 });
  }, [drag, fitTarget, springTo]);

  useLayoutEffect(() => { applyFit(); }, [applyFit]);
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return undefined;
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(applyFit);
    observer?.observe(wrap); window.addEventListener("resize", applyFit);
    return () => { observer?.disconnect(); window.removeEventListener("resize", applyFit); };
  }, [applyFit]);
  useEffect(() => () => Object.values(springsRef.current).forEach((spring) => spring?.stop()), []);

  useEffect(() => {
    if (!drag) return undefined;
    const move = (event: PointerEvent) => {
      const dx = event.clientX - drag.startX;
      const dy = event.clientY - drag.startY;
      if (!drag.moved && Math.hypot(dx, dy) < 3) return;
      if (!drag.moved) setDrag((current) => current ? { ...current, moved: true } : null);
      const scale = getCanvasScale(canvasRef.current);
      onMoveTable(drag.id, { cx: drag.origCx + dx / scale, cy: drag.origCy + dy / scale });
    };
    const up = () => setDrag(null);
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", up, { once: true });
    return () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
  }, [drag, onMoveTable]);
  useEffect(() => { if (!drag && pendingFitRef.current) { pendingFitRef.current = false; applyFit(); } }, [applyFit, drag]);

  const finishPan = useCallback((state: PanState) => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    if (wrap.hasPointerCapture(state.pointerId)) wrap.releasePointerCapture(state.pointerId);
    const first = state.samples[0]; const last = state.samples.at(-1);
    const dt = first && last ? Math.max(0.001, (last.t - first.t) / 1000) : 1;
    const vx = first && last ? (last.x - first.x) / dt : 0;
    const vy = first && last ? (last.y - first.y) / dt : 0;
    const maxX = Math.max(200, wrap.clientWidth * 0.9); const maxY = Math.max(200, wrap.clientHeight * 0.9);
    springTo("panX", Math.max(-maxX, Math.min(maxX, viewRef.current.panX + projectVelocity(vx))), { response: 0.5, eps: 0.3, vEps: 3, velocity: vx });
    springTo("panY", Math.max(-maxY, Math.min(maxY, viewRef.current.panY + projectVelocity(vy))), { response: 0.5, eps: 0.3, vEps: 3, velocity: vy });
    setPan(null);
  }, [springTo]);
  useEffect(() => { const blur = () => { if (pan) finishPan(pan); }; window.addEventListener("blur", blur); return () => window.removeEventListener("blur", blur); }, [finishPan, pan]);
  useEffect(() => { if (cancelVersion !== undefined) { setDrag(null); setPan(null); setDropTargetSeatIndex(null); setDraggingSeatIndex(null); } }, [cancelVersion]);

  const zoom = useCallback((delta: number) => { const target = springsRef.current.scale?.getTarget() ?? viewRef.current.scale; updateView({ autoFit: false }); springTo("scale", clampScale(target + delta), { response: 0.35, eps: 0.002, vEps: 0.02 }); }, [springTo, updateView]);
  const resetZoom = useCallback(() => { updateView({ autoFit: false }); springTo("scale", 1, { response: 0.35, eps: 0.002, vEps: 0.02 }); }, [springTo, updateView]);
  const fit = useCallback(() => { updateView({ autoFit: true }); springTo("scale", fitTarget(), { response: 0.35, eps: 0.002, vEps: 0.02 }); springTo("panX", 0, { response: 0.35, eps: 0.3, vEps: 3 }); springTo("panY", 0, { response: 0.35, eps: 0.3, vEps: 3 }); }, [fitTarget, springTo, updateView]);

  const handleWrapPointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 1) return;
    event.preventDefault(); stopSpring("panX"); stopSpring("panY"); event.currentTarget.setPointerCapture(event.pointerId);
    setPan({ pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, panX: viewRef.current.panX, panY: viewRef.current.panY, samples: [{ t: event.timeStamp, x: event.clientX, y: event.clientY }] });
  }, [stopSpring]);
  const handleWrapPointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (!pan || event.pointerId !== pan.pointerId || !wrapRef.current) return;
    const wrap = wrapRef.current; const maxX = Math.max(200, wrap.clientWidth * 0.9); const maxY = Math.max(200, wrap.clientHeight * 0.9);
    updateView({ panX: band(pan.panX + event.clientX - pan.startX, maxX), panY: band(pan.panY + event.clientY - pan.startY, maxY) });
    setPan({ ...pan, samples: [...pan.samples, { t: event.timeStamp, x: event.clientX, y: event.clientY }].slice(-6) });
  }, [pan, updateView]);
  const handleWrapPointerEnd = useCallback((event: ReactPointerEvent<HTMLDivElement>) => { if (!pan || event.pointerId !== pan.pointerId) return; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); finishPan(pan); }, [finishPan, pan]);
  const handleTablePointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>, table: SeatingTable) => { if (isSeatingDone || event.button !== 0) return; event.preventDefault(); onSelectTable(table.id); setDrag({ id: table.id, origCx: table.cx, origCy: table.cy, startX: event.clientX, startY: event.clientY, moved: false }); }, [isSeatingDone, onSelectTable]);
  const handleSeatDragStart = useCallback((event: ReactDragEvent<HTMLSpanElement>, index: number) => { if (!manualSeatingEnabled || !onSeatDragStart) return; event.dataTransfer.setData("text/plain", `seat:${index}`); event.dataTransfer.effectAllowed = "move"; setDraggingSeatIndex(index); onSeatDragStart(index); }, [manualSeatingEnabled, onSeatDragStart]);
  const handleSeatDrop = useCallback((event: ReactDragEvent<HTMLDivElement>, index: number) => { if (!manualSeatingEnabled || !onSeatDrop) return; event.preventDefault(); setDropTargetSeatIndex(null); setDraggingSeatIndex(null); onSeatDrop(index); }, [manualSeatingEnabled, onSeatDrop]);

  const canvasStyle: CSSProperties = { height: canvasHeight, transform: `translate(${Math.round(view.panX)}px, ${Math.round(view.panY)}px) scale(${view.scale})`, width: canvasWidth };
  const scaleTarget = springsRef.current.scale?.getTarget() ?? view.scale;
  return <div className={["seat-canvas-wrap", pan ? "is-panning" : ""].filter(Boolean).join(" ")} ref={wrapRef} onAuxClick={(event) => { if (event.button === 1) event.preventDefault(); }} onMouseDown={(event) => { if (event.button === 1) event.preventDefault(); }} onPointerCancel={handleWrapPointerEnd} onPointerDown={handleWrapPointerDown} onPointerMove={handleWrapPointerMove} onPointerUp={handleWrapPointerEnd}>
    <div aria-label="Масштаб схемы" className="seat-canvas-tools">
      <button aria-label="Уменьшить схему" className="seat-canvas-tool" disabled={scaleTarget <= MIN_SCALE} onClick={() => zoom(-SCALE_STEP)} title="Уменьшить схему" type="button">-</button>
      <button aria-label="Сбросить масштаб до 100%" className="seat-canvas-scale" onClick={resetZoom} title="Сбросить масштаб до 100%" type="button">{Math.round(view.scale * 100)}%</button>
      <button aria-label="Увеличить схему" className="seat-canvas-tool" disabled={scaleTarget >= MAX_SCALE} onClick={() => zoom(SCALE_STEP)} title="Увеличить схему" type="button">+</button>
      <button className={["seat-canvas-tool", "seat-canvas-tool--fit", view.autoFit ? "is-on" : ""].filter(Boolean).join(" ")} onClick={fit} title="Подогнать схему под видимую область" type="button">По размеру</button>
    </div>
    <div className="seat-canvas-viewport" style={{ height: Math.ceil(canvasHeight * view.scale), width: Math.ceil(canvasWidth * view.scale) }}><div aria-label="Конструктор схемы столов" className="seat-canvas" ref={canvasRef} role="application" style={canvasStyle}>
      {tables.map((table, index) => { const selected = !isSeatingDone && table.id === selectedTableId; return <div aria-pressed={isSeatingDone ? undefined : selected} className={["seat-table", isSeatingDone ? "seat-table--locked" : "seat-table--editable", selected ? "seat-table--selected" : "", connectedTableIds.has(table.id) ? "seat-table--connected" : "", table.isRabbiTable ? "seat-table--rabbi" : ""].filter(Boolean).join(" ")} key={table.id} onKeyDown={(event) => { if (!isSeatingDone && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); onSelectTable(table.id); } }} onPointerDown={(event) => handleTablePointerDown(event, table)} role={isSeatingDone ? "img" : "button"} style={{ height: table.h, left: table.cx - table.w / 2, top: table.cy - table.h / 2, transform: `rotate(${table.angle || 0}deg)`, width: table.w }} tabIndex={isSeatingDone ? -1 : 0} title={`Стол ${index + 1}. Перетащите стол по схеме; поворот — кнопкой ↻ 90°.`}><span className="seat-table__label">{table.isRabbiTable ? <span className="seat-table__role">Раввинский стол</span> : null}Стол {index + 1}{table.isRabbiTable ? null : ` · ${table.angle || 0}°`}<span className="seat-table__size">{table.sideSeats === 2 ? 2 : 3} места/стор.</span></span></div>; })}
      {geometry.seams.map((seam, index) => <span className="seat-seam" key={`${seam.x}:${seam.y}:${index}`} style={{ left: seam.x, top: seam.y }} title="Торцы соединены: посадка на этом торце отключена" />)}
      {geometry.seats.map((seat, index) => {
        const isHead = index === geometry.headIndex; const occupant = seat.isDisabled ? undefined : occupantsBySeat.get(index); const isDropTarget = !seat.isDisabled && manualSeatingEnabled && dropTargetSeatIndex === index; const toggleable = Boolean(onToggleSeat);
        const title = occupant ? occupant.displayName : seat.isDisabled ? "Место выключено — не считается в схеме. Alt+клик или правая кнопка включит обратно" : isHead ? "Головное место раввина — авторассадка его не занимает" : seat.isRabbiTable ? "Раввинский резерв — только ручная посадка" : seat.kind === "end" ? "Торцевое место" : "Свободное место";
        return <div aria-label={occupant?.displayName} className={["seat", occupant ? "seat--occupied" : "seat--empty", seat.isDisabled ? "seat--disabled" : "", occupant?.type === "reserve" ? "seat--reserve" : "", !isSeatingDone ? "seat--preview" : "", toggleable ? "seat--toggleable" : "", seat.isRabbiTable ? "seat--rabbi-reserved" : "", occupant?.isRabbiHead ? "seat--rabbi-head" : "", isDropTarget ? "seat--drop" : ""].filter(Boolean).join(" ")} key={`${seat.tableId}:${seat.kind}:${seat.edge ?? seat.end ?? "seat"}:${seat.slot ?? index}`} onClick={toggleable ? (event) => { if (event.altKey || seatEditEnabled) onToggleSeat?.(index); } : undefined} onContextMenu={toggleable ? (event) => { event.preventDefault(); onToggleSeat?.(index); } : undefined} onDragLeave={manualSeatingEnabled ? () => setDropTargetSeatIndex((current) => current === index ? null : current) : undefined} onDragOver={manualSeatingEnabled ? (event) => { event.preventDefault(); event.dataTransfer.dropEffect = "move"; if (!seat.isDisabled) setDropTargetSeatIndex(index); } : undefined} onDrop={manualSeatingEnabled ? (event) => handleSeatDrop(event, index) : undefined} style={{ left: seat.x - SEAT_SIZE / 2, top: seat.y - SEAT_SIZE / 2 }} title={title}>
          {occupant ? <span className={["seat-occupant", occupant.isRabbiHead ? "seat-occupant--rabbi" : occupant.type === "reserve" ? "seat-occupant--reserve" : "seat-occupant--guest", manualSeatingEnabled ? "seat-occupant--draggable" : "", draggingSeatIndex === index ? "seat-occupant--dragging" : "", occupant.locked ? "seat-occupant--locked" : ""].filter(Boolean).join(" ")} draggable={manualSeatingEnabled} onDragEnd={manualSeatingEnabled ? () => { setDraggingSeatIndex(null); setDropTargetSeatIndex(null); onSeatDragEnd?.(); } : undefined} onDragStart={manualSeatingEnabled ? (event) => handleSeatDragStart(event, index) : undefined} title={manualSeatingEnabled ? `${occupant.displayName} · перетащите на свободное место или в «Не рассажены»` : occupant.displayName}>{occupant.initials}</span> : null}
          {!occupant && !seat.isDisabled && isHead ? <span aria-label="Головное место раввина" className="seat-head-mark">★</span> : null}
        </div>;
      })}
    </div></div>
  </div>;
}

function getCanvasScale(canvas: HTMLDivElement | null): number { if (!canvas) return 1; const rect = canvas.getBoundingClientRect(); return rect.width && canvas.offsetWidth ? rect.width / canvas.offsetWidth : 1; }
function clampScale(value: number): number { if (!Number.isFinite(value) || value <= 0) return 1; return Math.max(MIN_SCALE, Math.min(MAX_SCALE, Math.round(value * 100) / 100)); }
