import type { CSSProperties } from "react";

import type { SeatingPrintModel } from "../../types/seating";

const PRINT_SEAT_SIZE = 34;

export function SeatingPrintDocument({ model }: { model: SeatingPrintModel }) {
  const frameStyle: CSSProperties = {
    height: Math.ceil(model.canvas.height * model.canvas.scale),
    width: Math.ceil(model.canvas.width * model.canvas.scale),
  };
  const canvasStyle: CSSProperties = {
    height: model.canvas.height,
    transform: `scale(${model.canvas.scale})`,
    width: model.canvas.width,
  };

  return (
    <article aria-label="Печатная схема рассадки" className="seat-print-root">
      <header className="seat-print-header">
        <div className="seat-print-title">
          <span>Печать рассадки</span>
          <h1>{model.header.eventTitle}</h1>
          <p>{model.header.occurrenceSubtitle}</p>
        </div>
        <dl className="seat-print-meta">
          <div>
            <dt>Слот</dt>
            <dd>{model.header.capacityBucketTitle}</dd>
          </div>
          <div>
            <dt>Печать</dt>
            <dd>{model.header.printedAtLabel}</dd>
          </div>
        </dl>
      </header>

      <section className="seat-print-section seat-print-section--scheme">
        <h2>Схема</h2>
        <div className="seat-print-canvas-frame" style={frameStyle}>
          <div className="seat-print-canvas" style={canvasStyle}>
            {model.canvas.tables.map((table) => (
              <div
                className={[
                  "seat-print-table",
                  table.isRabbiTable ? "seat-print-table--rabbi" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                key={table.id}
                style={{
                  height: table.h,
                  left: table.cx - table.w / 2,
                  top: table.cy - table.h / 2,
                  transform: `rotate(${table.angle}deg)`,
                  width: table.w,
                }}
              >
                <span>{table.label}</span>
              </div>
            ))}

            {model.canvas.seams.map((seam, index) => (
              <span
                className="seat-print-seam"
                key={`${seam.x}:${seam.y}:${index}`}
                style={{ left: seam.x, top: seam.y }}
              />
            ))}

            {model.canvas.seats.map((seat) => (
              <div
                className={[
                  "seat-print-seat",
                  seat.occupant ? "seat-print-seat--occupied" : "seat-print-seat--empty",
                  seat.isRabbiTable ? "seat-print-seat--rabbi" : "",
                  seat.isHead ? "seat-print-seat--head" : "",
                  seat.occupant?.type === "reserve" ? "seat-print-seat--reserve" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                key={seat.seatNumber}
                style={{
                  left: seat.x - PRINT_SEAT_SIZE / 2,
                  top: seat.y - PRINT_SEAT_SIZE / 2,
                }}
              >
                {seat.occupant ? (
                  <>
                    <strong>{seat.occupant.schemeLabel}</strong>
                    {seat.occupant.type === "reserve" ? <span>Резерв</span> : null}
                  </>
                ) : (
                  <span>{seat.seatNumber}</span>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="seat-print-section seat-print-section--legend">
        <h2>Легенда</h2>
        {model.legend.length > 0 ? (
          <ol className="seat-print-legend">
            {model.legend.map((item) => (
              <li key={`${item.id}:${item.seatNumber}`}>
                <span className="seat-print-legend__number">{item.seatNumber}</span>
                <span className="seat-print-legend__name">— {item.legendLabel}</span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="seat-print-empty">Нет рассаженных гостей.</p>
        )}
      </section>

      {model.unseated.length > 0 ? (
        <section className="seat-print-section seat-print-section--unseated">
          <h2>Не рассажены</h2>
          <ul className="seat-print-unseated">
            {model.unseated.map((item) => (
              <li key={item.id}>
                <span className="seat-print-unseated__initials">{item.initials}</span>
                <span>
                  {item.type === "reserve" ? "Резерв — " : ""}
                  {item.displayName}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </article>
  );
}
