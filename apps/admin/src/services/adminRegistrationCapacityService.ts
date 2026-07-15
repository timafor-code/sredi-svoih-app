import { getAdminRegistrationCapacityAnalytics as getAnalytics } from "./adminRegistrationCapacityApiService";
import { listAdminEventParticipationOptionRows } from "./adminParticipationOptionsApiService";
import { listEventRegistrations } from "./adminRegistrationApiService";
import type {
  AdminRegistrationCapacityAnalytics,
  AdminRegistrationCapacityBucket,
  GetAdminRegistrationCapacityGuestPoolParams,
  ListAdminRegistrationCapacityBucketsParams,
} from "../types/registrationCapacity";
import type {
  AdminEventRegistrationRow,
  AdminRegistrationStatus,
} from "../types/registrations";
import type {
  SeatingGuestPoolItem,
  SeatingGuestPoolObligationSource,
} from "../types/seating";

type OptionCapacityUnitMapping = {
  optionId: string;
  seatsPerQuantity: number;
};

type RegistrationSeatObligation = {
  optionIds: string[];
  optionTitles: string[];
  seatsCount: number;
};

const REGISTRATION_GUEST_POOL_PAGE_SIZE = 200;
const SEATING_GUEST_POOL_STATUSES = [
  "confirmed",
  "pending",
  "attended",
] as const satisfies readonly AdminRegistrationStatus[];

export async function getAdminRegistrationCapacityAnalytics(
  params: ListAdminRegistrationCapacityBucketsParams,
): Promise<AdminRegistrationCapacityAnalytics> {
  return getAnalytics(params);
}

export async function listAdminRegistrationCapacityBuckets(
  params: ListAdminRegistrationCapacityBucketsParams,
): Promise<AdminRegistrationCapacityBucket[]> {
  return (await getAnalytics(params)).buckets;
}

export async function getAdminRegistrationCapacityGuestPool(
  params: GetAdminRegistrationCapacityGuestPoolParams,
): Promise<SeatingGuestPoolItem[]> {
  const [registrations, options] = await Promise.all([
    listActiveRegistrationsForGuestPool(params),
    listAdminEventParticipationOptionRows(params.eventId),
  ]);
  const mappingsByOptionId = new Map<string, OptionCapacityUnitMapping>();

  options.forEach((option) => {
    (option.capacity_units ?? []).forEach((mapping) => {
      if (mapping.capacity_unit_id === params.capacityUnitId) {
        mappingsByOptionId.set(option.id, {
          optionId: option.id,
          seatsPerQuantity: Math.max(1, Math.floor(mapping.seats_per_quantity)),
        });
      }
    });
  });

  const obligations = buildRegistrationSeatObligations(registrations, mappingsByOptionId);
  return buildSeatingGuestPool({ obligations, params, registrations });
}

export function seatInitials(name: string | null | undefined): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  const initials = parts
    .slice(0, 2)
    .map((part) => Array.from(part)[0]?.toLocaleUpperCase("ru-RU") ?? "")
    .join("");

  return initials || "?";
}

async function listActiveRegistrationsForGuestPool(
  params: ListAdminRegistrationCapacityBucketsParams,
): Promise<AdminEventRegistrationRow[]> {
  const pagesByStatus = await Promise.all(
    SEATING_GUEST_POOL_STATUSES.map((status) =>
      listRegistrationsForGuestPoolStatus(params, status),
    ),
  );
  const byId = new Map<string, AdminEventRegistrationRow>();

  pagesByStatus.flat().forEach((registration) => {
    if (registration.id) {
      byId.set(registration.id, registration);
    }
  });

  return Array.from(byId.values()).sort(compareRegistrationsForGuestPool);
}

async function listRegistrationsForGuestPoolStatus(
  params: ListAdminRegistrationCapacityBucketsParams,
  status: AdminRegistrationStatus,
): Promise<AdminEventRegistrationRow[]> {
  const registrations: AdminEventRegistrationRow[] = [];
  let offset = 0;

  while (true) {
    const page = await listEventRegistrations({
      eventId: params.eventId,
      limit: REGISTRATION_GUEST_POOL_PAGE_SIZE,
      occurrenceId: params.occurrenceId,
      offset,
      search: null,
      status,
    });

    registrations.push(...page);

    if (page.length < REGISTRATION_GUEST_POOL_PAGE_SIZE) {
      return registrations;
    }

    offset += page.length;
  }
}

function buildRegistrationSeatObligations(
  registrations: AdminEventRegistrationRow[],
  mappingsByOptionId: Map<string, OptionCapacityUnitMapping>,
): Map<string, RegistrationSeatObligation> {
  const obligations = new Map<string, RegistrationSeatObligation>();

  registrations.forEach((registration) => {
    registration.selectedOptions.forEach((option) => {
      if (!option.optionId || option.isDonation || option.countsTowardCapacity === false) {
        return;
      }

      const mapping = mappingsByOptionId.get(option.optionId);
      if (!mapping) {
        return;
      }

      addSeatObligation(obligations, {
        optionId: mapping.optionId,
        optionTitle: option.title,
        registrationId: registration.id,
        seatsCount: option.quantity * mapping.seatsPerQuantity,
      });
    });
  });

  return obligations;
}

