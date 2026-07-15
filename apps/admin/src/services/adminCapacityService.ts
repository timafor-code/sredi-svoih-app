import {
  listAdminEventCapacityUnits,
  replaceAdminEventCapacityUnits,
} from "./adminEventCapacityUnitsApiService";
import type { AdminEventCapacityUnit } from "../types/eventCapacityUnits";

export async function updateCapacityUnitLimit(
  eventId: string,
  capacityUnitId: string,
  newCapacity: number | null,
): Promise<AdminEventCapacityUnit> {
  if (!eventId.trim()) throw new Error("Event id is required.");
  if (!capacityUnitId.trim()) throw new Error("Capacity unit id is required.");
  if (newCapacity !== null && (!Number.isFinite(newCapacity) || Math.round(newCapacity) <= 0)) {
    throw new Error("Capacity limit must be a finite positive number.");
  }

  const units = await listAdminEventCapacityUnits(eventId);
  const target = units.find((unit) => unit.id === capacityUnitId);

  if (!target) {
    throw new Error("Capacity unit does not belong to this event.");
  }

  const nextCapacity = newCapacity === null ? null : Math.round(newCapacity);
  const saved = await replaceAdminEventCapacityUnits(
    eventId,
    units.map((unit) => ({
      id: unit.id,
      key: unit.key,
      title: unit.title,
      description: unit.description,
      capacity: unit.id === capacityUnitId ? nextCapacity : unit.capacity,
      sortOrder: unit.sortOrder,
      isActive: unit.isActive,
    })),
  );
  const updated = saved.find((unit) => unit.id === capacityUnitId);

  if (!updated) {
    throw new Error("Capacity unit update did not return the edited unit.");
  }

  return updated;
}
