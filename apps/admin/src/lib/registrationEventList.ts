import type {
  AdminRegistrationEventOccurrenceSummary,
  AdminRegistrationEventSummary,
} from "../types/registrations";

export const REGISTRATION_EVENT_LIST_TABS = ["current", "archive"] as const;
export type RegistrationEventListTab = (typeof REGISTRATION_EVENT_LIST_TABS)[number];

export const REGISTRATION_EVENT_LIST_SORTS = [
  "nearest",
  "latest",
  "registrations",
  "new",
  "title",
] as const;
export type RegistrationEventListSort = (typeof REGISTRATION_EVENT_LIST_SORTS)[number];

export const DEFAULT_REGISTRATION_EVENT_LIST_PREFERENCES = {
  tab: "current",
  sort: "nearest",
} as const satisfies RegistrationEventListPreferences;

export type RegistrationEventListPreferences = {
  tab: RegistrationEventListTab;
  sort: RegistrationEventListSort;
};

export type RegistrationEventListEntry = {
  event: AdminRegistrationEventSummary;
  effectiveDate: string | null;
  effectiveTime: number | null;
  isOngoing: boolean;
};

const PREFERENCES_STORAGE_KEY = "admin.registration-event-list.preferences.v1";
const RU_COLLATOR = new Intl.Collator("ru-RU", { sensitivity: "base" });

function timestamp(value: string | null): number | null {
  if (!value) return null;
  const result = new Date(value).getTime();
  return Number.isFinite(result) ? result : null;
}

function isExcludedOccurrence(occurrence: AdminRegistrationEventOccurrenceSummary): boolean {
  return occurrence.status === "archived" || occurrence.status === "cancelled";
}

function isCurrentRange(startsAt: string | null, endsAt: string | null, now: number): boolean {
  const start = timestamp(startsAt);
  if (start === null) return false;
  const end = timestamp(endsAt);
  const completionBoundary = end !== null && end >= start ? end : start;
  return start > now || completionBoundary > now;
}

function isOngoingRange(startsAt: string | null, endsAt: string | null, now: number): boolean {
  const start = timestamp(startsAt);
  const end = timestamp(endsAt);
  return start !== null && end !== null && end >= start && start <= now && end > now;
}

function compareTimeAscending(left: number | null, right: number | null): number {
  if (left === right) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  return left - right;
}

function compareTimeDescending(left: number | null, right: number | null): number {
  return compareTimeAscending(right, left);
}

function newCount(event: AdminRegistrationEventSummary): number {
  return event.pendingCount + event.confirmedCount + event.waitlistedCount;
}

function registrationCount(event: AdminRegistrationEventSummary): number {
  return event.pendingCount + event.confirmedCount + event.waitlistedCount +
    event.cancelledCount + event.rejectedCount + event.attendedCount + event.noShowCount;
}

function relevantOccurrence(
  occurrences: readonly AdminRegistrationEventOccurrenceSummary[],
  tab: RegistrationEventListTab,
  now: number,
): AdminRegistrationEventOccurrenceSummary | null {
  const datedOccurrences = occurrences
    .filter((occurrence) => !isExcludedOccurrence(occurrence) && timestamp(occurrence.startsAt) !== null);

  if (tab === "current") {
    const current = datedOccurrences.filter((occurrence) =>
      isCurrentRange(occurrence.startsAt, occurrence.endsAt, now));
    const ongoing = current.filter((occurrence) => isOngoingRange(
      occurrence.startsAt,
      occurrence.endsAt,
      now,
    ));
    return [...(ongoing.length > 0 ? ongoing : current)]
      .sort((left, right) => compareTimeAscending(timestamp(left.startsAt), timestamp(right.startsAt)))[0] ?? null;
  }

  return datedOccurrences
    .filter((occurrence) => !isCurrentRange(occurrence.startsAt, occurrence.endsAt, now))
    .sort((left, right) => compareTimeDescending(timestamp(left.startsAt), timestamp(right.startsAt)))[0] ?? null;
}

