import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { Button } from "../ui/Button";
import {
  listAdminEventOccurrences,
  replaceAdminEventOccurrences,
} from "../../services/adminEventOccurrencesService";
import {
  ADMIN_EVENT_OCCURRENCE_STATUSES,
  type AdminEventOccurrence,
  type AdminEventOccurrenceInput,
  type AdminEventOccurrenceStatus,
} from "../../types/eventOccurrences";

const DEFAULT_TIMEZONE = "Europe/Moscow";

const STATUS_LABELS: Record<AdminEventOccurrenceStatus, string> = {
  active: "Активна",
  hidden: "Скрыта",
  cancelled: "Отменена",
  archived: "В архиве",
};

type GeneratorPreset = "weekly_shabbat" | "weekly_sunday_school" | "custom_weekly";
type GeneratorCapacityMode = "inherit" | "custom";

type OccurrenceGeneratorForm = {
  preset: GeneratorPreset;
  weeksAhead: string;
  startDayOfWeek: number;
  startTime: string;
  endTime: string;
  registrationOpensDayOfWeek: number;
  registrationOpensTime: string;
  registrationClosesDayOfWeek: number;
  registrationClosesTime: string;
  registrationAlwaysOpen: boolean;
  capacityMode: GeneratorCapacityMode;
  customCapacity: string;
  titleTemplate: string;
};

type GeneratorPreviewItem = {
  capacityLabel: string;
  draft: DraftOccurrence;
  duplicate: boolean;
  exists: boolean;
  registrationWindowLabel: string;
  startsAt: string;
  startsAtLabel: string;
  timeRangeLabel: string;
};

type GeneratorPreview = {
  creatableCount: number;
  error: string | null;
  items: GeneratorPreviewItem[];
};

const GENERATOR_PRESET_OPTIONS: Array<{ label: string; value: GeneratorPreset }> = [
  { label: "Шабат каждую неделю", value: "weekly_shabbat" },
  { label: "Воскресная школа каждую неделю", value: "weekly_sunday_school" },
  { label: "Своя еженедельная серия", value: "custom_weekly" },
];

const WEEKDAY_OPTIONS = [
  { label: "Воскресенье", value: 0 },
  { label: "Понедельник", value: 1 },
  { label: "Вторник", value: 2 },
  { label: "Среда", value: 3 },
  { label: "Четверг", value: 4 },
  { label: "Пятница", value: 5 },
  { label: "Суббота", value: 6 },
];

const SHABBAT_START_DAY_OPTIONS = WEEKDAY_OPTIONS.filter((option) =>
  option.value === 5 || option.value === 6
);

type EventOccurrencesConstructorProps = {
  defaultTimezone?: string | null;
  eventKind?: string | null;
  eventCapacity: number | null;
  eventId: string;
};

type DraftOccurrence = {
  draftId: string;
  remoteId: string | null;
  title: string;
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
  timezone: string;
  registrationOpensAt: string;
  registrationClosesAt: string;
  capacity: string;
  waitlistEnabled: boolean;
  requiresApproval: boolean;
  status: AdminEventOccurrenceStatus;
  sortOrder: string;
};

type DraftErrors = Partial<Record<keyof DraftOccurrence, string>>;

type ModalState =
  | { kind: "closed" }
  | { kind: "add"; form: DraftOccurrence; errors: DraftErrors }
  | {
      kind: "edit";
      draftId: string;
      form: DraftOccurrence;
      errors: DraftErrors;
    };

type OccurrenceGroupKey =
  | "attention"
  | "future-active"
  | "hidden-cancelled"
  | "archive";

type OccurrenceGroupItem = {
  draft: DraftOccurrence;
  index: number;
};

type OccurrenceGroup = {
  count: number;
  hint?: string;
  items: OccurrenceGroupItem[];
  key: OccurrenceGroupKey;
  title: string;
};

type ArchiveToastState = {
  id: number;
  message: string;
  undoDrafts: DraftOccurrence[] | null;
};

type DraftValidation =
  | { ok: true; input: AdminEventOccurrenceInput }
  | { ok: false; errors: DraftErrors };

let draftIdCounter = 0;

function nextDraftId(): string {
  draftIdCounter += 1;
  return `occurrence-${Date.now().toString(36)}-${draftIdCounter}`;
}

function isOccurrenceStatus(value: string): value is AdminEventOccurrenceStatus {
  return (ADMIN_EVENT_OCCURRENCE_STATUSES as readonly string[]).includes(value);
}

