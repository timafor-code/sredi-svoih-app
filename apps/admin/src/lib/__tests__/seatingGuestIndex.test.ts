import { describe, expect, it } from "vitest";
import {
  createSeatingGuestIndex,
  resolveSeatingAssignmentGuests,
  seatingGuestIdentity,
  seatingGuestSignature,
} from "../seatingGuestIndex";
import type { SeatingAssignment, SeatingGuestPoolItem } from "../../types/seating";

function guest(index: number, over: Partial<SeatingGuestPoolItem> = {}): SeatingGuestPoolItem {
  return {
    capacityUnitId: "unit", capacityReservationIds: [], displayName: `Guest ${index}`,
    email: null, guestIndex: null, guestName: null, id: `id-${index}`, initials: `G${index}`,
    key: `key-${index}`, occurrenceId: null, optionIds: [], optionTitles: [],
    participantDisplayName: null, participantUserId: null, paymentStatus: null, phone: null,
    registrationId: "registration-1", seatObligationSource: "reservation", source: "participant",
    sourceLabel: "Participant", status: "confirmed", ...over,
  };
}

function assignment(index: number, person: SeatingGuestPoolItem, over: Partial<SeatingAssignment> = {}): SeatingAssignment {
  return { id: `saved-${index}`, layoutId: "layout", registrationId: person.registrationId,
    guestLabel: person.displayName, guestInitials: person.initials, seatKey: `table:side:a:${index}`,
    type: "guest", ...over };
}

describe("seating guest index", () => {
  it("indexes keys, stable participant/guest identities, and normalized signatures", () => {
    const participant = guest(1, { participantUserId: "user-1", displayName: " Иван Иванов ", initials: " ИИ " });
    const invited = guest(2, { source: "guest", guestIndex: 0, displayName: "иван иванов", initials: "ии" });
    const index = createSeatingGuestIndex([participant, invited]);
    expect(index.byKey.get(participant.key)).toBe(participant);
    expect(index.byIdentity.get(seatingGuestIdentity(participant)!)).toBe(participant);
    expect(index.byIdentity.get(seatingGuestIdentity(invited)!)).toBe(invited);
    expect(index.bySignature.get(seatingGuestSignature(participant.registrationId, "ИВАН ИВАНОВ", "ИИ"))).toEqual([participant, invited]);
  });

  it("keeps duplicate signature buckets in input order and resolves each guest once", () => {
    const participant = guest(1, { participantUserId: "user-1", displayName: "Иван Иванов", initials: "ИИ" });
    const invited = guest(2, { source: "guest", guestIndex: 0, displayName: "Иван Иванов", initials: "ИИ" });
    const index = createSeatingGuestIndex([participant, invited]);
    const assignments = [assignment(1, participant), assignment(2, invited)];
    expect(resolveSeatingAssignmentGuests(assignments, index).map((item) => item?.key)).toEqual([participant.key, invited.key]);
    expect(resolveSeatingAssignmentGuests(assignments, index).map((item) => item?.key)).toEqual([participant.key, invited.key]);
  });

  it("uses an unambiguous current-session id key before signature fallback", () => {
    const participant = guest(1, { participantUserId: "user-1", displayName: "Иван Иванов", initials: "ИИ" });
    const invited = guest(2, { source: "guest", guestIndex: 0, displayName: "Иван Иванов", initials: "ИИ" });
    const assignmentWithKey = assignment(1, invited, { id: `manual:${invited.key}:table:side:a:1` });
    expect(resolveSeatingAssignmentGuests([assignmentWithKey], createSeatingGuestIndex([participant, invited]))[0]).toBe(invited);
  });

  it("leaves an unmatched assignment unresolved without selecting a random guest", () => {
    const pool = [guest(1)];
    const unknown = assignment(1, pool[0], { guestLabel: "Unknown", guestInitials: "U" });
    expect(resolveSeatingAssignmentGuests([unknown], createSeatingGuestIndex(pool))).toEqual([null]);
  });

  it("uses persisted guest index before user identity and resolves same-name reopen rows in either order", () => {
    const participant = guest(1, { displayName: "Иван Иванов", initials: "ИИ", participantUserId: "user-1" });
    const invited = guest(2, { source: "guest", guestIndex: 1, displayName: "Иван Иванов", initials: "ИИ" });
    const participantRow = assignment(1, participant, { guestIndex: null, userId: "user-1" });
    const invitedRow = assignment(2, invited, { guestIndex: 1, userId: "user-1" });
    const index = createSeatingGuestIndex([participant, invited]);
    expect(resolveSeatingAssignmentGuests([participantRow, invitedRow], index)).toEqual([participant, invited]);
    expect(resolveSeatingAssignmentGuests([invitedRow, participantRow], index)).toEqual([invited, participant]);
  });

  it("resolves a legacy invited row by signature before the shared registration user id", () => {
    const participant = guest(1, { displayName: "Пётр Петров", initials: "ПП", participantUserId: "user-1" });
    const invited = guest(2, { source: "guest", guestIndex: 1, displayName: "Иван Иванов", initials: "ИИ" });
    const legacy = assignment(1, invited, { guestIndex: null, userId: "user-1" });
    expect(resolveSeatingAssignmentGuests([legacy], createSeatingGuestIndex([participant, invited]))).toEqual([invited]);
  });

  it("resolves a legacy participant row by its matching signature", () => {
    const participant = guest(1, { displayName: "Пётр Петров", initials: "ПП", participantUserId: "user-1" });
    const invited = guest(2, { source: "guest", guestIndex: 1, displayName: "Иван Иванов", initials: "ИИ" });
    const legacy = assignment(1, participant, { guestIndex: null, userId: "user-1" });
    expect(resolveSeatingAssignmentGuests([legacy], createSeatingGuestIndex([participant, invited]))).toEqual([participant]);
  });

  it("reserves explicit guest indexes before earlier legacy signature fallbacks", () => {
    const participant = guest(1, { displayName: "Иван Иванов", initials: "ИИ", participantUserId: "user-1" });
    const invited = guest(2, { source: "guest", guestIndex: 1, displayName: "Иван Иванов", initials: "ИИ" });
    const legacy = assignment(1, participant, { guestIndex: null, userId: "user-1" });
    const explicit = assignment(2, invited, { guestIndex: 1, userId: "user-1" });
    const index = createSeatingGuestIndex([participant, invited]);
    expect(resolveSeatingAssignmentGuests([legacy, explicit], index)).toEqual([participant, invited]);
    expect(resolveSeatingAssignmentGuests([explicit, legacy], index)).toEqual([invited, participant]);
  });

  it("assigns fully ambiguous legacy same-name rows to distinct guests deterministically", () => {
    const participant = guest(1, { displayName: "Иван Иванов", initials: "ИИ", participantUserId: "user-1" });
    const invited = guest(2, { source: "guest", guestIndex: 1, displayName: "Иван Иванов", initials: "ИИ" });
    const rows = [assignment(1, participant, { guestIndex: null, userId: "user-1" }), assignment(2, participant, { guestIndex: null, userId: "user-1" })];
    const index = createSeatingGuestIndex([participant, invited]);
    const first = resolveSeatingAssignmentGuests(rows, index).map((item) => item?.key);
    const second = resolveSeatingAssignmentGuests(rows, index).map((item) => item?.key);
    expect(first).toEqual([participant.key, invited.key]);
    expect(second).toEqual(first);
  });
});