function buildSeatingGuestPool({
  obligations,
  params,
  registrations,
}: {
  obligations: Map<string, RegistrationSeatObligation>;
  params: GetAdminRegistrationCapacityGuestPoolParams;
  registrations: AdminEventRegistrationRow[];
}): SeatingGuestPoolItem[] {
  return registrations.flatMap((registration) => {
    const obligation = obligations.get(registration.id);
    const seatsCount = Math.max(0, Math.floor(obligation?.seatsCount ?? 0));

    if (seatsCount === 0) {
      return [];
    }

    const participantName = safeDisplayName(registration.participantDisplayName, "Участник");
    const optionTitles = obligation?.optionTitles ?? [];
    const optionIds = obligation?.optionIds ?? [];
    const seatObligationSource: SeatingGuestPoolObligationSource = "mapped_option";
    const items: SeatingGuestPoolItem[] = [
      {
        capacityReservationIds: [],
        capacityUnitId: params.capacityUnitId,
        displayName: participantName,
        email: registration.email,
        guestIndex: null,
        guestName: null,
        id: seatingGuestPoolKey(registration.id, "participant", 0, params.capacityUnitId),
        initials: seatInitials(participantName),
        key: seatingGuestPoolKey(registration.id, "participant", 0, params.capacityUnitId),
        occurrenceId: params.occurrenceId,
        optionIds,
        optionTitles,
        participantDisplayName: participantName,
        participantUserId: registration.userId || null,
        paymentStatus: registration.paymentStatus,
        phone: registration.phone,
        registrationId: registration.id,
        seatObligationSource,
        source: "participant",
        sourceLabel: "Участник",
        status: registration.status,
      },
    ];
    const guestNames = normalizeGuestNames(registration.guestNames);

    for (let index = 0; index < seatsCount - 1; index += 1) {
      const guestIndex = index + 1;
      const guestName = guestNames[index] ?? null;
      const displayName = guestName ?? `Гость ${guestIndex} · ${participantName}`;

      items.push({
        capacityReservationIds: [],
        capacityUnitId: params.capacityUnitId,
        displayName,
        email: registration.email,
        guestIndex,
        guestName,
        id: seatingGuestPoolKey(registration.id, "guest", guestIndex, params.capacityUnitId),
        initials: seatInitials(guestName ?? `Гость ${guestIndex}`),
        key: seatingGuestPoolKey(registration.id, "guest", guestIndex, params.capacityUnitId),
        occurrenceId: params.occurrenceId,
        optionIds,
        optionTitles,
        participantDisplayName: participantName,
        participantUserId: registration.userId || null,
        paymentStatus: registration.paymentStatus,
        phone: registration.phone,
        registrationId: registration.id,
        seatObligationSource,
        source: "guest",
        sourceLabel: "Гость",
        status: registration.status,
      });
    }

    return items;
  });
}

function addSeatObligation(
  obligations: Map<string, RegistrationSeatObligation>,
  {
    optionId,
    optionTitle,
    registrationId,
    seatsCount,
  }: {
    optionId: string;
    optionTitle: string;
    registrationId: string;
    seatsCount: number;
  },
) {
  if (!registrationId || seatsCount <= 0) {
    return;
  }

  const current = obligations.get(registrationId) ?? {
    optionIds: [],
    optionTitles: [],
    seatsCount: 0,
  };
  const title = optionTitle.trim();

  obligations.set(registrationId, {
    optionIds: !current.optionIds.includes(optionId)
      ? [...current.optionIds, optionId]
      : current.optionIds,
    optionTitles: title && !current.optionTitles.includes(title)
      ? [...current.optionTitles, title]
      : current.optionTitles,
    seatsCount: current.seatsCount + Math.floor(seatsCount),
  });
}

function compareRegistrationsForGuestPool(
  left: AdminEventRegistrationRow,
  right: AdminEventRegistrationRow,
): number {
  const leftTime = new Date(left.registeredAt || left.createdAt).getTime();
  const rightTime = new Date(right.registeredAt || right.createdAt).getTime();

  if (Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime !== rightTime) {
    return rightTime - leftTime;
  }

  return left.id.localeCompare(right.id);
}

function normalizeGuestNames(guestNames: string[]): string[] {
  return guestNames
    .map((guestName) => guestName.trim())
    .filter((guestName) => guestName.length > 0);
}

function safeDisplayName(name: string | null | undefined, fallback: string): string {
  const trimmed = name?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : fallback;
}

function seatingGuestPoolKey(
  registrationId: string,
  source: "participant" | "guest",
  index: number,
  capacityUnitId: string,
): string {
  return `${registrationId}:${capacityUnitId}:${source}:${index}`;
}