function cleanString(value: string): string | null {
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function parseInteger(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  if (!/^\d+$/.test(trimmed)) {
    return Number.NaN;
  }

  const parsed = Number(trimmed);
  return Number.isSafeInteger(parsed) ? parsed : Number.NaN;
}

function parseSortOrder(value: string, fallback: number): number {
  const trimmed = value.trim();
  if (!trimmed) {
    return fallback;
  }

  const parsed = Number(trimmed);
  return Number.isSafeInteger(parsed) ? parsed : fallback;
}

function sortDrafts(drafts: DraftOccurrence[]): DraftOccurrence[] {
  return [...drafts].sort((left, right) => {
    const bySortOrder =
      parseSortOrder(left.sortOrder, 0) - parseSortOrder(right.sortOrder, 0);

    if (bySortOrder !== 0) {
      return bySortOrder;
    }

    return (
      draftStartTimestamp(left) - draftStartTimestamp(right)
    );
  });
}

function draftStartTimestamp(draft: DraftOccurrence): number {
  if (!draft.startDate || !draft.startTime) {
    return Number.MAX_SAFE_INTEGER;
  }

  const parsed = new Date(`${draft.startDate}T${draft.startTime}:00Z`).getTime();
  return Number.isNaN(parsed) ? Number.MAX_SAFE_INTEGER : parsed;
}

function draftStartIsoTimestamp(draft: DraftOccurrence): number | null {
  const startsAt = buildDraftStartIso(draft);
  if (!startsAt) {
    return null;
  }

  const timestamp = new Date(startsAt).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

function draftPastBoundaryTimestamp(draft: DraftOccurrence): number | null {
  const boundaryIso = buildDraftEndIso(draft) ?? buildDraftStartIso(draft);
  if (!boundaryIso) {
    return null;
  }

  const timestamp = new Date(boundaryIso).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

function isPastOccurrenceDraft(
  draft: DraftOccurrence,
  nowTimestamp: number,
): boolean {
  const boundaryTimestamp = draftPastBoundaryTimestamp(draft);
  return boundaryTimestamp !== null && boundaryTimestamp < nowTimestamp;
}

function isPastActiveOccurrenceDraft(
  draft: DraftOccurrence,
  nowTimestamp: number,
): boolean {
  return draft.status === "active" && isPastOccurrenceDraft(draft, nowTimestamp);
}

function buildOccurrenceGroups(
  drafts: DraftOccurrence[],
  nowTimestamp: number,
): OccurrenceGroup[] {
  const attention: OccurrenceGroupItem[] = [];
  const futureActive: OccurrenceGroupItem[] = [];
  const hiddenCancelled: OccurrenceGroupItem[] = [];
  const archive: OccurrenceGroupItem[] = [];

  drafts.forEach((draft, index) => {
    const item = { draft, index };

    if (isPastActiveOccurrenceDraft(draft, nowTimestamp)) {
      attention.push(item);
      return;
    }

    if (draft.status === "active") {
      futureActive.push(item);
      return;
    }

    if (draft.status === "hidden" || draft.status === "cancelled") {
      hiddenCancelled.push(item);
      return;
    }

    if (draft.status === "archived") {
      archive.push(item);
    }
  });

  const groups: OccurrenceGroup[] = [
    {
      count: attention.length,
      hint:
        "Эти сеансы уже прошли, но ещё числятся активными. Перенесите их в архив, чтобы они не мешали работе с будущими датами.",
      items: attention,
      key: "attention",
      title: "Требуют внимания",
    },
    {
      count: futureActive.length,
      items: futureActive,
      key: "future-active",
      title: "Активные будущие",
    },
    {
      count: hiddenCancelled.length,
      items: hiddenCancelled,
      key: "hidden-cancelled",
      title: "Скрытые и отменённые",
    },
    {
      count: archive.length,
      items: archive,
      key: "archive",
      title: "Архив",
    },
  ];

  return groups.filter((group) => group.count > 0);
}

function withSequentialSortOrder(drafts: DraftOccurrence[]): DraftOccurrence[] {
  return drafts.map((draft, index) => ({ ...draft, sortOrder: String(index) }));
}

function cloneDrafts(drafts: DraftOccurrence[]): DraftOccurrence[] {
  return drafts.map((draft) => ({ ...draft }));
}

function buildDraftFromOccurrence(
  occurrence: AdminEventOccurrence,
): DraftOccurrence {
  const timezone = cleanString(occurrence.timezone) ?? DEFAULT_TIMEZONE;
  const start = formatDateTimeForForm(occurrence.startsAt, timezone);
  const end = formatDateTimeForForm(occurrence.endsAt, timezone);
  const status = isOccurrenceStatus(occurrence.status)
    ? occurrence.status
    : "active";

  return {
    draftId: nextDraftId(),
    remoteId: occurrence.id,
    title: occurrence.title ?? "",
    startDate: start.date,
    startTime: start.time,
    endDate: end.date,
    endTime: end.time,
    timezone,
    registrationOpensAt: formatDateTimeLocalForForm(
      occurrence.registrationOpensAt,
      timezone,
    ),
    registrationClosesAt: formatDateTimeLocalForForm(
      occurrence.registrationClosesAt,
      timezone,
    ),
    capacity: occurrence.capacity === null ? "" : String(occurrence.capacity),
    waitlistEnabled: occurrence.waitlistEnabled === true,
    requiresApproval: occurrence.requiresApproval === true,
    status,
    sortOrder: String(occurrence.sortOrder),
  };
}

function buildEmptyDraft(index: number, timezone: string): DraftOccurrence {
  return {
    draftId: nextDraftId(),
    remoteId: null,
    title: "",
    startDate: "",
    startTime: "",
    endDate: "",
    endTime: "",
    timezone,
    registrationOpensAt: "",
    registrationClosesAt: "",
    capacity: "",
    waitlistEnabled: false,
    requiresApproval: false,
    status: "active",
    sortOrder: String(index),
  };
}

function validateDraft(
  draft: DraftOccurrence,
  fallbackIndex: number,
): DraftValidation {
  const errors: DraftErrors = {};
  const timezone = cleanString(draft.timezone) ?? DEFAULT_TIMEZONE;
  const status = isOccurrenceStatus(draft.status) ? draft.status : null;

  if (!draft.startDate) {
    errors.startDate = "Укажите дату начала.";
  }

  if (!draft.startTime) {
    errors.startTime = "Укажите время начала.";
  }

  if (!status) {
    errors.status = "Выберите корректный статус.";
  }

  let startsAt: string | null = null;
  if (draft.startDate && draft.startTime) {
    try {
      startsAt = buildZonedIso(draft.startDate, draft.startTime, timezone);
    } catch {
      errors.startDate = "Дата и время начала должны быть валидными.";
      errors.timezone = "Проверьте timezone.";
    }
  }

  let endsAt: string | null = null;
  if (draft.endDate || draft.endTime) {
    if (!draft.endDate) {
      errors.endDate = "Укажите дату окончания или очистите время окончания.";
    }

    if (!draft.endTime) {
      errors.endTime = "Укажите время окончания или очистите дату окончания.";
    }

    if (draft.endDate && draft.endTime) {
      try {
        endsAt = buildZonedIso(draft.endDate, draft.endTime, timezone);
      } catch {
        errors.endDate = "Дата и время окончания должны быть валидными.";
      }
    }
  }

  if (startsAt && endsAt && new Date(endsAt).getTime() <= new Date(startsAt).getTime()) {
    errors.endDate = "Окончание должно быть позже начала.";
  }

  const registrationOpensAt = parseDateTimeLocalField(
    draft.registrationOpensAt,
    timezone,
    "registrationOpensAt",
    errors,
  );
  const registrationClosesAt = parseDateTimeLocalField(
    draft.registrationClosesAt,
    timezone,
    "registrationClosesAt",
    errors,
  );

  if (
    registrationOpensAt &&
    registrationClosesAt &&
    new Date(registrationClosesAt).getTime() <=
      new Date(registrationOpensAt).getTime()
  ) {
    errors.registrationClosesAt =
      "Окончание регистрации должно быть позже начала регистрации.";
  }

  let capacity: number | null = null;
  if (draft.capacity.trim()) {
    const parsedCapacity = parseInteger(draft.capacity);
    if (parsedCapacity === null || Number.isNaN(parsedCapacity) || parsedCapacity <= 0) {
      errors.capacity = "Лимит должен быть положительным целым числом.";
    } else {
      capacity = parsedCapacity;
    }
  }

  const parsedSortOrder = Number(draft.sortOrder);
  const sortOrder = Number.isSafeInteger(parsedSortOrder)
    ? parsedSortOrder
    : fallbackIndex;

  if (draft.sortOrder.trim() && !Number.isSafeInteger(parsedSortOrder)) {
    errors.sortOrder = "Порядок сортировки должен быть целым числом.";
  }

  if (Object.keys(errors).length > 0 || !startsAt || !status) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    input: {
      id: draft.remoteId,
      title: cleanString(draft.title),
      startsAt,
      endsAt,
      timezone,
      registrationOpensAt,
      registrationClosesAt,
      capacity,
      waitlistEnabled: draft.waitlistEnabled,
      requiresApproval: draft.requiresApproval,
      status,
      sortOrder,
    },
  };
}

function parseDateTimeLocalField(
  value: string,
  timezone: string,
  field: "registrationOpensAt" | "registrationClosesAt",
  errors: DraftErrors,
): string | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})$/.exec(trimmed);
  if (!match) {
    errors[field] = "Укажите дату и время в корректном формате.";
    return null;
  }

  try {
    return buildZonedIso(match[1], match[2], timezone);
  } catch {
    errors[field] = "Дата и время регистрации должны быть валидными.";
    return null;
  }
}

function buildInputList(drafts: DraftOccurrence[]): {
  inputs: AdminEventOccurrenceInput[];
  hasErrors: boolean;
} {
  const validations = drafts.map((draft, index) => validateDraft(draft, index));
  const hasErrors = validations.some((entry) => !entry.ok);

  if (hasErrors) {
    return { inputs: [], hasErrors };
  }

  return {
    inputs: validations.map((entry) => {
      if (!entry.ok) {
        throw new Error("unreachable");
      }
      return entry.input;
    }),
    hasErrors: false,
  };
}

function resolveDefaultGeneratorPreset(eventKind?: string | null): GeneratorPreset {
  if (eventKind === "shabbat") {
    return "weekly_shabbat";
  }

  if (eventKind === "sunday_school") {
    return "weekly_sunday_school";
  }

  return "custom_weekly";
}

function buildDefaultGeneratorForm(preset: GeneratorPreset): OccurrenceGeneratorForm {
  if (preset === "weekly_shabbat") {
    return {
      preset,
      weeksAhead: "8",
      startDayOfWeek: 5,
      startTime: "19:00",
      endTime: "22:00",
      registrationOpensDayOfWeek: 0,
      registrationOpensTime: "10:00",
      registrationClosesDayOfWeek: 4,
      registrationClosesTime: "16:00",
      registrationAlwaysOpen: false,
      capacityMode: "inherit",
      customCapacity: "",
      titleTemplate: "Шабат",
    };
  }

  if (preset === "weekly_sunday_school") {
    return {
      preset,
      weeksAhead: "8",
      startDayOfWeek: 0,
      startTime: "11:00",
      endTime: "13:00",
      registrationOpensDayOfWeek: 1,
      registrationOpensTime: "10:00",
      registrationClosesDayOfWeek: 5,
      registrationClosesTime: "16:00",
      registrationAlwaysOpen: false,
      capacityMode: "inherit",
      customCapacity: "",
      titleTemplate: "Воскресная школа",
    };
  }

  return {
    preset,
    weeksAhead: "8",
    startDayOfWeek: 0,
    startTime: "11:00",
    endTime: "",
    registrationOpensDayOfWeek: 1,
    registrationOpensTime: "10:00",
    registrationClosesDayOfWeek: 5,
    registrationClosesTime: "16:00",
    registrationAlwaysOpen: true,
    capacityMode: "inherit",
    customCapacity: "",
    titleTemplate: "",
  };
}

function isGeneratorPreset(value: string): value is GeneratorPreset {
  return GENERATOR_PRESET_OPTIONS.some((option) => option.value === value);
}

function isGeneratorCapacityMode(value: string): value is GeneratorCapacityMode {
  return value === "inherit" || value === "custom";
}

