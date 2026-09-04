import { useCallback, useState } from "react";

import type { AdminEventCapacityUnit } from "../../types/eventCapacityUnits";
import { EventCapacityUnitsConstructor } from "./EventCapacityUnitsConstructor";
import { ParticipationOptionsConstructor } from "./ParticipationOptionsConstructor";

type EventTicketsCapacityModuleProps = {
  eventId: string;
  eventCapacity: number | null;
  defaultPriceCurrency?: string | null;
};

export function EventTicketsCapacityModule(props: EventTicketsCapacityModuleProps) {
  // Only service-confirmed slot data is shared with option labels and pickers.
  const [capacityUnits, setCapacityUnits] = useState<AdminEventCapacityUnit[]>([]);
  const [deletedCapacityUnitIds, setDeletedCapacityUnitIds] = useState<string[]>([]);
  const updateCapacityUnits = useCallback((units: AdminEventCapacityUnit[], deletedIds: string[]) => {
    setCapacityUnits(units);
    if (deletedIds.length) setDeletedCapacityUnitIds((current) => [...new Set([...current, ...deletedIds])]);
  }, []);
  // This existing control affects the local preview; there is no persistence field.
  const [selectionMode, setSelectionMode] = useState<"single" | "multiple">("multiple");

  return (
    <section className="event-tickets-capacity">
      <header className="event-tickets-capacity__head">
        <div>
          <h2>Билеты и места</h2>
          <p>Варианты участия, цены и общие лимиты регистрации.</p>
        </div>
        <label className="tickets-selection-mode">
          <span>Выбор:</span>
          <select className="participation-setting-select" value={selectionMode}
            onChange={(event) => setSelectionMode(event.target.value === "single" ? "single" : "multiple")}>
            <option value="single">Только один вариант</option>
            <option value="multiple">Можно выбрать несколько</option>
          </select>
        </label>
      </header>
      <ParticipationOptionsConstructor {...props} capacityUnits={capacityUnits} selectionMode={selectionMode}
        deletedCapacityUnitIds={deletedCapacityUnitIds}
        capacityPanel={<EventCapacityUnitsConstructor eventId={props.eventId} onPersisted={updateCapacityUnits} />} />
    </section>
  );
}
