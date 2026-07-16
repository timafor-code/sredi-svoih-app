import type { AdminEvent, AdminEventMutationInput, UpdateAdminEventInput } from "../types/events";

export type EventUpdateFormState = {
  title: string;
  eventKind: string;
  shortDescription: string;
  description: string;
  category: string;
  startDate: string;
  startTime: string;
  isPermanent: boolean;
  endDate: string;
  endTime: string;
  timezone: string;
  locationName: string;
  address: string;
  imageUrl: string;
  status: string;
  visibility: string;
  registrationMode: string;
  registrationUrl: string;
  capacity: string;
};

const DEFAULT_TIMEZONE = "Europe/Moscow";

export function buildEventUpdateInput(
  event: AdminEvent,
  initialForm: EventUpdateFormState,
  form: EventUpdateFormState,
  input: AdminEventMutationInput,
): UpdateAdminEventInput {
  const updates: UpdateAdminEventInput = {};
  const changed = (...fields: Array<keyof EventUpdateFormState>) => (
    fields.some((field) => form[field] !== initialForm[field])
  );
  const addTextUpdate = <Key extends keyof UpdateAdminEventInput>(
    key: Key,
    formFields: Array<keyof EventUpdateFormState>,
    nextValue: UpdateAdminEventInput[Key],
    currentValue: unknown,
  ) => {
    if (changed(...formFields) && !sameOptionalText(nextValue, currentValue)) {
      updates[key] = nextValue;
    }
  };

  addTextUpdate("title", ["title"], input.title, event.title);
  if (changed("eventKind") && input.eventKind !== event.eventKind) {
    updates.eventKind = input.eventKind;
  }
  addTextUpdate("shortDescription", ["shortDescription"], input.shortDescription, event.shortDescription);
  addTextUpdate("description", ["description"], input.description, event.description);
  addTextUpdate("category", ["category"], input.category, event.category);
  addTextUpdate("locationName", ["locationName"], input.locationName, event.locationName);
  addTextUpdate("address", ["address"], input.address, event.address);
  addTextUpdate("imageUrl", ["imageUrl"], input.imageUrl, event.imageUrl);

  if (changed("startDate", "startTime", "timezone") && !sameInstant(input.startsAt, event.startsAt)) {
    updates.startsAt = input.startsAt;
  }
  if (changed("timezone") && input.timezone !== (event.timezone ?? DEFAULT_TIMEZONE)) {
    updates.timezone = input.timezone;
  }
  if (changed("isPermanent") && input.isPermanent !== event.isPermanent) {
    updates.isPermanent = input.isPermanent;
  }
  if (
    (changed("isPermanent") || changed("endDate", "endTime")) &&
    !sameInstant(input.endsAt, event.endsAt)
  ) {
    updates.endsAt = input.endsAt;
  }

  if (changed("status") && input.status !== event.status) {
    updates.status = input.status;
  }
  if (changed("visibility") && input.visibility !== event.visibility) {
    updates.visibility = input.visibility;
  }
  if (changed("registrationMode") && input.registrationMode !== event.registrationMode) {
    updates.registrationMode = input.registrationMode;
  }
  if (
    (changed("registrationMode") || changed("registrationUrl")) &&
    !sameOptionalText(input.registrationUrl, event.registrationUrl)
  ) {
    updates.registrationUrl = input.registrationUrl;
  }
  if (changed("capacity") && input.capacity !== normalizedCapacity(event.capacity)) {
    updates.capacity = input.capacity;
  }

  return updates;
}

function normalizedCapacity(value: number | null): number | null {
  return value && value > 0 ? value : null;
}

function sameOptionalText(left: unknown, right: unknown): boolean {
  const normalize = (value: unknown) => (
    typeof value === "string" ? cleanString(value) : value ?? null
  );
  return normalize(left) === normalize(right);
}

function cleanString(value: string): string | null {
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function sameInstant(left: string | null, right: string | null): boolean {
  if (left === null || right === null) {
    return left === right;
  }

  const leftTimestamp = Date.parse(left);
  const rightTimestamp = Date.parse(right);
  return Number.isFinite(leftTimestamp) && Number.isFinite(rightTimestamp)
    ? leftTimestamp === rightTimestamp
    : left === right;
}