function buildGeneratorPreview(
  form: OccurrenceGeneratorForm,
  drafts: DraftOccurrence[],
  timezone: string,
  eventCapacity: number | null,
): GeneratorPreview {
  const weeksAhead = parseBoundedInteger(form.weeksAhead, 1, 52);
  if (weeksAhead === null) {
    return {
      creatableCount: 0,
      error: "Количество недель должно быть целым числом от 1 до 52.",
      items: [],
    };
  }

  if (!isDayOfWeek(form.startDayOfWeek)) {
    return {
      creatableCount: 0,
      error: "Выберите корректный день события.",
      items: [],
    };
  }

  if (!isTimeValue(form.startTime)) {
    return {
      creatableCount: 0,
      error: "Укажите корректное время начала.",
      items: [],
    };
  }

  if (form.endTime && !isTimeValue(form.endTime)) {
    return {
      creatableCount: 0,
      error: "Укажите корректное время окончания или очистите поле.",
      items: [],
    };
  }

  if (
    !form.registrationAlwaysOpen &&
    ((form.registrationOpensTime && !isTimeValue(form.registrationOpensTime)) ||
      (form.registrationClosesTime && !isTimeValue(form.registrationClosesTime)))
  ) {
    return {
      creatableCount: 0,
      error: "Проверьте время открытия и закрытия регистрации.",
      items: [],
    };
  }

  const customCapacity =
    form.capacityMode === "custom"
      ? parseBoundedInteger(form.customCapacity, 1, Number.MAX_SAFE_INTEGER)
      : null;
  if (form.capacityMode === "custom" && customCapacity === null) {
    return {
      creatableCount: 0,
      error: "Укажите положительный целый лимит для создаваемых дат.",
      items: [],
    };
  }

  const existingStarts = new Set(
    drafts
      .map(buildDraftStartIso)
      .filter((value): value is string => Boolean(value)),
  );
  const seenGeneratedStarts = new Set<string>();
  let firstDate: Date;
  try {
    firstDate = getNextWeekdayDate(form.startDayOfWeek, form.startTime, timezone);
  } catch {
    return {
      creatableCount: 0,
      error: "Проверьте timezone события перед генерацией дат.",
      items: [],
    };
  }
  const items: GeneratorPreviewItem[] = [];

  for (let index = 0; index < weeksAhead; index += 1) {
    const occurrenceDate = addDays(firstDate, index * 7);
    const startDate = formatDateInputValue(occurrenceDate);
    const endDate =
      form.endTime && isEndTimeNextDay(form.startTime, form.endTime)
        ? formatDateInputValue(addDays(occurrenceDate, 1))
        : startDate;
    const registrationOpensDate =
      !form.registrationAlwaysOpen &&
      form.registrationOpensTime &&
      isDayOfWeek(form.registrationOpensDayOfWeek)
        ? formatDateInputValue(
            getPreviousWeekdayDate(occurrenceDate, form.registrationOpensDayOfWeek),
          )
        : "";
    const registrationClosesDate =
      !form.registrationAlwaysOpen &&
      form.registrationClosesTime &&
      isDayOfWeek(form.registrationClosesDayOfWeek)
        ? formatDateInputValue(
            getPreviousWeekdayDate(occurrenceDate, form.registrationClosesDayOfWeek),
          )
        : "";
    const draft: DraftOccurrence = {
      draftId: "",
      remoteId: null,
      title: form.titleTemplate.trim(),
      startDate,
      startTime: form.startTime,
      endDate: form.endTime ? endDate : "",
      endTime: form.endTime,
      timezone,
      registrationOpensAt:
        registrationOpensDate && form.registrationOpensTime
          ? `${registrationOpensDate}T${form.registrationOpensTime}`
          : "",
      registrationClosesAt:
        registrationClosesDate && form.registrationClosesTime
          ? `${registrationClosesDate}T${form.registrationClosesTime}`
          : "",
      capacity:
        form.capacityMode === "custom" && customCapacity !== null
          ? String(customCapacity)
          : "",
      waitlistEnabled: false,
      requiresApproval: false,
      status: "active",
      sortOrder: String(drafts.length + index),
    };
    const validation = validateDraft(draft, drafts.length + index);
    if (!validation.ok) {
      return {
        creatableCount: 0,
        error:
          "Одна из сгенерированных дат не проходит валидацию. Проверьте время события и окно регистрации.",
        items: [],
      };
    }

    const startsAt = validation.input.startsAt;
    const duplicate = seenGeneratedStarts.has(startsAt);
    const exists = existingStarts.has(startsAt);
    seenGeneratedStarts.add(startsAt);
    items.push({
      capacityLabel: formatGeneratorCapacity(draft, eventCapacity),
      draft,
      duplicate,
      exists,
      registrationWindowLabel: form.registrationAlwaysOpen
        ? "Регистрация открыта всегда"
        : formatRegistrationWindow(draft),
      startsAt,
      startsAtLabel: formatDraftDateTime(draft),
      timeRangeLabel: formatDraftTimeRange(draft),
    });
  }

  return {
    creatableCount: items.filter((item) => !item.exists && !item.duplicate).length,
    error: null,
    items,
  };
}

function parseBoundedInteger(
  value: string,
  min: number,
  max: number,
): number | null {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) {
    return null;
  }

  const parsed = Number(trimmed);
  return Number.isSafeInteger(parsed) && parsed >= min && parsed <= max
    ? parsed
    : null;
}

function isDayOfWeek(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= 6;
}

