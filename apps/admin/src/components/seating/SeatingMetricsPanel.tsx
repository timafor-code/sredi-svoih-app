import { useMemo } from "react";

import {
  computeSeatingMetricsDisplaySummary,
  type SeatingMetricsDisplayInput,
} from "../../lib/seatingCapacity";

type SeatingMetricsPanelProps = SeatingMetricsDisplayInput & {
  disabledSeatCount: number;
  rabbiReserveCount: number;
  tableCount: number;
  unseatedCount: number;
};

export function SeatingMetricsPanel({
  capacityLimit, disabledSeatCount, physicalOccupiedSeats, physicalSeatCount,
  rabbiReserveCount, registrationOccupiedSeats, reserveSeats = 0,
  seatedGuestCount, tableCount, unseatedCount,
}: SeatingMetricsPanelProps) {
  const summary = useMemo(
    () => computeSeatingMetricsDisplaySummary({ capacityLimit, physicalOccupiedSeats, physicalSeatCount, registrationOccupiedSeats, reserveSeats, seatedGuestCount }),
    [capacityLimit, physicalOccupiedSeats, physicalSeatCount, registrationOccupiedSeats, reserveSeats, seatedGuestCount],
  );
  const metrics = [
    { id: "tables", label: "Столов", title: "Столов в схеме", value: tableCount },
    { id: "physical", label: "Физ. мест", title: "Физических мест с учётом стыков и выключенных", value: summary.physicalSeatCount },
    { id: "limit", label: summary.capacityLimit === null ? "Без лимита" : "Лимит", title: "Лимит регистрации", value: summary.capacityLimit === null ? "∞" : summary.capacityLimit, warn: summary.capacityLimit !== null && summary.physicalSeatCount < summary.capacityLimit },
    { id: "occupied", label: "Занято", title: "Занято мест", value: summary.seatedGuestCount },
    { id: "free", label: "Свободно", title: "Физически свободно", value: summary.freePhysical },
    { id: "reserve", label: "Резерв", title: "Раввинский резерв", value: rabbiReserveCount },
    { id: "unseated", label: "Не рассажены", title: "Гостей без места", value: unseatedCount, warn: unseatedCount > 0 },
    ...(disabledSeatCount > 0 ? [{ id: "off", label: "Выключено", title: "Выключенных мест — в схему не входят", value: disabledSeatCount, off: true }] : []),
  ];

  return <div aria-label="Показатели рассадки" aria-live="polite" className="seat-metrics-strip">
    {metrics.map((metric) => <div className={["seat-metric", metric.warn ? "seat-metric--warn" : "", metric.off ? "seat-metric--off" : ""].filter(Boolean).join(" ")} key={metric.id} title={metric.title}>
      <strong>{typeof metric.value === "number" ? formatCount(metric.value) : metric.value}</strong><span>{metric.label}</span>
    </div>)}
  </div>;
}

function formatCount(value: number): string {
  return new Intl.NumberFormat("ru-RU").format(Math.max(0, Math.round(value)));
}
