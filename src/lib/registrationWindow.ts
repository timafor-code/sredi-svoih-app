import type { EventOccurrence } from '@/types/eventOccurrence';
import type { EventItem } from '@/types/event';

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

type OccurrenceChoiceEvent = Pick<EventItem, 'eventKind'> | null | undefined;

function parseTime(value: string | null | undefined): number | null {
  if (!value) {
    return null;
  }

  const time = new Date(value).getTime();

  return Number.isNaN(time) ? null : time;
}

function getNowTime(now: Date | number): number {
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

function buildRegistrationWindowInfo(
  occurrence: EventOccurrence,
  state: Exclude<RegistrationWindowState, 'no_window'> | 'unavailable',
): RegistrationWindowInfo {
  const opensAt = occurrence.registrationOpensAt;
  const closesAt = occurrence.registrationClosesAt;

  switch (state) {
    case 'not_yet_open':
      return {
        state,
        opensAt,
        closesAt,
        label: opensAt
          ? `Откроется ${formatRegistrationDateTime(opensAt, occurrence.timezone)}`
          : 'Регистрация скоро откроется',
        shortCtaLabel: 'Регистрация сейчас недоступна',
      };
    case 'closed':
      return {
        state,
        opensAt,
        closesAt,
        label: 'Регистрация закрыта',
        shortCtaLabel: 'Регистрация сейчас недоступна',
      };
    case 'unavailable':
      return {
        state: 'no_window',
        opensAt,
        closesAt,
        label: 'Регистрация сейчас недоступна',
        shortCtaLabel: 'Регистрация сейчас недоступна',
      };
    case 'open':
    default:
      return {
        state: 'open',
        opensAt,
        closesAt,
        label: 'Регистрация открыта',
        shortCtaLabel: 'Выбрать участие',
      };
  }
}

export function getRegistrationWindowInfo(
  occurrence: EventOccurrence | null | undefined,
  now?: Date | number,
): RegistrationWindowInfo {
  if (!occurrence) {
    return {
      state: 'no_window',
      opensAt: null,
      closesAt: null,
      label: 'Регистрация сейчас недоступна',
      shortCtaLabel: 'Регистрация сейчас недоступна',
    };
  }

  // Client Date.now() is UI fallback only. Server registrationState is the source of truth.
  if (occurrence.registrationState) {
    return buildRegistrationWindowInfo(occurrence, occurrence.registrationState);
  }

  if (occurrence.status !== ACTIVE_OCCURRENCE_STATUS) {
    return buildRegistrationWindowInfo(occurrence, 'unavailable');
  }

  const opensAt = occurrence.registrationOpensAt;
  const closesAt = occurrence.registrationClosesAt;
  const opensAtTime = parseTime(opensAt);
  const closesAtTime = parseTime(closesAt);
  const nowTime = getNowTime(now ?? Date.now());

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

export function isOccurrenceAlwaysOpen(
  occurrence: EventOccurrence | null | undefined,
): boolean {
  if (typeof occurrence?.isRegistrationAlwaysOpen === 'boolean') {
    return occurrence.isRegistrationAlwaysOpen;
  }

  return Boolean(
    occurrence
    && occurrence.status === ACTIVE_OCCURRENCE_STATUS
    && occurrence.registrationOpensAt === null
    && occurrence.registrationClosesAt === null,
  );
}

export function shouldRequireOccurrenceChoice(
  event: OccurrenceChoiceEvent,
  occurrences: EventOccurrence[] | null | undefined,
): boolean {
  if (!occurrences || occurrences.length <= 1) {
    return false;
  }

  if (event?.eventKind === 'shabbat') {
    return false;
  }

  return occurrences.some(isOccurrenceAlwaysOpen);
}

export function isRegistrationWindowOpen(
  occurrence: EventOccurrence | null | undefined,
  now?: Date | number,
): boolean {
  return getRegistrationWindowInfo(occurrence, now).state === 'open';
}

export function getOpenOccurrences(
  occurrences: EventOccurrence[],
  now?: Date | number,
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
  now?: Date | number,
): EventOccurrence | null {
  let fallbackNowTime: number | null = null;
  const getFallbackNowTime = () => {
    fallbackNowTime ??= getNowTime(now ?? Date.now());

    return fallbackNowTime;
  };

  return [...occurrences]
    .filter((occurrence) => {
      const info = occurrence.registrationState
        ? getRegistrationWindowInfo(occurrence)
        : getRegistrationWindowInfo(occurrence, getFallbackNowTime());
      const opensAtTime = parseTime(info.opensAt);

      if (occurrence.registrationState) {
        return info.state === 'not_yet_open' && opensAtTime !== null;
      }

      return info.state === 'not_yet_open'
        && opensAtTime !== null
        && opensAtTime > getFallbackNowTime();
    })
    .sort((first, second) => (
      (parseTime(first.registrationOpensAt) ?? Number.POSITIVE_INFINITY)
      - (parseTime(second.registrationOpensAt) ?? Number.POSITIVE_INFINITY)
    ))[0] ?? null;
}

export function getNextRegistrationOpening(
  occurrences: EventOccurrence[],
  now?: Date | number,
): EventOccurrence | null {
  return getNearestFutureOpening(occurrences, now);
}

export function formatRegistrationWindowLabel(
  occurrence: EventOccurrence | null | undefined,
  now?: Date | number,
): string {
  return getRegistrationWindowInfo(occurrence, now).label;
}

export function getUnavailableRegistrationText(
  occurrences: EventOccurrence[],
  now?: Date | number,
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
