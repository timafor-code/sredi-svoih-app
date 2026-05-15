import {
  ACTIVE_EVENT_REGISTRATION_STATUSES,
  type EventRegistration,
  type EventRegistrationStatus,
} from '@/types/event';

export type RegistrationAmountSummary = {
  totalAmount: number | null;
  totalCurrency: string | null;
};

export type MyRegistrationGroup = RegistrationAmountSummary & {
  activeRegistrationsCount: number;
  cancelledRegistrationsCount: number;
  event: EventRegistration['event'];
  eventId: string;
  nearestOccurrenceDate: string | null;
  nextRegistration: EventRegistration | null;
  registrations: EventRegistration[];
  statusesSummary: Partial<Record<EventRegistrationStatus, number>>;
  totalRegistrationsCount: number;
};

type RegistrationDateMatch = {
  registration: EventRegistration;
  time: number;
};

type KnownRegistrationAmount = {
  totalAmount: number;
  totalCurrency: string;
};

const activeStatuses = new Set<EventRegistrationStatus>(ACTIVE_EVENT_REGISTRATION_STATUSES);

export const INACTIVE_EVENT_REGISTRATION_STATUSES = new Set<EventRegistrationStatus>([
  'cancelled',
  'rejected',
  'attended',
  'no_show',
]);

const statusSummaryLabels: Record<EventRegistrationStatus, [string, string, string]> = {
  confirmed: ['подтверждена', 'подтверждены', 'подтверждено'],
  pending: ['ожидает', 'ожидают', 'ожидают'],
  waitlisted: ['в ожидании', 'в ожидании', 'в ожидании'],
  cancelled: ['отменена', 'отменены', 'отменено'],
  rejected: ['отклонена', 'отклонены', 'отклонено'],
  attended: ['посещена', 'посещены', 'посещено'],
  no_show: ['пропущена', 'пропущены', 'пропущено'],
};

const statusSummaryOrder: EventRegistrationStatus[] = [
  'confirmed',
  'pending',
  'waitlisted',
  'cancelled',
  'rejected',
  'attended',
  'no_show',
];

export function parseRegistrationDate(value: string | null | undefined): number | null {
  if (!value) {
    return null;
  }

  const time = new Date(value).getTime();

  return Number.isNaN(time) ? null : time;
}

export function isActiveRegistrationStatus(status: EventRegistrationStatus): boolean {
  return activeStatuses.has(status);
}

export function getRegistrationStartsAt(registration: EventRegistration): string | null {
  return registration.occurrence?.startsAt ?? registration.event?.startsAt ?? null;
}

export function getRegistrationEndsAt(registration: EventRegistration): string | null {
  return registration.occurrence?.endsAt ?? registration.event?.endsAt ?? null;
}

export function getRegistrationTimezone(registration: EventRegistration): string | null | undefined {
  return registration.occurrence?.timezone ?? registration.event?.timezone;
}

export function getRegistrationSessionTitle(registration: EventRegistration): string | null {
  return registration.occurrence?.title ?? null;
}

export function hasRegistrationPassed(registration: EventRegistration, now = Date.now()): boolean {
  const time = parseRegistrationDate(getRegistrationEndsAt(registration))
    ?? parseRegistrationDate(getRegistrationStartsAt(registration));

  return time !== null && time < now;
}

export function getRegistrationSortTime(registration: EventRegistration): number | null {
  return parseRegistrationDate(getRegistrationStartsAt(registration));
}

function getFallbackSortTime(registration: EventRegistration): number {
  return getRegistrationSortTime(registration) ?? parseRegistrationDate(registration.registeredAt) ?? 0;
}

export function sortRegistrationsByOccurrence(
  registrations: EventRegistration[],
): EventRegistration[] {
  return [...registrations].sort((first, second) => {
    const firstStartsAt = getRegistrationSortTime(first);
    const secondStartsAt = getRegistrationSortTime(second);

    if (firstStartsAt !== null && secondStartsAt !== null && firstStartsAt !== secondStartsAt) {
      return firstStartsAt - secondStartsAt;
    }

    if (firstStartsAt !== null && secondStartsAt === null) {
      return -1;
    }

    if (firstStartsAt === null && secondStartsAt !== null) {
      return 1;
    }

    const firstRegisteredAt = parseRegistrationDate(first.registeredAt) ?? 0;
    const secondRegisteredAt = parseRegistrationDate(second.registeredAt) ?? 0;

    return secondRegisteredAt - firstRegisteredAt;
  });
}

function getDatedRegistrations(registrations: EventRegistration[]): RegistrationDateMatch[] {
  return registrations
    .map((registration) => ({
      registration,
      time: getRegistrationSortTime(registration),
    }))
    .filter((item): item is RegistrationDateMatch => item.time !== null);
}

function pickNextRegistration(
  registrations: EventRegistration[],
  now: number,
): EventRegistration | null {
  const datedRegistrations = getDatedRegistrations(registrations);
  const futureActive = datedRegistrations
    .filter((item) => item.time >= now && isActiveRegistrationStatus(item.registration.status))
    .sort((first, second) => first.time - second.time);

  if (futureActive[0]) {
    return futureActive[0].registration;
  }

  const futureAny = datedRegistrations
    .filter((item) => item.time >= now)
    .sort((first, second) => first.time - second.time);

  if (futureAny[0]) {
    return futureAny[0].registration;
  }

  const pastAny = datedRegistrations.sort((first, second) => second.time - first.time);

  return pastAny[0]?.registration ?? sortRegistrationsByOccurrence(registrations)[0] ?? null;
}

