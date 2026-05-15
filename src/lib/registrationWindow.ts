import type { EventOccurrence } from '@/types/eventOccurrence';

export type RegistrationWindowState =
  | 'open'
  | 'not_yet_open'
  | 'closed'
  | 'no_window';

export type RegistrationWindowInfo = {
  state: RegistrationWindowState;
  opensAt: string | null;
  closesAt: string | null;
  label: string;
  shortCtaLabel: string;
};

const ACTIVE_OCCURRENCE_STATUS = 'active';

function parseTime(value: string | null | undefined): number | null {
  if (!value) {
    return null;
  }

  const time = new Date(value).getTime();

  return Number.isNaN(time) ? null : time;
}

function getNowTime(now: Date | number = Date.now()): number {
  return typeof now === 'number' ? now : now.getTime();
}

function formatDatePart(value: string, timeZone?: string | null): string {
  const options: Intl.DateTimeFormatOptions = {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  };

  if (timeZone) {
    options.timeZone = timeZone;
  }

  try {
    return new Intl.DateTimeFormat('ru-RU', options).format(new Date(value));
  } catch {
    delete options.timeZone;
    return new Intl.DateTimeFormat('ru-RU', options).format(new Date(value));
  }
}

function formatTimePart(value: string, timeZone?: string | null): string {
  const options: Intl.DateTimeFormatOptions = {
    hour: '2-digit',
    minute: '2-digit',
  };

  if (timeZone) {
    options.timeZone = timeZone;
  }

  try {
    return new Intl.DateTimeFormat('ru-RU', options).format(new Date(value));
  } catch {
    delete options.timeZone;
    return new Intl.DateTimeFormat('ru-RU', options).format(new Date(value));
  }
}

export function formatRegistrationDateTime(
  value: string,
  timeZone?: string | null,
): string {
  return `${formatDatePart(value, timeZone)} в ${formatTimePart(value, timeZone)}`;
}

export function getRegistrationWindowInfo(
  occurrence: EventOccurrence | null | undefined,
  now: Date | number = Date.now(),
): RegistrationWindowInfo {
  if (!occurrence || occurrence.status !== ACTIVE_OCCURRENCE_STATUS) {
    return {
      state: 'no_window',
      opensAt: null,
      closesAt: null,
      label: 'Регистрация сейчас недоступна',
      shortCtaLabel: 'Регистрация сейчас недоступна',
    };
  }

  const opensAt = occurrence.registrationOpensAt;
  const closesAt = occurrence.registrationClosesAt;
  const opensAtTime = parseTime(opensAt);
  const closesAtTime = parseTime(closesAt);
  const nowTime = getNowTime(now);

  if (opensAt && opensAtTime !== null && nowTime < opensAtTime) {
    const formattedOpensAt = formatRegistrationDateTime(opensAt, occurrence.timezone);

    return {
      state: 'not_yet_open',
      opensAt,
      closesAt,
      label: `Откроется ${formattedOpensAt}`,
      shortCtaLabel: 'Регистрация сейчас недоступна',
    };
  }

  if (closesAt && closesAtTime !== null && nowTime > closesAtTime) {
    return {
      state: 'closed',
      opensAt,
      closesAt,
      label: 'Регистрация закрыта',
      shortCtaLabel: 'Регистрация сейчас недоступна',
    };
  }

  return {
    state: 'open',
    opensAt,
    closesAt,
    label: 'Регистрация открыта',
    shortCtaLabel: 'Выбрать участие',
  };
}

export function isRegistrationWindowOpen(
  occurrence: EventOccurrence | null | undefined,
  now: Date | number = Date.now(),
): boolean {
  return getRegistrationWindowInfo(occurrence, now).state === 'open';
}

export function getOpenOccurrences(
  occurrences: EventOccurrence[],
  now: Date | number = Date.now(),
): EventOccurrence[] {
  return occurrences.filter((occurrence) => isRegistrationWindowOpen(occurrence, now));
}

function parseOccurrenceStartTime(occurrence: EventOccurrence): number {
  const time = parseTime(occurrence.startsAt);

  return time ?? Number.POSITIVE_INFINITY;
}

export function getNearestOccurrence(
  occurrences: EventOccurrence[],
): EventOccurrence | null {
  return [...occurrences].sort((first, second) => (
    parseOccurrenceStartTime(first) - parseOccurrenceStartTime(second)
  ))[0] ?? null;
}

export function getNearestFutureOpening(
  occurrences: EventOccurrence[],
  now: Date | number = Date.now(),
): EventOccurrence | null {
  const nowTime = getNowTime(now);

  return [...occurrences]
    .filter((occurrence) => {
      const info = getRegistrationWindowInfo(occurrence, nowTime);
      const opensAtTime = parseTime(info.opensAt);

      return info.state === 'not_yet_open' && opensAtTime !== null && opensAtTime > nowTime;
    })
    .sort((first, second) => (
      (parseTime(first.registrationOpensAt) ?? Number.POSITIVE_INFINITY)
      - (parseTime(second.registrationOpensAt) ?? Number.POSITIVE_INFINITY)
    ))[0] ?? null;
}

export function getNextRegistrationOpening(
  occurrences: EventOccurrence[],
  now: Date | number = Date.now(),
): EventOccurrence | null {
  return getNearestFutureOpening(occurrences, now);
}

export function formatRegistrationWindowLabel(
  occurrence: EventOccurrence | null | undefined,
  now: Date | number = Date.now(),
): string {
  return getRegistrationWindowInfo(occurrence, now).label;
}

export function getUnavailableRegistrationText(
  occurrences: EventOccurrence[],
  now: Date | number = Date.now(),
): string {
  const nextOpening = getNearestFutureOpening(occurrences, now);

  if (nextOpening?.registrationOpensAt) {
    return `Запись откроется ${formatRegistrationDateTime(
      nextOpening.registrationOpensAt,
      nextOpening.timezone,
    )}`;
  }

  const nearestWindow = getRegistrationWindowInfo(getNearestOccurrence(occurrences), now);

  return nearestWindow.state === 'closed'
    ? 'Запись на ближайший сеанс закрыта'
    : 'Нет доступных сеансов для записи';
}