export function getRegistrationEventListEntry(
  event: AdminRegistrationEventSummary,
  tab: RegistrationEventListTab,
  now = Date.now(),
): RegistrationEventListEntry | null {
  const eventIsExplicitlyArchived = event.status === "archived" || event.status === "cancelled";
  if (eventIsExplicitlyArchived && tab !== "archive") return null;

  if (event.occurrences.length > 0) {
    const currentOccurrence = relevantOccurrence(event.occurrences, "current", now);
    if (tab === "current" && !currentOccurrence) return null;
    if (tab === "archive" && currentOccurrence && !eventIsExplicitlyArchived) return null;
    const archivedOccurrence = relevantOccurrence(event.occurrences, "archive", now);
    const fallback = tab === "current"
      ? currentOccurrence
      : archivedOccurrence ?? [...event.occurrences]
        .filter((occurrence) => timestamp(occurrence.startsAt) !== null)
        .sort((left, right) => compareTimeDescending(timestamp(left.startsAt), timestamp(right.startsAt)))[0] ?? null;
    return {
      event,
      effectiveDate: fallback?.startsAt ?? event.startsAt,
      effectiveTime: timestamp(fallback?.startsAt ?? event.startsAt),
      isOngoing: Boolean(fallback && isOngoingRange(fallback.startsAt, fallback.endsAt, now)),
    };
  }

  const current = isCurrentRange(event.startsAt, event.endsAt, now);
  if (!eventIsExplicitlyArchived && (tab === "current") !== current) return null;
  return {
    event,
    effectiveDate: event.startsAt,
    effectiveTime: timestamp(event.startsAt),
    isOngoing: isOngoingRange(event.startsAt, event.endsAt, now),
  };
}

function matchesQuery(entry: RegistrationEventListEntry, query: string): boolean {
  const normalizedQuery = query.trim().toLocaleLowerCase("ru");
  if (!normalizedQuery) return true;
  return [
    entry.event.title,
    entry.event.startsAt,
    entry.effectiveDate,
    entry.event.eventKind,
    entry.event.registrationMode,
  ].filter(Boolean).join(" ").toLocaleLowerCase("ru").includes(normalizedQuery);
}

export function getRegistrationEventList(
  events: readonly AdminRegistrationEventSummary[],
  { tab, sort, query, now = Date.now() }: RegistrationEventListPreferences & { query: string; now?: number },
): RegistrationEventListEntry[] {
  const entries = events
    .map((event) => getRegistrationEventListEntry(event, tab, now))
    .filter((entry): entry is RegistrationEventListEntry => entry !== null)
    .filter((entry) => matchesQuery(entry, query));

  return [...entries].sort((left, right) => {
    let comparison = 0;
    if (sort === "nearest") {
      comparison = tab === "current" && left.isOngoing !== right.isOngoing
        ? left.isOngoing ? -1 : 1
        : tab === "current"
          ? compareTimeAscending(left.effectiveTime, right.effectiveTime)
          : compareTimeDescending(left.effectiveTime, right.effectiveTime);
    } else if (sort === "latest") {
      comparison = compareTimeDescending(left.effectiveTime, right.effectiveTime);
    } else if (sort === "registrations") {
      comparison = registrationCount(right.event) - registrationCount(left.event);
    } else if (sort === "new") {
      comparison = newCount(right.event) - newCount(left.event);
    } else {
      comparison = RU_COLLATOR.compare(left.event.title, right.event.title);
    }

    if (comparison !== 0) return comparison;
    comparison = sort === "latest" || tab === "archive"
      ? compareTimeDescending(left.effectiveTime, right.effectiveTime)
      : compareTimeAscending(left.effectiveTime, right.effectiveTime);
    if (comparison !== 0) return comparison;
    return left.event.eventId.localeCompare(right.event.eventId);
  });
}

export function validateRegistrationEventListPreferences(
  value: unknown,
): RegistrationEventListPreferences {
  if (!value || typeof value !== "object") return { ...DEFAULT_REGISTRATION_EVENT_LIST_PREFERENCES };
  const candidate = value as Partial<RegistrationEventListPreferences>;
  return {
    tab: REGISTRATION_EVENT_LIST_TABS.includes(candidate.tab as RegistrationEventListTab)
      ? candidate.tab as RegistrationEventListTab
      : DEFAULT_REGISTRATION_EVENT_LIST_PREFERENCES.tab,
    sort: REGISTRATION_EVENT_LIST_SORTS.includes(candidate.sort as RegistrationEventListSort)
      ? candidate.sort as RegistrationEventListSort
      : DEFAULT_REGISTRATION_EVENT_LIST_PREFERENCES.sort,
  };
}

export function readRegistrationEventListPreferences(
  storage: Pick<Storage, "getItem"> | null | undefined,
): RegistrationEventListPreferences {
  try {
    return validateRegistrationEventListPreferences(JSON.parse(storage?.getItem(PREFERENCES_STORAGE_KEY) ?? "null"));
  } catch {
    return { ...DEFAULT_REGISTRATION_EVENT_LIST_PREFERENCES };
  }
}

export function saveRegistrationEventListPreferences(
  preferences: RegistrationEventListPreferences,
  storage: Pick<Storage, "setItem"> | null | undefined,
): void {
  try {
    storage?.setItem(PREFERENCES_STORAGE_KEY, JSON.stringify(validateRegistrationEventListPreferences(preferences)));
  } catch {
    // Local preference persistence is intentionally best-effort.
  }
}