function isTimeValue(value: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function isEndTimeNextDay(startTime: string, endTime: string): boolean {
  return timeToMinutes(endTime) <= timeToMinutes(startTime);
}

function timeToMinutes(value: string): number {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

function getNextWeekdayDate(
  dayOfWeek: number,
  startTime: string,
  timezone: string,
): Date {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let candidate = addDays(today, (dayOfWeek - today.getDay() + 7) % 7);
  const candidateIso = buildZonedIso(
    formatDateInputValue(candidate),
    startTime,
    timezone,
  );

  if (new Date(candidateIso).getTime() <= now.getTime()) {
    candidate = addDays(candidate, 7);
  }

  return candidate;
}

function getPreviousWeekdayDate(fromDate: Date, dayOfWeek: number): Date {
  return addDays(fromDate, -((fromDate.getDay() - dayOfWeek + 7) % 7));
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function formatDateInputValue(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatGeneratorCapacity(
  draft: DraftOccurrence,
  eventCapacity: number | null,
): string {
  if (draft.capacity.trim()) {
    return `Лимит: ${draft.capacity.trim()}`;
  }

  return eventCapacity === null
    ? "Лимит: наследует событие (не задан)"
    : `Лимит: наследует ${eventCapacity}`;
}

export function EventOccurrencesConstructor({
  defaultTimezone,
  eventKind,
  eventCapacity,
  eventId,
}: EventOccurrencesConstructorProps) {
  const fallbackTimezone =
    defaultTimezone && defaultTimezone.trim()
      ? defaultTimezone.trim()
      : DEFAULT_TIMEZONE;

  const [drafts, setDrafts] = useState<DraftOccurrence[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [modalState, setModalState] = useState<ModalState>({ kind: "closed" });
  const [archiveConfirmOpen, setArchiveConfirmOpen] = useState(false);
  const [archiveExpanded, setArchiveExpanded] = useState(false);
  const [archiveToast, setArchiveToast] = useState<ArchiveToastState | null>(null);
  const [nowTimestamp, setNowTimestamp] = useState(() => Date.now());
  const [generatorForm, setGeneratorForm] = useState<OccurrenceGeneratorForm>(() =>
    buildDefaultGeneratorForm(resolveDefaultGeneratorPreset(eventKind)),
  );
  const saveInFlightRef = useRef(false);
  const archiveToastIdRef = useRef(0);

  useEffect(() => {
    const intervalId = window.setInterval(() => setNowTimestamp(Date.now()), 60_000);
    return () => window.clearInterval(intervalId);
  }, []);

  useEffect(() => {
    if (!archiveToast) {
      return undefined;
    }

    const timeoutId = window.setTimeout(() => {
      setArchiveToast((current) =>
        current?.id === archiveToast.id ? null : current,
      );
    }, 6000);

    return () => window.clearTimeout(timeoutId);
  }, [archiveToast]);

  useEffect(() => {
    let cancelled = false;

    setLoading(true);
    setLoadError(null);
    setSaveError(null);
    setSavedAt(null);
    setArchiveToast(null);
    setArchiveExpanded(false);

    listAdminEventOccurrences(eventId)
      .then((occurrences) => {
        if (cancelled) return;
        setDrafts(sortDrafts(occurrences.map(buildDraftFromOccurrence)));
      })
      .catch((error) => {
        if (cancelled) return;
        setLoadError(
          error instanceof Error
            ? error.message
            : "Не удалось загрузить даты и сеансы события.",
        );
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [eventId]);

  useEffect(() => {
    setGeneratorForm(buildDefaultGeneratorForm(resolveDefaultGeneratorPreset(eventKind)));
  }, [eventId, eventKind]);

  const summary = useMemo(() => buildSummary(drafts, eventCapacity, nowTimestamp), [
    drafts,
    eventCapacity,
    nowTimestamp,
  ]);
  const occurrenceGroups = useMemo(
    () => buildOccurrenceGroups(drafts, nowTimestamp),
    [drafts, nowTimestamp],
  );
  const generatorPreview = useMemo(
    () => buildGeneratorPreview(generatorForm, drafts, fallbackTimezone, eventCapacity),
    [drafts, eventCapacity, fallbackTimezone, generatorForm],
  );
  const disabled = loading || saving || Boolean(loadError);
  const hasPastActiveDrafts = summary.pastActiveCount > 0;

  const showArchiveToast = (
    message: string,
    undoDrafts: DraftOccurrence[] | null,
  ) => {
    archiveToastIdRef.current += 1;
    setArchiveToast({
      id: archiveToastIdRef.current,
      message,
      undoDrafts,
    });
  };

  const persistDrafts = async (
    nextDrafts: DraftOccurrence[],
  ): Promise<boolean> => {
    setSaveError(null);
    setSavedAt(null);

    const { inputs, hasErrors } = buildInputList(nextDrafts);
    if (hasErrors) {
      setSaveError(
        "В одной из дат есть ошибки. Откройте дату и исправьте поля.",
      );
      return false;
    }

    saveInFlightRef.current = true;
    setSaving(true);

    try {
      const saved = await replaceAdminEventOccurrences(eventId, inputs);
      setDrafts(sortDrafts(saved.map(buildDraftFromOccurrence)));
      setSaveError(null);
      setSavedAt(new Date().toISOString());
      return true;
    } catch (error) {
      setSaveError(
        error instanceof Error
          ? error.message
          : "Не удалось сохранить даты и сеансы события.",
      );
      return false;
    } finally {
      saveInFlightRef.current = false;
      setSaving(false);
    }
  };

  const applyAndPersist = (updater: (current: DraftOccurrence[]) => DraftOccurrence[]) => {
    if (loading || saveInFlightRef.current) {
      return;
    }

    const nextDrafts = updater(drafts);
    if (nextDrafts === drafts) {
      return;
    }

    setArchiveToast(null);
    setDrafts(nextDrafts);
    void persistDrafts(nextDrafts);
  };

  const openAddModal = () => {
    if (loading || saveInFlightRef.current) return;
    setModalState({
      kind: "add",
      form: buildEmptyDraft(drafts.length, fallbackTimezone),
      errors: {},
    });
  };

  const openEditModal = (draftId: string) => {
    if (loading || saveInFlightRef.current) return;
    const target = drafts.find((draft) => draft.draftId === draftId);
    if (!target) return;

    setModalState({
      kind: "edit",
      draftId,
      form: { ...target },
      errors: {},
    });
  };

  const closeModal = () => {
    setModalState({ kind: "closed" });
  };

  const updateModalForm = (updater: (form: DraftOccurrence) => DraftOccurrence) => {
    setModalState((current) => {
      if (current.kind === "closed") return current;
      return { ...current, form: updater(current.form), errors: {} };
    });
  };

  const submitModal = () => {
    if (saveInFlightRef.current || modalState.kind === "closed") return;

    const fallbackIndex =
      modalState.kind === "edit"
        ? drafts.findIndex((draft) => draft.draftId === modalState.draftId)
        : drafts.length;
    const validation = validateDraft(modalState.form, fallbackIndex);

    if (!validation.ok) {
      setModalState({ ...modalState, errors: validation.errors });
      return;
    }

    if (modalState.kind === "add") {
      const nextDrafts = withSequentialSortOrder([...drafts, modalState.form]);
      setDrafts(nextDrafts);
      void persistDrafts(nextDrafts);
    } else {
      const targetId = modalState.draftId;
      const nextDrafts = drafts.map((draft) =>
        draft.draftId === targetId ? { ...modalState.form, draftId: targetId } : draft,
      );
      setDrafts(nextDrafts);
      void persistDrafts(nextDrafts);
    }

    closeModal();
  };

  const handleStatusChange = (
    draftId: string,
    status: AdminEventOccurrenceStatus,
  ) => {
    applyAndPersist((current) =>
      current.map((draft) =>
        draft.draftId === draftId ? { ...draft, status } : draft,
      ),
    );
  };

  const handleArchivePastOccurrence = (draftId: string) => {
    if (disabled || saveInFlightRef.current) {
      return;
    }

    const archiveTimestamp = Date.now();
    const target = drafts.find((draft) => draft.draftId === draftId);
    if (!target || !isPastActiveOccurrenceDraft(target, archiveTimestamp)) {
      return;
    }

    const archivedStatus: AdminEventOccurrenceStatus = "archived";
    const previousDrafts = cloneDrafts(drafts);
    const nextDrafts = drafts.map((draft) =>
      draft.draftId === draftId ? { ...draft, status: archivedStatus } : draft,
    );

    setNowTimestamp(archiveTimestamp);
    setArchiveToast(null);
    setDrafts(nextDrafts);
    void persistDrafts(nextDrafts).then((saved) => {
      if (saved) {
        showArchiveToast(
          "Сеанс перенесён в архив. Регистрации сохранены.",
          previousDrafts,
        );
      }
    });
  };

  const openArchivePastConfirm = () => {
    if (disabled || !hasPastActiveDrafts) {
      return;
    }

    setArchiveConfirmOpen(true);
  };

  const closeArchivePastConfirm = () => {
    if (saving) {
      return;
    }

    setArchiveConfirmOpen(false);
  };

  const confirmArchivePastOccurrences = () => {
    if (disabled || !hasPastActiveDrafts) {
      return;
    }

    const archiveTimestamp = Date.now();
    let archivedCount = 0;
    const archivedStatus: AdminEventOccurrenceStatus = "archived";
    const previousDrafts = cloneDrafts(drafts);
    const nextDrafts = drafts.map((draft) => {
      if (!isPastActiveOccurrenceDraft(draft, archiveTimestamp)) {
        return draft;
      }

      archivedCount += 1;
      return { ...draft, status: archivedStatus };
    });

    if (archivedCount === 0) {
      return;
    }

    setNowTimestamp(archiveTimestamp);
    setArchiveConfirmOpen(false);
    setArchiveToast(null);
    setDrafts(nextDrafts);
    void persistDrafts(nextDrafts).then((saved) => {
      if (saved) {
        showArchiveToast(
          `${archivedCount} прошедших сеансов перенесены в архив. Регистрации сохранены.`,
          previousDrafts,
        );
      }
    });
  };

  const handleUndoArchive = () => {
    if (disabled || saveInFlightRef.current || !archiveToast?.undoDrafts) {
      return;
    }

    const restoredDrafts = cloneDrafts(archiveToast.undoDrafts);
    setArchiveToast(null);
    setDrafts(restoredDrafts);
    void persistDrafts(restoredDrafts);
  };

  const handleDelete = (draftId: string) => {
    applyAndPersist((current) =>
      withSequentialSortOrder(current.filter((draft) => draft.draftId !== draftId)),
    );
  };

  const handleMove = (draftId: string, direction: -1 | 1) => {
    applyAndPersist((current) => {
      const index = current.findIndex((draft) => draft.draftId === draftId);
      const nextIndex = index + direction;

      if (index < 0 || nextIndex < 0 || nextIndex >= current.length) {
        return current;
      }

      const next = [...current];
      [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
      return withSequentialSortOrder(next);
    });
  };

  const updateGeneratorField = <Field extends keyof OccurrenceGeneratorForm>(
    field: Field,
    value: OccurrenceGeneratorForm[Field],
  ) => {
    setGeneratorForm((current) => ({ ...current, [field]: value }));
  };

  const handleGeneratorPresetChange = (value: string) => {
    if (!isGeneratorPreset(value)) {
      return;
    }

    setGeneratorForm((current) => ({
      ...buildDefaultGeneratorForm(value),
      capacityMode: current.capacityMode,
      customCapacity: current.customCapacity,
      weeksAhead: current.weeksAhead,
    }));
  };

  const handleApplyGeneratedOccurrences = () => {
    if (
      loading ||
      saveInFlightRef.current ||
      generatorPreview.error ||
      generatorPreview.creatableCount === 0
    ) {
      return;
    }

    const generatedDrafts = generatorPreview.items
      .filter((item) => !item.exists && !item.duplicate)
      .map((item) => ({ ...item.draft, draftId: nextDraftId() }));

    if (generatedDrafts.length === 0) {
      return;
    }

    const nextDrafts = withSequentialSortOrder([...drafts, ...generatedDrafts]);
    setDrafts(nextDrafts);
    void persistDrafts(nextDrafts);
  };

  const renderOccurrenceRow = ({ draft, index }: OccurrenceGroupItem) => (
    <OccurrenceRow
      disabled={disabled}
      draft={draft}
      index={index}
      isPastActive={isPastActiveOccurrenceDraft(draft, nowTimestamp)}
      key={draft.draftId}
      onArchive={() => handleArchivePastOccurrence(draft.draftId)}
      onDelete={() => handleDelete(draft.draftId)}
      onEdit={() => openEditModal(draft.draftId)}
      onMoveDown={() => handleMove(draft.draftId, 1)}
      onMoveUp={() => handleMove(draft.draftId, -1)}
      onStatusChange={(status) => handleStatusChange(draft.draftId, status)}
      total={drafts.length}
    />
  );

  return (
    <section className="event-occurrences-constructor">
      <header className="event-occurrences-constructor__head">
        <div>
          <h2>Даты и сеансы</h2>
          <p>
            Это даты внутри одного события. Варианты участия и оплаты остаются
            общими, а лимит мест можно задать отдельно для каждой даты.
          </p>
        </div>
        <div className="event-occurrences-constructor__head-actions">
          {hasPastActiveDrafts ? (
            <Button disabled={disabled} onClick={openArchivePastConfirm} variant="gold">
              Архивировать прошедшие
            </Button>
          ) : null}
          <Button disabled={disabled} onClick={openAddModal} variant="secondary">
            + Добавить дату
          </Button>
        </div>
      </header>

      <div className="event-occurrences-constructor__hint">
        Если лимит даты пустой, она наследует общий capacity события.
      </div>

      {loadError ? (
        <div className="form-error" role="alert">
          {loadError}
        </div>
      ) : null}

      <OccurrenceGenerator
        disabled={disabled}
        eventCapacity={eventCapacity}
        form={generatorForm}
        onApply={handleApplyGeneratedOccurrences}
        onFieldChange={updateGeneratorField}
        onPresetChange={handleGeneratorPresetChange}
        preview={generatorPreview}
      />

      {archiveToast ? (
        <div className="event-occurrences-toast" role="status">
          <span>{archiveToast.message}</span>
          {archiveToast.undoDrafts ? (
            <button
              disabled={disabled}
              onClick={handleUndoArchive}
              type="button"
            >
              Отменить
            </button>
          ) : null}
        </div>
      ) : null}

      <div className="event-occurrences-constructor__layout">
        <div className="event-occurrences-constructor__main">
          {loading ? (
            <p className="event-occurrences-constructor__empty">
              Загружаем даты и сеансы...
            </p>
          ) : drafts.length === 0 ? (
            <div className="event-occurrences-constructor__empty">
              <p>Нет дат. Добавьте первую дату/сеанс.</p>
              <button
                className="event-occurrences-add-btn"
                disabled={disabled}
                onClick={openAddModal}
                type="button"
              >
                + Добавить дату
              </button>
            </div>
          ) : (
            <div className="event-occurrence-list-stack">
              {occurrenceGroups.map((group) => {
                const isArchive = group.key === "archive";
                const archiveCollapsed = isArchive && !archiveExpanded;

                return (
                  <section
                    className={`event-occurrence-group event-occurrence-group--${group.key}`}
                    key={group.key}
                  >
                    <header className="event-occurrence-group__head">
                      <div>
                        <h3>{`${group.title} · ${group.count}`}</h3>
                        {group.hint ? <p>{group.hint}</p> : null}
                      </div>
                      {isArchive ? (
                        <button
                          className="event-occurrence-group__toggle"
                          onClick={() => setArchiveExpanded((current) => !current)}
                          type="button"
                        >
                          {archiveExpanded ? "Скрыть архив" : "Показать архив"}
                        </button>
                      ) : null}
                    </header>
                    {archiveCollapsed ? null : (
                      <ul className="event-occurrence-rows">
                        {group.items.map(renderOccurrenceRow)}
                      </ul>
                    )}
                  </section>
                );
              })}
              <button
                className="event-occurrences-add-btn event-occurrences-add-btn--below"
                disabled={disabled}
                onClick={openAddModal}
                type="button"
              >
                + Добавить ещё дату
              </button>
            </div>
          )}
        </div>

        <SummaryPanel summary={summary} />
      </div>

      <footer className="event-occurrences-constructor__footer">
        {saving ? (
          <span className="event-occurrences-constructor__saving">
            Сохраняем...
          </span>
        ) : saveError ? (
          <span className="event-occurrences-constructor__error" role="alert">
            {saveError}
          </span>
        ) : savedAt ? (
          <span className="event-occurrences-constructor__saved">
            Сохранено в {formatSavedTime(savedAt)}
          </span>
        ) : null}
      </footer>

      {modalState.kind !== "closed"
        ? createPortal(
            <OccurrenceModal
              onChange={updateModalForm}
              onClose={closeModal}
              onSubmit={submitModal}
              saving={saving}
              state={modalState}
            />,
            document.body,
          )
        : null}

      {archiveConfirmOpen && hasPastActiveDrafts
        ? createPortal(
            <ArchivePastConfirmModal
              count={summary.pastActiveCount}
              onClose={closeArchivePastConfirm}
              onConfirm={confirmArchivePastOccurrences}
              saving={saving}
            />,
            document.body,
          )
        : null}
    </section>
  );
}

type OccurrenceGeneratorProps = {
  disabled: boolean;
  eventCapacity: number | null;
  form: OccurrenceGeneratorForm;
  onApply: () => void;
  onFieldChange: <Field extends keyof OccurrenceGeneratorForm>(
    field: Field,
    value: OccurrenceGeneratorForm[Field],
  ) => void;
  onPresetChange: (value: string) => void;
  preview: GeneratorPreview;
};

function OccurrenceGenerator({
  disabled,
  eventCapacity,
  form,
  onApply,
  onFieldChange,
  onPresetChange,
  preview,
}: OccurrenceGeneratorProps) {
  const startDayOptions =
    form.preset === "weekly_shabbat" ? SHABBAT_START_DAY_OPTIONS : WEEKDAY_OPTIONS;
  const showAutomationHint =
    form.preset === "weekly_shabbat" || form.preset === "weekly_sunday_school";
  const applyDisabled = disabled || Boolean(preview.error) || preview.creatableCount === 0;
  const registrationHint = form.registrationAlwaysOpen
    ? "Подходит для курсов: все сгенерированные даты доступны для записи сразу."
    : showAutomationHint
      ? "Для Шабата и воскресной школы обычно используется окно регистрации."
      : "Можно задать отдельное окно регистрации для каждой созданной даты.";

  return (
    <section className="event-occurrence-generator">
      <header className="event-occurrence-generator__head">
        <div>
          <h3>Генератор дат</h3>
          {showAutomationHint ? (
            <p>
              Это создаёт конкретные даты. Автоматический cron появится позже.
            </p>
          ) : null}
        </div>
        <Button disabled={applyDisabled} onClick={onApply} variant="gold">
          Создать даты
        </Button>
      </header>

      <div className="event-occurrence-generator__grid">
        <GeneratorField label="Шаблон">
          <select
            disabled={disabled}
            onChange={(event) => onPresetChange(event.target.value)}
            value={form.preset}
          >
            {GENERATOR_PRESET_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </GeneratorField>

        <GeneratorField label="Недель вперёд">
          <input
            disabled={disabled}
            max={52}
            min={1}
            onChange={(event) => onFieldChange("weeksAhead", event.target.value)}
            type="number"
            value={form.weeksAhead}
          />
        </GeneratorField>

        <GeneratorField label="День события">
          <select
            disabled={disabled}
            onChange={(event) =>
              onFieldChange("startDayOfWeek", Number(event.target.value))
            }
            value={form.startDayOfWeek}
          >
            {startDayOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </GeneratorField>

        <GeneratorField label="Начало">
          <input
            disabled={disabled}
            onChange={(event) => onFieldChange("startTime", event.target.value)}
            type="time"
            value={form.startTime}
          />
        </GeneratorField>

        <GeneratorField label="Окончание">
          <input
            disabled={disabled}
            onChange={(event) => onFieldChange("endTime", event.target.value)}
            type="time"
            value={form.endTime}
          />
        </GeneratorField>

        <label className="event-occurrence-generator__checkbox-field">
          <span className="event-occurrence-generator__checkbox-label">
            <input
              checked={form.registrationAlwaysOpen}
              disabled={disabled}
              onChange={(event) =>
                onFieldChange("registrationAlwaysOpen", event.target.checked)
              }
              type="checkbox"
            />
            Регистрация открыта всегда
          </span>
          <small>{registrationHint}</small>
        </label>

        {!form.registrationAlwaysOpen ? (
          <>
            <GeneratorField label="Открыть регистрацию">
              <div className="event-occurrence-generator__inline-fields">
                <select
                  disabled={disabled}
                  onChange={(event) =>
                    onFieldChange("registrationOpensDayOfWeek", Number(event.target.value))
                  }
                  value={form.registrationOpensDayOfWeek}
                >
                  {WEEKDAY_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <input
                  disabled={disabled}
                  onChange={(event) =>
                    onFieldChange("registrationOpensTime", event.target.value)
                  }
                  type="time"
                  value={form.registrationOpensTime}
                />
              </div>
            </GeneratorField>

            <GeneratorField label="Закрыть регистрацию">
              <div className="event-occurrence-generator__inline-fields">
                <select
                  disabled={disabled}
                  onChange={(event) =>
                    onFieldChange("registrationClosesDayOfWeek", Number(event.target.value))
                  }
                  value={form.registrationClosesDayOfWeek}
                >
                  {WEEKDAY_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <input
                  disabled={disabled}
                  onChange={(event) =>
                    onFieldChange("registrationClosesTime", event.target.value)
                  }
                  type="time"
                  value={form.registrationClosesTime}
                />
              </div>
            </GeneratorField>
          </>
        ) : null}

        <GeneratorField label="Лимит">
          <select
            disabled={disabled}
            onChange={(event) => {
              if (isGeneratorCapacityMode(event.target.value)) {
                onFieldChange("capacityMode", event.target.value);
              }
            }}
            value={form.capacityMode}
          >
            <option value="inherit">
              {eventCapacity === null
                ? "Наследовать capacity события"
                : `Наследовать ${eventCapacity}`}
            </option>
            <option value="custom">Свой лимит для дат</option>
          </select>
        </GeneratorField>

        {form.capacityMode === "custom" ? (
          <GeneratorField label="Свой лимит">
            <input
              disabled={disabled}
              min={1}
              onChange={(event) => onFieldChange("customCapacity", event.target.value)}
              type="number"
              value={form.customCapacity}
            />
          </GeneratorField>
        ) : null}

        <GeneratorField label="Подпись даты">
          <input
            disabled={disabled}
            onChange={(event) => onFieldChange("titleTemplate", event.target.value)}
            placeholder="Например, Шабат"
            type="text"
            value={form.titleTemplate}
          />
        </GeneratorField>
      </div>

      <div className="event-occurrence-generator__preview">
        <div className="event-occurrence-generator__preview-head">
          <span>Предпросмотр</span>
          <strong>
            {preview.error
              ? "Проверьте настройки"
              : `${preview.creatableCount} будет создано, ${
                  preview.items.length - preview.creatableCount
                } пропущено`}
          </strong>
        </div>

        {preview.error ? (
          <div className="event-occurrence-generator__error" role="alert">
            {preview.error}
          </div>
        ) : (
          <ul className="event-occurrence-generator__preview-list">
            {preview.items.map((item) => (
              <li
                className={`event-occurrence-generator__preview-item${
                  item.exists || item.duplicate
                    ? " event-occurrence-generator__preview-item--skipped"
                    : ""
                }`}
                key={`${item.startsAt}-${item.draft.sortOrder}`}
              >
                <div>
                  <strong>{item.startsAtLabel}</strong>
                  <span>{item.timeRangeLabel}</span>
                </div>
                <div>
                  <span>{item.registrationWindowLabel}</span>
                  <span>{item.capacityLabel}</span>
                </div>
                <span className="event-occurrence-generator__preview-badge">
                  {item.exists ? "уже есть" : item.duplicate ? "дубль" : "новая"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function GeneratorField({
  children,
  label,
}: {
  children: ReactNode;
  label: string;
}) {
  return (
    <label className="event-occurrence-generator__field">
      <span>{label}</span>
      {children}
    </label>
  );
}

function OccurrenceRow({
  disabled,
  draft,
  index,
  isPastActive,
  onArchive,
  onDelete,
  onEdit,
  onMoveDown,
  onMoveUp,
  onStatusChange,
  total,
}: {
  disabled: boolean;
  draft: DraftOccurrence;
  index: number;
  isPastActive: boolean;
  onArchive: () => void;
  onDelete: () => void;
  onEdit: () => void;
  onMoveDown: () => void;
  onMoveUp: () => void;
  onStatusChange: (status: AdminEventOccurrenceStatus) => void;
  total: number;
}) {
  const dateLabel = formatDraftDate(draft);
  const timeLabel = formatDraftTimeRange(draft);
  const title = draft.title.trim();
  const statusLabel = STATUS_LABELS[draft.status];
  const rowClassName = [
    "event-occurrence-row",
    `event-occurrence-row--${draft.status}`,
    isPastActive ? "event-occurrence-row--past-active" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <li className={rowClassName}>
      <div className="event-occurrence-row__date">
        <strong>{dateLabel}</strong>
        <span>{timeLabel}</span>
      </div>

      <div className="event-occurrence-row__body">
        <div className="event-occurrence-row__title">
          {title ? title : "Без подписи"}
        </div>
        <div className="event-occurrence-row__meta">
          <span>{formatRegistrationWindow(draft)}</span>
          <span>{formatCapacity(draft)}</span>
        </div>
      </div>

      <span
        className={`event-occurrence-row__status event-occurrence-row__status--${draft.status}`}
      >
        {statusLabel}
      </span>

      <select
        aria-label="Изменить статус даты"
        className="event-occurrence-row__status-select"
        disabled={disabled}
        onChange={(event) => {
          if (isOccurrenceStatus(event.target.value)) {
            onStatusChange(event.target.value);
          }
        }}
        value={draft.status}
      >
        {ADMIN_EVENT_OCCURRENCE_STATUSES.map((status) => (
          <option key={status} value={status}>
            {STATUS_LABELS[status]}
          </option>
        ))}
      </select>

      <div className="event-occurrence-row__actions">
        {isPastActive ? (
          <button
            aria-label="Архивировать прошедшую дату"
            className="event-occurrence-row__archive-btn"
            disabled={disabled}
            onClick={onArchive}
            type="button"
          >
            Архивировать
          </button>
        ) : null}
        <button
          aria-label="Редактировать дату"
          className="event-occurrence-row__action"
          disabled={disabled}
          onClick={onEdit}
          title="Редактировать"
          type="button"
        >
          ✎
        </button>
        <button
          aria-label="Переместить дату выше"
          className="event-occurrence-row__action"
          disabled={disabled || index === 0}
          onClick={onMoveUp}
          title="Выше"
          type="button"
        >
          ↑
        </button>
        <button
          aria-label="Переместить дату ниже"
          className="event-occurrence-row__action"
          disabled={disabled || index === total - 1}
          onClick={onMoveDown}
          title="Ниже"
          type="button"
        >
          ↓
        </button>
        <button
          aria-label="Удалить дату"
          className="event-occurrence-row__action event-occurrence-row__action--danger"
          disabled={disabled}
          onClick={onDelete}
          title="Удалить"
          type="button"
        >
          ×
        </button>
      </div>

      {isPastActive ? (
        <span className="event-occurrence-row__past-badge">
          Прошёл · нужно архивировать
        </span>
      ) : null}
    </li>
  );
}

type Summary = {
  archivedCount: number;
  capacityText: string;
  futureActiveCount: number;
  hasClosedRegistration: boolean;
  nextActiveLabel: string;
  pastActiveCount: number;
};

function buildSummary(
  drafts: DraftOccurrence[],
  eventCapacity: number | null,
  nowTimestamp: number,
): Summary {
  const now = nowTimestamp;
  const activeDrafts = drafts.filter((draft) => draft.status === "active");
  const futureActiveDrafts = activeDrafts.filter(
    (draft) => !isPastOccurrenceDraft(draft, now),
  );
  const futureActiveWithStart = futureActiveDrafts
    .map((draft) => ({ draft, timestamp: draftStartIsoTimestamp(draft) }))
    .filter(
      (entry): entry is { draft: DraftOccurrence; timestamp: number } =>
        entry.timestamp !== null && entry.timestamp >= now,
    )
    .sort((left, right) => left.timestamp - right.timestamp);
  const pastActiveCount = activeDrafts.filter((draft) =>
    isPastOccurrenceDraft(draft, now),
  ).length;
  const archivedCount = drafts.filter((draft) => draft.status === "archived").length;
  const withOwnCapacity = activeDrafts.filter((draft) => draft.capacity.trim()).length;
  const inheritedCapacity = activeDrafts.length - withOwnCapacity;
  const capacityText =
    eventCapacity === null
      ? `${withOwnCapacity} с лимитом, ${inheritedCapacity} без общего лимита`
      : `${withOwnCapacity} с лимитом, ${inheritedCapacity} наследуют ${eventCapacity}`;
  const hasClosedRegistration = activeDrafts.some((draft) => {
    if (!draft.registrationClosesAt) {
      return false;
    }

    const timestamp = new Date(draft.registrationClosesAt).getTime();
    return Number.isFinite(timestamp) && timestamp <= now;
  });

  return {
    archivedCount,
    capacityText,
    futureActiveCount: futureActiveDrafts.length,
    hasClosedRegistration,
    nextActiveLabel: futureActiveWithStart[0]
      ? formatDraftDateTime(futureActiveWithStart[0].draft)
      : "Нет будущих активных дат",
    pastActiveCount,
  };
}

function SummaryPanel({ summary }: { summary: Summary }) {
  return (
    <aside className="event-occurrences-summary">
      <header>Сводка</header>
      <dl>
        <div>
          <dt>Ближайшая активная дата</dt>
          <dd>{summary.nextActiveLabel}</dd>
        </div>
        <div>
          <dt>Будущих активных</dt>
          <dd>{summary.futureActiveCount}</dd>
        </div>
        {summary.pastActiveCount > 0 ? (
          <div className="event-occurrences-summary__warning">
            <dt>Требуют архивации</dt>
            <dd>{summary.pastActiveCount}</dd>
          </div>
        ) : null}
        <div>
          <dt>В архиве</dt>
          <dd>{summary.archivedCount}</dd>
        </div>
        <div>
          <dt>Регистрация</dt>
          <dd>
            {summary.hasClosedRegistration
              ? "Есть закрытые окна"
              : "Нет закрытых окон"}
          </dd>
        </div>
        <div>
          <dt>Лимиты</dt>
          <dd>{summary.capacityText}</dd>
        </div>
      </dl>
    </aside>
  );
}

function ArchivePastConfirmModal({
  count,
  onClose,
  onConfirm,
  saving,
}: {
  count: number;
  onClose: () => void;
  onConfirm: () => void;
  saving: boolean;
}) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !saving) {
        onClose();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose, saving]);

  return (
    <div
      className="participation-modal-overlay"
      onClick={() => {
        if (!saving) {
          onClose();
        }
      }}
      role="presentation"
    >
      <div
        aria-modal="true"
        className="participation-modal event-occurrence-archive-modal"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
      >
        <header className="participation-modal__head">
          <h3>Архивировать прошедшие сеансы?</h3>
          <button
            aria-label="Закрыть"
            className="participation-modal__close"
            disabled={saving}
            onClick={onClose}
            type="button"
          >
            ×
          </button>
        </header>

        <div className="participation-modal__body event-occurrence-archive-modal__body">
          <p>
            Мы перенесём {count} прошедших сеансов в архив. Они исчезнут из
            активного списка, но останутся в истории события. Регистрации,
            оплаты и посещаемость не будут удалены.
          </p>
        </div>

        <footer className="participation-modal__footer">
          <Button disabled={saving} onClick={onClose} variant="ghost">
            Отмена
          </Button>
          <Button disabled={saving} onClick={onConfirm} variant="gold">
            {saving ? "Архивируем..." : `Архивировать ${count} сеансов`}
          </Button>
        </footer>
      </div>
    </div>
  );
}

type OccurrenceModalProps = {
  onChange: (updater: (form: DraftOccurrence) => DraftOccurrence) => void;
  onClose: () => void;
  onSubmit: () => void;
  saving: boolean;
  state: Exclude<ModalState, { kind: "closed" }>;
};

function OccurrenceModal({
  onChange,
  onClose,
  onSubmit,
  saving,
  state,
}: OccurrenceModalProps) {
  const { errors, form } = state;
  const isEdit = state.kind === "edit";

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div
      className="participation-modal-overlay"
      onClick={onClose}
      role="presentation"
    >
      <div
        aria-modal="true"
        className="participation-modal event-occurrence-modal"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
      >
        <header className="participation-modal__head">
          <h3>{isEdit ? "Редактировать дату" : "Новая дата/сеанс"}</h3>
          <button
            aria-label="Закрыть"
            className="participation-modal__close"
            onClick={onClose}
            type="button"
          >
            ×
          </button>
        </header>

        <div className="participation-modal__body">
          <div className="participation-modal__grid participation-modal__grid--two">
            <ModalField label="Название сеанса / подпись даты">
              <input
                onChange={(event) =>
                  onChange((current) => ({ ...current, title: event.target.value }))
                }
                placeholder="Например, Занятие 1"
                type="text"
                value={form.title}
              />
            </ModalField>
            <ModalField error={errors.timezone} label="Часовой пояс">
              <input
                onChange={(event) =>
                  onChange((current) => ({ ...current, timezone: event.target.value }))
                }
                type="text"
                value={form.timezone}
              />
            </ModalField>
          </div>

          <div className="participation-modal__grid participation-modal__grid--two">
            <ModalField error={errors.startDate} label="Дата начала *">
              <input
                onChange={(event) =>
                  onChange((current) => ({ ...current, startDate: event.target.value }))
                }
                type="date"
                value={form.startDate}
              />
            </ModalField>
            <ModalField error={errors.startTime} label="Время начала *">
              <input
                onChange={(event) =>
                  onChange((current) => ({ ...current, startTime: event.target.value }))
                }
                type="time"
                value={form.startTime}
              />
            </ModalField>
            <ModalField error={errors.endDate} label="Дата окончания">
              <input
                onChange={(event) =>
                  onChange((current) => ({ ...current, endDate: event.target.value }))
                }
                type="date"
                value={form.endDate}
              />
            </ModalField>
            <ModalField error={errors.endTime} label="Время окончания">
              <input
                onChange={(event) =>
                  onChange((current) => ({ ...current, endTime: event.target.value }))
                }
                type="time"
                value={form.endTime}
              />
            </ModalField>
          </div>

          <div className="participation-modal__grid participation-modal__grid--two">
            <ModalField error={errors.registrationOpensAt} label="Начало регистрации">
              <input
                onChange={(event) =>
                  onChange((current) => ({
                    ...current,
                    registrationOpensAt: event.target.value,
                  }))
                }
                type="datetime-local"
                value={form.registrationOpensAt}
              />
            </ModalField>
            <ModalField error={errors.registrationClosesAt} label="Окончание регистрации">
              <input
                onChange={(event) =>
                  onChange((current) => ({
                    ...current,
                    registrationClosesAt: event.target.value,
                  }))
                }
                type="datetime-local"
                value={form.registrationClosesAt}
              />
            </ModalField>
          </div>

          <div className="participation-modal__grid participation-modal__grid--two">
            <ModalField error={errors.capacity} label="Лимит мест">
              <input
                min={1}
                onChange={(event) =>
                  onChange((current) => ({ ...current, capacity: event.target.value }))
                }
                placeholder="Наследуется от события"
                type="number"
                value={form.capacity}
              />
            </ModalField>
            <ModalField error={errors.status} label="Статус">
              <select
                onChange={(event) =>
                  onChange((current) => ({
                    ...current,
                    status: isOccurrenceStatus(event.target.value)
                      ? event.target.value
                      : current.status,
                  }))
                }
                value={form.status}
              >
                {ADMIN_EVENT_OCCURRENCE_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {STATUS_LABELS[status]}
                  </option>
                ))}
              </select>
            </ModalField>
          </div>

          <div className="participation-modal__toggles">
            <ModalToggle
              checked={form.waitlistEnabled}
              label="Лист ожидания"
              onChange={(value) =>
                onChange((current) => ({ ...current, waitlistEnabled: value }))
              }
            />
            <ModalToggle
              checked={form.requiresApproval}
              label="Требует подтверждения"
              onChange={(value) =>
                onChange((current) => ({ ...current, requiresApproval: value }))
              }
            />
          </div>
        </div>

        <footer className="participation-modal__footer">
          <Button onClick={onClose} variant="ghost">
            Отмена
          </Button>
          <Button disabled={saving} onClick={onSubmit} variant="primary">
            {isEdit ? "Сохранить" : "Добавить"}
          </Button>
        </footer>
      </div>
    </div>
  );
}

function ModalField({
  children,
  error,
  label,
}: {
  children: ReactNode;
  error?: string;
  label: string;
}) {
  return (
    <label className="participation-modal__field">
      <span>{label}</span>
      {children}
      {error ? <small>{error}</small> : null}
    </label>
  );
}

function ModalToggle({
  checked,
  label,
  onChange,
}: {
  checked: boolean;
  label: string;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="participation-modal__toggle">
      <input
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        type="checkbox"
      />
      <span
        aria-hidden
        className={`participation-modal__toggle-track${checked ? " participation-modal__toggle-track--on" : ""}`}
      />
      <span className="participation-modal__toggle-label">{label}</span>
    </label>
  );
}

function formatDraftDate(draft: DraftOccurrence): string {
  const startsAt = buildDraftStartIso(draft);
  if (!startsAt) {
    return "Дата не задана";
  }

  return formatDate(startsAt, draft.timezone);
}

function formatDraftDateTime(draft: DraftOccurrence): string {
  const startsAt = buildDraftStartIso(draft);
  if (!startsAt) {
    return "Дата не задана";
  }

  return `${formatDate(startsAt, draft.timezone)}, ${formatTime(startsAt, draft.timezone)}`;
}

function formatDraftTimeRange(draft: DraftOccurrence): string {
  const startsAt = buildDraftStartIso(draft);
  if (!startsAt) {
    return "Время не задано";
  }

  const startTime = formatTime(startsAt, draft.timezone);
  const endsAt = buildDraftEndIso(draft);

  if (!endsAt) {
    return startTime;
  }

  const endTime = formatTime(endsAt, draft.timezone);
  const startDate = formatDate(startsAt, draft.timezone);
  const endDate = formatDate(endsAt, draft.timezone);

  return startDate === endDate
    ? `${startTime}-${endTime}`
    : `${startTime}-${endTime}, ${endDate}`;
}

function formatRegistrationWindow(draft: DraftOccurrence): string {
  const opensAt = formatLocalDateTime(draft.registrationOpensAt);
  const closesAt = formatLocalDateTime(draft.registrationClosesAt);

  if (opensAt && closesAt) {
    return `Регистрация: с ${opensAt} до ${closesAt}`;
  }

  if (opensAt) {
    return `Регистрация: с ${opensAt}`;
  }

  if (closesAt) {
    return `Регистрация: до ${closesAt}`;
  }

  return "Окно регистрации не задано";
}

function formatCapacity(draft: DraftOccurrence): string {
  const capacity = draft.capacity.trim();
  return capacity ? `Лимит: ${capacity}` : "Лимит: наследуется от события";
}

function buildDraftStartIso(draft: DraftOccurrence): string | null {
  if (!draft.startDate || !draft.startTime) {
    return null;
  }

  try {
    return buildZonedIso(draft.startDate, draft.startTime, draft.timezone);
  } catch {
    return null;
  }
}

function buildDraftEndIso(draft: DraftOccurrence): string | null {
  if (!draft.endDate || !draft.endTime) {
    return null;
  }

  try {
    return buildZonedIso(draft.endDate, draft.endTime, draft.timezone);
  } catch {
    return null;
  }
}

function formatDate(value: string, timezone: string): string {
  return formatWithTimezone(value, timezone, {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function formatTime(value: string, timezone: string): string {
  return formatWithTimezone(value, timezone, {
    hour: "2-digit",
    hour12: false,
    minute: "2-digit",
  });
}

function formatWithTimezone(
  value: string,
  timezone: string,
  options: Intl.DateTimeFormatOptions,
): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  try {
    return new Intl.DateTimeFormat("ru-RU", {
      ...options,
      timeZone: timezone || DEFAULT_TIMEZONE,
    }).format(date);
  } catch {
    return new Intl.DateTimeFormat("ru-RU", options).format(date);
  }
}

function formatLocalDateTime(value: string): string | null {
  if (!value) {
    return null;
  }

  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}:\d{2})$/.exec(value);
  if (!match) {
    return null;
  }

  return `${match[3]}.${match[2]}.${match[1]} ${match[4]}`;
}

function formatSavedTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return new Intl.DateTimeFormat("ru-RU", {
    hour: "2-digit",
    hour12: false,
    minute: "2-digit",
    second: "2-digit",
  }).format(date);
}

function formatDateTimeLocalForForm(value: string | null, timezone: string): string {
  const parts = formatDateTimeForForm(value, timezone);
  return parts.date && parts.time ? `${parts.date}T${parts.time}` : "";
}

function formatDateTimeForForm(
  value: string | null,
  timezone: string,
): { date: string; time: string } {
  if (!value) {
    return { date: "", time: "" };
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return { date: "", time: "" };
  }

  try {
    return formatDateTimeParts(date, timezone);
  } catch {
    return formatDateTimeParts(date);
  }
}

function formatDateTimeParts(
  date: Date,
  timezone?: string,
): { date: string; time: string } {
  const formatter = new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
    hourCycle: "h23",
    minute: "2-digit",
    month: "2-digit",
    timeZone: timezone,
    year: "numeric",
  });
  const parts = formatter.formatToParts(date);
  const values = new Map(parts.map((part) => [part.type, part.value]));
  const year = values.get("year") ?? "";
  const month = values.get("month") ?? "";
  const day = values.get("day") ?? "";
  const hour = values.get("hour") ?? "";
  const minute = values.get("minute") ?? "";

  if (!year || !month || !day || !hour || !minute) {
    return { date: "", time: "" };
  }

  return {
    date: `${year}-${month}-${day}`,
    time: `${hour}:${minute}`,
  };
}

function buildZonedIso(dateValue: string, timeValue: string, timezone: string): string {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateValue);
  const timeMatch = /^(\d{2}):(\d{2})$/.exec(timeValue);

  if (!dateMatch || !timeMatch) {
    throw new Error("Invalid date or time.");
  }

  const year = Number(dateMatch[1]);
  const month = Number(dateMatch[2]);
  const day = Number(dateMatch[3]);
  const hour = Number(timeMatch[1]);
  const minute = Number(timeMatch[2]);

  if (hour > 23 || minute > 59) {
    throw new Error("Invalid time.");
  }

  const utcTimestamp = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  const utcDate = new Date(utcTimestamp);

  if (
    utcDate.getUTCFullYear() !== year ||
    utcDate.getUTCMonth() !== month - 1 ||
    utcDate.getUTCDate() !== day
  ) {
    throw new Error("Invalid date.");
  }

  const zoneOffset = getTimezoneOffsetMinutes(timezone, utcDate);
  const zonedDate = new Date(utcTimestamp - zoneOffset * 60_000);
  const refinedOffset = getTimezoneOffsetMinutes(timezone, zonedDate);
  const refinedDate = new Date(utcTimestamp - refinedOffset * 60_000);

  if (Number.isNaN(refinedDate.getTime())) {
    throw new Error("Invalid timezone.");
  }

  return refinedDate.toISOString();
}

function getTimezoneOffsetMinutes(timezone: string, date: Date): number {
  const formatter = getFormatter(timezone);
  const parts = formatter.formatToParts(date);
  const values = new Map(parts.map((part) => [part.type, part.value]));
  const year = Number(values.get("year"));
  const month = Number(values.get("month"));
  const day = Number(values.get("day"));
  const hour = Number(values.get("hour"));
  const minute = Number(values.get("minute"));
  const second = Number(values.get("second"));
  const asUtc = Date.UTC(year, month - 1, day, hour, minute, second);

  return (asUtc - date.getTime()) / 60_000;
}

function getFormatter(timezone: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
    hourCycle: "h23",
    minute: "2-digit",
    month: "2-digit",
    second: "2-digit",
    timeZone: timezone || DEFAULT_TIMEZONE,
    year: "numeric",
  });
}
