export type OptionalOccurrenceCapacity = {
  error: string | null;
  value: number | null;
};

export function normalizeOccurrenceCapacityForDraft(
  capacity: number | null,
): string {
  return typeof capacity === "number" &&
    Number.isSafeInteger(capacity) &&
    capacity > 0
    ? String(capacity)
    : "";
}

export function normalizeOccurrenceCapacityFromApi(value: unknown): number | null {
  const capacity = typeof value === "number" ? value : Number(value);
  return Number.isSafeInteger(capacity) && capacity > 0 ? capacity : null;
}

export function parseOptionalOccurrenceCapacity(
  value: string,
): OptionalOccurrenceCapacity {
  const trimmed = value.trim();
  if (!trimmed) {
    return { error: null, value: null };
  }

  if (!/^\d+$/.test(trimmed)) {
    return {
      error: "Лимит должен быть положительным целым числом.",
      value: null,
    };
  }

  const parsed = Number(trimmed);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    return {
      error: "Лимит должен быть положительным целым числом.",
      value: null,
    };
  }

  return { error: null, value: parsed };
}

export function buildOccurrencePayloadFields<Status extends string>(
  capacity: string,
  status: Status,
): { capacity: number | null; error: string | null; status: Status } {
  const parsedCapacity = parseOptionalOccurrenceCapacity(capacity);
  return {
    capacity: parsedCapacity.value,
    error: parsedCapacity.error,
    status,
  };
}
