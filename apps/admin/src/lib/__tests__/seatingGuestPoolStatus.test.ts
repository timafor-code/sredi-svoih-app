import { describe, expect, it } from "vitest";

import {
  guestPoolSlotKey,
  hasGuestPoolMismatch,
  isGuestPoolPending,
} from "../seatingGuestPoolStatus";

describe("seating guest-pool status", () => {
  const slotKey = guestPoolSlotKey({
    capacityUnitId: "unit-1",
    eventId: "event-1",
    occurrenceId: null,
  });

  it("builds a stable slot key and treats no slot as absent", () => {
    expect(slotKey).toBe("event-1||unit-1");
    expect(guestPoolSlotKey(null)).toBeNull();
  });

  it("is pending before a current-slot pool has loaded", () => {
    expect(isGuestPoolPending({ loadedSlotKey: null, slotKey })).toBe(true);
    expect(isGuestPoolPending({ loadedSlotKey: "event-2||unit-1", slotKey })).toBe(true);
    expect(isGuestPoolPending({ loadedSlotKey: slotKey, slotKey })).toBe(false);
  });

  it("reports a mismatch only after an empty current-slot pool loads", () => {
    const base = {
      error: null,
      guestPoolLength: 0,
      hasBucketOccupancy: true,
      loadedSlotKey: slotKey,
      slotKey,
    };

    expect(hasGuestPoolMismatch({ ...base, loadedSlotKey: null })).toBe(false);
    expect(hasGuestPoolMismatch({ ...base, error: "network" })).toBe(false);
    expect(hasGuestPoolMismatch(base)).toBe(true);
    expect(hasGuestPoolMismatch({ ...base, guestPoolLength: 1 })).toBe(false);
    expect(hasGuestPoolMismatch({ ...base, hasBucketOccupancy: false })).toBe(false);
  });
});
