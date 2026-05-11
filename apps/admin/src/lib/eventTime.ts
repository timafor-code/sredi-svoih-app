import type { AdminEventOccurrence } from "../types/eventOccurrences";

export type OccurrenceRegistrationState =
  | "not_required"
  | "past"
  | "not_started"
  | "open"
  | "closed"
  | "always_open";

export const OCCURRENCE_REGISTRATION_STATE_LABELS: Record<
  OccurrenceRegistrationState,
  string
> = {
  not_required: "Регистрация не требуется",
  past: "Сеанс прошёл",
  not_started: "Регистрация ещё не началась",
  open: "Регистрация открыта",
  closed: "Регистрация закрыта",
  always_open: "Регистрация открыта",
};

const INACTIVE_OCCURRENCE_STATUSES = new Set([
  "cancelled",
  "archived",
  "hidden",
  "inactive",
]);

function parseTime(value: string | null | undefined): number | null {
  if (!value) return null;
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? null : time;
}

type OccurrenceTimingInfo = {
  startsAt: string | null;
  endsAt: string | null;
};

export function isOccurrencePast(
  occurrence: OccurrenceTimingInfo,
  now: number = Date.now(),
): boolean {
  const boundary = parseTime(occurrence.endsAt) ?? parseTime(occurrence.startsAt);
  return boundary !== null && boundary < now;
}

export function isOccurrenceInactiveStatus(status: string | null | undefined): boolean {
  return Boolean(status && INACTIVE_OCCURRENCE_STATUSES.has(status));
}

export function isOccurrenceActive(
  occurrence: OccurrenceTimingInfo & { status?: string | null },
  now: number = Date.now(),
): boolean {
  if (isOccurrenceInactiveStatus(occurrence.status)) {
    return false;
  }
  return !isOccurrencePast(occurrence, now);
}

export function getOccurrenceRegistrationState(
  occurrence: Pick<
    AdminEventOccurrence,
    | "startsAt"
    | "endsAt"
    | "status"
    | "registrationOpensAt"
    | "registrationClosesAt"
  >,
  now: number = Date.now(),
  eventRegistrationMode?: string | null,
): OccurrenceRegistrationState {
  if (eventRegistrationMode === "none") {
    return "not_required";
  }

  if (isOccurrencePast(occurrence, now)) {
    return "past";
  }

  const opensAt = parseTime(occurrence.registrationOpensAt);
  const closesAt = parseTime(occurrence.registrationClosesAt);

  if (opensAt !== null && now < opensAt) {
    return "not_started";
  }

  if (closesAt !== null && now > closesAt) {
    return "closed";
  }

  if (opensAt === null && closesAt === null) {
    return "always_open";
  }

  return "open";
}

export function getOccurrenceRegistrationStateLabel(
  state: OccurrenceRegistrationState,
): string {
  return OCCURRENCE_REGISTRATION_STATE_LABELS[state];
}