function getGroupSortProfile(registrations: EventRegistration[], now: number) {
  const datedRegistrations = getDatedRegistrations(registrations);
  const future = datedRegistrations
    .filter((item) => item.time >= now)
    .sort((first, second) => first.time - second.time);

  if (future[0]) {
    return {
      bucket: 0,
      sortTime: future[0].time,
    };
  }

  const past = datedRegistrations
    .filter((item) => item.time < now)
    .sort((first, second) => second.time - first.time);

  if (past[0]) {
    return {
      bucket: 1,
      sortTime: past[0].time,
    };
  }

  return {
    bucket: 2,
    sortTime: Math.max(...registrations.map((item) => getFallbackSortTime(item)), 0),
  };
}

function getStatusCounts(
  registrations: EventRegistration[],
): Partial<Record<EventRegistrationStatus, number>> {
  return registrations.reduce<Partial<Record<EventRegistrationStatus, number>>>((acc, registration) => {
    acc[registration.status] = (acc[registration.status] ?? 0) + 1;
    return acc;
  }, {});
}

function getRegistrationAmount(registration: EventRegistration): RegistrationAmountSummary {
  if (registration.totalAmount === null || registration.totalAmount === undefined) {
    return {
      totalAmount: null,
      totalCurrency: null,
    };
  }

  return {
    totalAmount: registration.totalAmount,
    totalCurrency: registration.totalCurrency
      ?? registration.selectedOptions.find((option) => option.currency)?.currency
      ?? registration.event?.priceCurrency
      ?? 'RUB',
  };
}

function getAmountSummary(registrations: EventRegistration[]): RegistrationAmountSummary {
  const activeRegistrations = registrations.filter((registration) => (
    isActiveRegistrationStatus(registration.status)
  ));
  const amountSource = activeRegistrations.length > 0 ? activeRegistrations : registrations;
  const amounts = amountSource
    .map(getRegistrationAmount)
    .filter((item): item is KnownRegistrationAmount => (
      item.totalAmount !== null && item.totalCurrency !== null
    ));

  if (amounts.length === 0) {
    return {
      totalAmount: null,
      totalCurrency: null,
    };
  }

  const currency = amounts[0].totalCurrency;

  if (!amounts.every((item) => item.totalCurrency === currency)) {
    return {
      totalAmount: null,
      totalCurrency: null,
    };
  }

  return {
    totalAmount: amounts.reduce((sum, item) => sum + item.totalAmount, 0),
    totalCurrency: currency,
  };
}

export function buildMyRegistrationGroups(
  registrations: EventRegistration[],
  now = Date.now(),
): MyRegistrationGroup[] {
  const grouped = new Map<string, EventRegistration[]>();

  registrations.forEach((registration) => {
    const current = grouped.get(registration.eventId) ?? [];
    current.push(registration);
    grouped.set(registration.eventId, current);
  });

  return Array.from(grouped.entries())
    .map(([eventId, groupRegistrations]) => {
      const sortedRegistrations = sortRegistrationsByOccurrence(groupRegistrations);
      const nextRegistration = pickNextRegistration(sortedRegistrations, now);
      const amountSummary = getAmountSummary(sortedRegistrations);

      return {
        ...amountSummary,
        activeRegistrationsCount: sortedRegistrations.filter((registration) => (
          isActiveRegistrationStatus(registration.status)
        )).length,
        cancelledRegistrationsCount: sortedRegistrations.filter((registration) => (
          registration.status === 'cancelled'
        )).length,
        event: sortedRegistrations.find((registration) => registration.event)?.event,
        eventId,
        nearestOccurrenceDate: nextRegistration ? getRegistrationStartsAt(nextRegistration) : null,
        nextRegistration,
        registrations: sortedRegistrations,
        statusesSummary: getStatusCounts(sortedRegistrations),
        totalRegistrationsCount: sortedRegistrations.length,
      };
    })
    .sort((first, second) => {
      const firstProfile = getGroupSortProfile(first.registrations, now);
      const secondProfile = getGroupSortProfile(second.registrations, now);

      if (firstProfile.bucket !== secondProfile.bucket) {
        return firstProfile.bucket - secondProfile.bucket;
      }

      return firstProfile.bucket === 0
        ? firstProfile.sortTime - secondProfile.sortTime
        : secondProfile.sortTime - firstProfile.sortTime;
    });
}

function getRussianPluralIndex(count: number): 0 | 1 | 2 {
  const mod10 = count % 10;
  const mod100 = count % 100;

  if (mod10 === 1 && mod100 !== 11) {
    return 0;
  }

  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) {
    return 1;
  }

  return 2;
}

export function formatRegistrationCount(count: number): string {
  const labels = ['запись', 'записи', 'записей'];

  return `${count} ${labels[getRussianPluralIndex(count)]}`;
}

export function formatGroupStatusSummary(
  statusesSummary: Partial<Record<EventRegistrationStatus, number>>,
): string {
  return statusSummaryOrder
    .map((status) => {
      const count = statusesSummary[status] ?? 0;

      if (count <= 0) {
        return null;
      }

      return `${count} ${statusSummaryLabels[status][getRussianPluralIndex(count)]}`;
    })
    .filter((item): item is string => Boolean(item))
    .join(' · ');
}
