// PR 18: pure, display-only capacity math for the seating modal.
//
// It explains the difference between the physical seats produced by the table
// geometry and the registration limit, which are two INDEPENDENT numbers
// (PLAN-seating-registrations-v15 §1):
//
//   capacityLimit     = the registration business limit (gate for public sign-up);
//                       `null` means "без лимита" (no limit).
//   physicalSeatCount = how many chairs the current table geometry yields.
//
// Editing the table geometry must never change `event_capacity_units.capacity`.
// This helper only reads numbers and derives display values; it has no IO and
// never mutates anything, and PR 18 intentionally adds no capacity sync.

export type SeatingCapacityInput = {
  physicalSeatCount: number;
  capacityLimit: number | null;
  occupiedSeats: number;
  reserveSeats?: number;
};

export type SeatingCapacitySummary = {
  physicalSeatCount: number;
  capacityLimit: number | null;
  occupiedSeats: number;
  reserveSeats: number;
  // capacityLimit − occupiedSeats; `null` when there is no limit (not 0/NaN).
  freeByLimit: number | null;
  // physicalSeatCount − occupiedSeats − reserveSeats, clamped to >= 0. The
  // deficit (when it would go negative) is reported by `missingPhysical`.
  freePhysical: number;
  // max(0, occupiedSeats + reserveSeats − physicalSeatCount): how many chairs
  // are missing for everyone who must be seated. Computed the same way whether
  // or not there is a registration limit.
  missingPhysical: number;
  // max(0, physicalSeatCount − capacityLimit): "spare" physical seats beyond the
  // limit. Always 0 when there is no limit — there is nothing to overflow.
  physicalOverflow: number;
};

// Coerce any number-ish input to a finite, non-negative integer so the summary
// can never produce NaN/negative noise from a transient or bad value.
function toCount(value: number | null | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.round(value));
}

// Normalise the limit: a finite positive number stays a number, everything else
// (including `null`, `0`, negatives, NaN) collapses to `null` = "без лимита".
function normalizeLimit(value: number | null | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return null;
  }
  return Math.round(value);
}

export function computeSeatingCapacitySummary(
  input: SeatingCapacityInput,
): SeatingCapacitySummary {
  const physicalSeatCount = toCount(input.physicalSeatCount);
  const occupiedSeats = toCount(input.occupiedSeats);
  const reserveSeats = toCount(input.reserveSeats);
  const capacityLimit = normalizeLimit(input.capacityLimit);

  const seatsNeeded = occupiedSeats + reserveSeats;

  return {
    physicalSeatCount,
    capacityLimit,
    occupiedSeats,
    reserveSeats,
    // Guard the null limit BEFORE the subtraction — never `null − number`.
    freeByLimit: capacityLimit === null ? null : capacityLimit - occupiedSeats,
    freePhysical: Math.max(0, physicalSeatCount - seatsNeeded),
    missingPhysical: Math.max(0, seatsNeeded - physicalSeatCount),
    // No limit → nothing to overflow.
    physicalOverflow:
      capacityLimit === null ? 0 : Math.max(0, physicalSeatCount - capacityLimit),
  };
}
