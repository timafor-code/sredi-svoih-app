import { useCallback, useEffect, useState } from "react";

import type { AdminEventCapacityUnit } from "../../types/eventCapacityUnits";
import { EventCapacityUnitsConstructor } from "./EventCapacityUnitsConstructor";
import { ParticipationOptionsConstructor } from "./ParticipationOptionsConstructor";

type EventTicketsCapacityModuleProps = {
  eventId: string;
  active?: boolean;
  onDirtyChange?: (dirty: boolean) => void;
  eventCapacity: number | null;
  defaultPriceCurrency?: string | null;
};

export function EventTicketsCapacityModule(props: EventTicketsCapacityModuleProps) {
  const [optionsDirty, setOptionsDirty] = useState(false);
  const [slotsDirty, setSlotsDirty] = useState(false);
  const { onDirtyChange, eventId } = props;
  const dirty = optionsDirty || slotsDirty;

  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange?.(false), [eventId, onDirtyChange]);

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
      <ParticipationOptionsConstructor {...props} onDirtyChange={setOptionsDirty} capacityUnits={capacityUnits} selectionMode={selectionMode}
        deletedCapacityUnitIds={deletedCapacityUnitIds}
        heading={
        <div>
          <h2>Билеты и места</h2>
          <p>Варианты участия, цены и общие лимиты регистрации.</p>
        </div>
        }
        settings={
        <label className="tickets-selection-mode">
          <span>Выбор:</span>
          <select className="participation-setting-select" value={selectionMode}
            onChange={(event) => setSelectionMode(event.target.value === "single" ? "single" : "multiple")}>
            <option value="single">Только один вариант</option>
            <option value="multiple">Можно выбрать несколько</option>
          </select>
        </label>
        }
        capacityPanel={<EventCapacityUnitsConstructor eventId={props.eventId} active={props.active} onDirtyChange={setSlotsDirty} onPersisted={updateCapacityUnits} />} />
    </section>
  );
}
