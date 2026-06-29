import type { CSSProperties } from "react";

import type { SeatingPrintModel } from "../../types/seating";

const PRINT_SEAT_SIZE = 34;

export function SeatingPrintDocument({ model }: { model: SeatingPrintModel }) {
  const frameStyle: CSSProperties = {
    height: model.canvas.viewportHeight,
    width: model.canvas.viewportWidth,
  };
  const canvasStyle: CSSProperties = {
    height: model.canvas.height,
    left: model.canvas.offsetX,
    top: model.canvas.offsetY,
    transform: `scale(${model.canvas.scale})`,
    width: model.canvas.width,
  };
  const rootStyle = {
    "--seat-print-legend-columns": model.layout.legendColumns,
  } as CSSProperties;

  return (
    <article
      aria-label="Печатная схема рассадки"
      className={[
        "seat-print-root",
        model.canvas.isCompact ? "seat-print-root--compact" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      style={rootStyle}
    >
      <section className="seat-print-page seat-print-page--first">
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
                    <strong>{seat.occupant.schemeLabel}</strong>
                  ) : (
                    <span>{seat.seatNumber}</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        </section>

        {model.layout.inlineLegend ? (
          <PrintDetails
            legend={model.legend}
            legendTitle="Легенда"
            unseated={model.unseated}
          />
        ) : null}
      </section>

      {model.layout.hasFullLegendPage ? (
        <section className="seat-print-page seat-print-page--legend">
          <PrintDetails
            legend={model.legend}
            legendTitle="Полная легенда"
            unseated={model.unseated}
          />
        </section>
      ) : null}
    </article>
  );
}

function PrintDetails({
  legend,
  legendTitle,
  unseated,
}: {
  legend: SeatingPrintModel["legend"];
  legendTitle: string;
  unseated: SeatingPrintModel["unseated"];
}) {
  return (
    <section className="seat-print-section seat-print-section--legend">
      <h2>{legendTitle}</h2>
      {legend.length > 0 ? (
        <ol className="seat-print-legend">
          {legend.map((item) => (
            <li key={`${item.id}:${item.seatNumber}`}>
              <span className="seat-print-legend__number">{item.seatNumber}</span>
              <span className="seat-print-legend__separator">—</span>
              <span className="seat-print-legend__name">{item.legendLabel}</span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="seat-print-empty">Нет рассаженных гостей.</p>
      )}

      {unseated.length > 0 ? (
        <section className="seat-print-section seat-print-section--unseated">
          <h2>Не рассажены</h2>
          <ul className="seat-print-unseated">
            {unseated.map((item) => (
              <li key={item.id}>
                <span className="seat-print-unseated__initials">{item.initials}</span>
                <span className="seat-print-legend__separator">—</span>
                <span>
                  {item.type === "reserve" ? "Резерв: " : ""}
                  {item.displayName}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </section>
  );
}
