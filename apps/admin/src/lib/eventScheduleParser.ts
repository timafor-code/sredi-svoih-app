import type {
  AdminEventSchedule,
} from "../types/events";

type ParserParticipationOption = Readonly<{
  id: string;
  title: string;
}>;

export type ParsedEventScheduleResult = Readonly<{
  schedule: AdminEventSchedule | null;
  remainder: string[];
}>;

type ParseEventScheduleInput = Readonly<{
  description: string;
  startDate: string;
  participationOptions: readonly ParserParticipationOption[];
}>;

const MONTHS: Readonly<Record<string, number>> = {
  января: 0,
  февраля: 1,
  марта: 2,
  апреля: 3,
  мая: 4,
  июня: 5,
  июля: 6,
  августа: 7,
  сентября: 8,
  октября: 9,
  ноября: 10,
  декабря: 11,
};

const DAY_HEADING = /^(\d{1,2})\s+([а-яё]+)(?:\s*(?:,|—|–|-)\s*(.+?))?$/i;
const PROGRAMME_ITEM = /^(\d{1,2}):([0-5]\d)(?:\s*(?:—|–|-)\s*|\s+)(\S(?:.*\S)?)$/;
const TEHILLIM = /^теилим\s*:?[\s(]*(\d{1,3})\s*(?:—|–|-)\s*(\d{1,3})\s*\)?$/i;

/** Parses the small, deliberately constrained programme notation used in event descriptions. */
export function parseEventScheduleDescription({
  description,
  startDate,
  participationOptions,
}: ParseEventScheduleInput): ParsedEventScheduleResult {
  const year = getYear(startDate);
  const remainder: string[] = [];
  const days: AdminEventSchedule["days"] = [];
  let currentDay: AdminEventSchedule["days"][number] | null = null;

  for (const sourceLine of description.split(/\r?\n/)) {
    const line = cleanSourceLine(sourceLine);
    if (!line) continue;

    const heading = DAY_HEADING.exec(line);
    if (heading && year !== null) {
      const month = MONTHS[heading[2].toLocaleLowerCase("ru-RU")];
      const day = Number(heading[1]);
      const date = month === undefined ? null : createCalendarDate(year, month, day);
      if (date) {
        currentDay = {
          date,
          label: cleanOptionalText(heading[3]),
          note: null,
          items: [],
        };
        days.push(currentDay);
        continue;
      }
    }

    const tehillim = TEHILLIM.exec(line);
    if (tehillim && currentDay) {
      const note = `Теилим ${tehillim[1]}–${tehillim[2]}`;
      if (appendNote(currentDay, note)) continue;
    }

    const item = PROGRAMME_ITEM.exec(line);
    if (item && currentDay) {
      const hour = Number(item[1]);
      if (hour > 23) {
        remainder.push(line);
        continue;
      }
      const title = item[3].trim();
      currentDay.items.push({
        time: `${String(hour).padStart(2, "0")}:${item[2]}`,
        title,
        optionId: findUnambiguousOptionId(title, participationOptions),
      });
      continue;
    }

    remainder.push(line);
  }

  return {
    schedule: days.length > 0 ? { version: 1, days } : null,
    remainder,
  };
}

function cleanSourceLine(value: string): string {
  let line = value.replace(/\u00a0/g, " ").trim().replace(/\s+/g, " ");
  if (/^\*\*.+\*\*$/.test(line)) {
    line = line.slice(2, -2).trim().replace(/\s+/g, " ");
  }
  return line;
}

function appendNote(day: AdminEventSchedule["days"][number], note: string): boolean {
  if (!day.note) {
    day.note = note;
    return true;
  }

  const combined = `${day.note} · ${note}`;
  if (combined.length > 200) return false;
  day.note = combined;
  return true;
}

function getYear(startDate: string): number | null {
  const match = /^(\d{4})-\d{2}-\d{2}$/.exec(startDate);
  if (!match) return null;
  const year = Number(match[1]);
  return Number.isSafeInteger(year) ? year : null;
}

function createCalendarDate(year: number, month: number, day: number): string | null {
  const date = new Date(Date.UTC(year, month, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month || date.getUTCDate() !== day) {
    return null;
  }
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function cleanOptionalText(value: string | undefined): string | null {
  const normalized = value?.trim() ?? "";
  return normalized || null;
}

function findUnambiguousOptionId(
  title: string,
  participationOptions: readonly ParserParticipationOption[],
): string | null {
  const normalizedTitle = normalizeForMatching(title);
  if (!normalizedTitle) return null;
  const matches = participationOptions.filter((option) => (
    normalizeForMatching(option.title) === normalizedTitle
  ));
  return matches.length === 1 ? matches[0].id : null;
}

function normalizeForMatching(value: string): string {
  return value
    .toLocaleLowerCase("ru-RU")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}
