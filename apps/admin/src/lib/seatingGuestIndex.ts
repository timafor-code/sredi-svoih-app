import type { SeatingAssignment, SeatingGuestPoolItem } from "../types/seating";

export type SeatingGuestIndex = {
  byIdentity: ReadonlyMap<string, SeatingGuestPoolItem>;
  byKey: ReadonlyMap<string, SeatingGuestPoolItem>;
  byRegistration: ReadonlyMap<string, readonly SeatingGuestPoolItem[]>;
  bySignature: ReadonlyMap<string, readonly SeatingGuestPoolItem[]>;
};

export function seatingGuestSignature(
  registrationId: string | null,
  label: string | null,
  initials: string | null,
): string {
  return [registrationId ?? "", normalize(label), normalize(initials)].join("|");
}

export function seatingGuestIdentity(guest: SeatingGuestPoolItem): string | null {
  if (guest.source === "participant" && guest.participantUserId) {
    return `participant:${guest.registrationId}:${guest.participantUserId}`;
  }
  if (guest.source === "guest" && guest.guestIndex !== null) {
    return `guest:${guest.registrationId}:${guest.guestIndex}`;
  }
  return null;
}

export function createSeatingGuestIndex(
  guestPool: readonly SeatingGuestPoolItem[],
): SeatingGuestIndex {
  const byKey = new Map<string, SeatingGuestPoolItem>();
  const byIdentity = new Map<string, SeatingGuestPoolItem>();
  const bySignature = new Map<string, SeatingGuestPoolItem[]>();
  const byRegistration = new Map<string, SeatingGuestPoolItem[]>();
  guestPool.forEach((guest) => {
    byKey.set(guest.key, guest);
    const identity = seatingGuestIdentity(guest);
    if (identity) byIdentity.set(identity, guest);
    append(bySignature, seatingGuestSignature(guest.registrationId, guest.displayName, guest.initials), guest);
    append(byRegistration, guest.registrationId, guest);
  });
  return { byKey, byIdentity, byRegistration, bySignature };
}

/** Resolves in assignment order; a pool guest can be selected at most once. */
export function resolveSeatingAssignmentGuests(
  assignments: readonly SeatingAssignment[],
  index: SeatingGuestIndex,
): Array<SeatingGuestPoolItem | null> {
  const used = new Set<string>();
  return assignments.map((assignment) => {
    if (assignment.type !== "guest") return null;
    const embeddedKey = seatingAssignmentEmbeddedGuestKey(assignment);
    const exact = embeddedKey ? index.byKey.get(embeddedKey) : undefined;
    if (exact) return used.has(exact.key) ? null : claim(exact, used);
    const signature = seatingGuestSignature(assignment.registrationId, assignment.guestLabel, assignment.guestInitials);
    const signatureMatch = firstUnused(index.bySignature.get(signature), used);
    if (signatureMatch) return claim(signatureMatch, used);
    if (!assignment.guestLabel && !assignment.guestInitials && assignment.registrationId) {
      const registrationMatch = firstUnused(index.byRegistration.get(assignment.registrationId), used);
      if (registrationMatch) return claim(registrationMatch, used);
    }
    return null;
  });
}

export function seatingAssignmentEmbeddedGuestKey(assignment: SeatingAssignment): string | null {
  if (!assignment.id.startsWith("auto:") && !assignment.id.startsWith("manual:")) return null;
  const prefix = assignment.id.startsWith("auto:") ? "auto:" : "manual:";
  const suffix = `:${assignment.seatKey ?? "pool"}`;
  if (!assignment.id.endsWith(suffix)) return null;
  const key = assignment.id.slice(prefix.length, -suffix.length);
  return key || null;
}

function normalize(value: string | null | undefined): string {
  return (value ?? "").trim().toLocaleLowerCase("ru-RU");
}

function append(map: Map<string, SeatingGuestPoolItem[]>, key: string, guest: SeatingGuestPoolItem): void {
  const bucket = map.get(key);
  if (bucket) bucket.push(guest);
  else map.set(key, [guest]);
}

function firstUnused(bucket: readonly SeatingGuestPoolItem[] | undefined, used: ReadonlySet<string>): SeatingGuestPoolItem | null {
  return bucket?.find((guest) => !used.has(guest.key)) ?? null;
}

function claim(guest: SeatingGuestPoolItem, used: Set<string>): SeatingGuestPoolItem {
  used.add(guest.key);
  return guest;
}
