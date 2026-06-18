import { useMemo } from "react";

import {
  computeSeatingCapacitySummary,
  type SeatingCapacityInput,
} from "../../lib/seatingCapacity";

type SeatingCapacitySummaryProps = SeatingCapacityInput & {
  // Extra status segments rendered before/after the capacity numbers so the whole
  // seating footer reads as ONE line (e.g. "11 стол." before, "не рассажены ·
  // фигура зафиксирована" after). They keep the state-specific bits (table count,
  // rabbi reserve, seams, …) attached to the same line instead of a second row.
  leadingParts?: string[];
  trailingParts?: string[];
};

// PR 18: display-only capacity summary embedded into the seating footer/status
// line. It makes the difference between physical seats (table geometry) and the
// registration limit explicit. It changes nothing — no capacity sync, no write —
// it only reads numbers and renders them inline next to the footer status.
export function SeatingCapacitySummary({
  capacityLimit,
  occupiedSeats,
  physicalSeatCount,
  reserveSeats = 0,
  leadingParts = [],
  trailingParts = [],
}: SeatingCapacitySummaryProps) {
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

  const hasShortage = summary.missingPhysical > 0;
  const seatsNeeded = summary.occupiedSeats + summary.reserveSeats;

  const capacityParts: string[] = [
    `${formatCount(summary.physicalSeatCount)} физ. мест`,
    summary.capacityLimit === null
      ? "без лимита"
      : `лимит ${formatCount(summary.capacityLimit)}`,
    `занято ${formatCount(summary.occupiedSeats)}`,
  ];

  if (hasShortage) {
    capacityParts.push(`не хватает ${formatCount(summary.missingPhysical)} физических мест`);
  } else {
    if (summary.freeByLimit !== null) {
      capacityParts.push(`свободно по лимиту ${formatCount(summary.freeByLimit)}`);
    }
    capacityParts.push(`физически свободно ${formatCount(summary.freePhysical)}`);
    if (summary.reserveSeats > 0) {
      capacityParts.push(`резервов ${formatCount(summary.reserveSeats)}`);
    }
  }

  const parts = [...leadingParts, ...capacityParts, ...trailingParts];

  return (
    <span className="seat-capacity-summary" aria-live="polite">
      <span className="seat-capacity-summary__line">{parts.join(" · ")}</span>

      {hasShortage ? (
        <span className="seat-capacity-summary__warning" role="alert">
          Не хватает физических мест: {formatCount(seatsNeeded)}{" "}
          {pluralizeRu(seatsNeeded, "гость", "гостя", "гостей")} на{" "}
          {formatCount(summary.physicalSeatCount)}{" "}
          {pluralizeRu(summary.physicalSeatCount, "стул", "стула", "стульев")}
        </span>
      ) : null}
    </span>
  );
}

function formatCount(value: number): string {
  return new Intl.NumberFormat("ru-RU").format(value);
}

// one/few/many Russian plural for the warning wording.
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
