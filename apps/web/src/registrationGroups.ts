import type { MyRegistration } from "./types";

export type MyRegistrationPeriod = "active" | "past";

export function getRegistrationStartsAt(registration: MyRegistration): string {
  return registration.occurrence?.starts_at ?? registration.event.starts_at;
}

export function getRegistrationEndsAt(registration: MyRegistration): string | null {
  return registration.occurrence
    ? registration.occurrence.ends_at
    : registration.event.ends_at;
}

export function getRegistrationTimezone(registration: MyRegistration): string | null {
  return registration.occurrence?.timezone ?? registration.event.timezone;
}

function parseTime(value: string | null): number | null {
  if (!value) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : null;
}

export function hasRegistrationPassed(
  registration: MyRegistration,
  now = Date.now(),
): boolean {
  const boundary = parseTime(getRegistrationEndsAt(registration))
    ?? parseTime(getRegistrationStartsAt(registration));
  return boundary !== null && boundary < now;
}

export function groupMyRegistrations(
  registrations: MyRegistration[],
  now = Date.now(),
): Record<MyRegistrationPeriod, MyRegistration[]> {
  const unique = Array.from(
    new Map(registrations.map((registration) => [registration.id, registration])).values(),
  );
  const active = unique
    .filter((registration) => !hasRegistrationPassed(registration, now))
    .sort((first, second) => (
      (parseTime(getRegistrationStartsAt(first)) ?? Number.POSITIVE_INFINITY)
      - (parseTime(getRegistrationStartsAt(second)) ?? Number.POSITIVE_INFINITY)
    ));
  const past = unique
    .filter((registration) => hasRegistrationPassed(registration, now))
    .sort((first, second) => (
      (parseTime(getRegistrationStartsAt(second)) ?? Number.NEGATIVE_INFINITY)
      - (parseTime(getRegistrationStartsAt(first)) ?? Number.NEGATIVE_INFINITY)
    ));

  return { active, past };
}
