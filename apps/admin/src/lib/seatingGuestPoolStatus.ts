export type GuestPoolSlot = {
  capacityUnitId: string;
  eventId: string;
  occurrenceId?: string | null;
};

export function guestPoolSlotKey(slot: GuestPoolSlot | null): string | null {
  return slot
    ? `${slot.eventId}|${slot.occurrenceId ?? ""}|${slot.capacityUnitId}`
    : null;
}

export function isGuestPoolPending({
  loadedSlotKey,
  slotKey,
}: {
  loadedSlotKey: string | null;
  slotKey: string | null;
}): boolean {
  return slotKey !== null && loadedSlotKey !== slotKey;
}

export function hasGuestPoolMismatch({
  error,
  guestPoolLength,
  hasBucketOccupancy,
  loadedSlotKey,
  slotKey,
}: {
  error: string | null;
  guestPoolLength: number;
  hasBucketOccupancy: boolean;
  loadedSlotKey: string | null;
  slotKey: string | null;
}): boolean {
  return !isGuestPoolPending({ loadedSlotKey, slotKey }) &&
    !error &&
    hasBucketOccupancy &&
    guestPoolLength === 0;
}
