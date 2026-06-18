import { useMemo } from "react";
import type { ReactNode } from "react";

import {
  computeSeatingCapacitySummary,
  type SeatingCapacityInput,
} from "../../lib/seatingCapacity";

type SeatingMetricsPanelProps = SeatingCapacityInput & {
  action?: ReactNode;
  rabbiReserveCount: number;
  tableCount: number;
  unseatedCount: number;
};

type SeatingMetricCard = {
  id: string;
  label: string;
  value: string;
};

export function SeatingMetricsPanel({
  action,
  capacityLimit,
  occupiedSeats,
  physicalSeatCount,
  rabbiReserveCount,
  reserveSeats = 0,
  tableCount,
  unseatedCount,
}: SeatingMetricsPanelProps) {
  const summary = useMemo(
    () =>
      computeSeatingCapacitySummary({
        capacityLimit,
        occupiedSeats,
        physicalSeatCount,
        reserveSeats,
      }),
    [capacityLimit, occupiedSeats, physicalSeatCount, reserveSeats],
  );
  const normalizedRabbiReserveCount = toCount(rabbiReserveCount);
  const normalizedTableCount = toCount(tableCount);
  const normalizedUnseatedCount = toCount(unseatedCount);

  const cards: SeatingMetricCard[] = [
    {
      id: "tables",
      label: "столов",
      value: formatCount(normalizedTableCount),
    },
    {
      id: "physical",
      label: "физ. мест",
      value: formatCount(summary.physicalSeatCount),
    },
    {
      id: "limit",
      label: summary.capacityLimit === null ? "без лимита" : "лимит",
      value: summary.capacityLimit === null ? "∞" : formatCount(summary.capacityLimit),
    },
    {
      id: "occupied",
      label: "занято",
      value: formatCount(summary.occupiedSeats),
    },
  ];

  if (summary.freeByLimit !== null) {
    cards.push({
      id: "free-by-limit",
      label: "свободно по лимиту",
      value: formatCount(summary.freeByLimit),
    });
  }

  cards.push({
    id: "free-physical",
    label: "физически свободно",
    value: formatCount(summary.freePhysical),
  });

  if (normalizedRabbiReserveCount > 0) {
    cards.push({
      id: "rabbi-reserve",
      label: "раввинский резерв",
      value: formatCount(normalizedRabbiReserveCount),
    });
  }

  cards.push({
    id: "unseated",
    label: "не рассажены",
    value: formatCount(normalizedUnseatedCount),
  });

  const hasShortage = summary.missingPhysical > 0;
  const seatsNeeded = summary.occupiedSeats + summary.reserveSeats;

  return (
    <section
      aria-label="Показатели рассадки"
      aria-live="polite"
      className="seat-metrics-panel"
    >
      <h4>Показатели</h4>
      <div className="seat-metrics-grid">
        {cards.map((card) => (
          <div className="seat-metric-card" key={card.id}>
            <strong>{card.value}</strong>
            <span>{card.label}</span>
          </div>
        ))}
      </div>

      {hasShortage ? (
        <p className="seat-metrics-warning" role="alert">
          Не хватает физических мест: {formatCount(seatsNeeded)}{" "}
          {pluralizeRu(seatsNeeded, "гость", "гостя", "гостей")} на{" "}
          {formatCount(summary.physicalSeatCount)}{" "}
          {pluralizeRu(summary.physicalSeatCount, "стул", "стула", "стульев")}
        </p>
      ) : null}

      {action ? <div className="seat-metrics-actions">{action}</div> : null}
    </section>
  );
}

function toCount(value: number | null | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.round(value));
}

function formatCount(value: number): string {
  return new Intl.NumberFormat("ru-RU").format(value);
}

function pluralizeRu(count: number, one: string, few: string, many: string): string {
  const mod100 = Math.abs(count) % 100;
  const mod10 = mod100 % 10;

  if (mod100 >= 11 && mod100 <= 14) {
    return many;
  }
  if (mod10 === 1) {
    return one;
  }
  if (mod10 >= 2 && mod10 <= 4) {
    return few;
  }
  return many;
}
