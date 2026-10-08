type RegistrationWindowOccurrence = {
  status: string;
  registrationOpensAt: string | null;
  registrationClosesAt: string | null;
  serverNow: string | null;
};

function timestamp(value: string | null): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function isRegistrationClosedByDeadline(
  occurrence: RegistrationWindowOccurrence | null | undefined,
  clientNow = Date.now(),
): boolean {
  if (!occurrence || occurrence.status !== "active") return false;

  const closesAt = timestamp(occurrence.registrationClosesAt);
  if (closesAt === null) return false;

  const effectiveNow = Math.max(
    clientNow,
    timestamp(occurrence.serverNow) ?? Number.NEGATIVE_INFINITY,
  );
  const opensAt = timestamp(occurrence.registrationOpensAt);
  if (opensAt !== null && effectiveNow < opensAt) return false;

  return effectiveNow > closesAt;
}
