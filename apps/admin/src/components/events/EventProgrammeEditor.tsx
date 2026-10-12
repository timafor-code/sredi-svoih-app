import { useEffect, useMemo, useRef, useState } from "react";

import { selectAdminProgrammeOccurrence } from "../../lib/adminProgrammeOccurrence";
import {
  isSameProgrammeSaveRequest,
  ProgrammeAutosaveCoordinator,
  type ProgrammeSaveRequest,
} from "../../lib/adminProgrammeAutosave";
import { parseEventScheduleDescription } from "../../lib/eventScheduleParser";
import { applyJewishProgrammeAutomation } from "../../lib/jewishProgrammeAutomation";
import { listAdminEventOccurrences } from "../../services/adminEventOccurrencesService";
import { listAdminEventParticipationOptions } from "../../services/adminParticipationOptionsService";
import type { AdminEvent, AdminEventSchedule } from "../../types/events";
import type { AdminEventOccurrence } from "../../types/eventOccurrences";
import type { ParticipationOption } from "../../types/participationOptions";
import { SaveStatusView } from "../ui/SaveStatusView";
import {
  EventScheduleConstructor,
  validateEventSchedule,
} from "./EventScheduleConstructor";
import type { EventScheduleValidation } from "./EventScheduleConstructor";

const OPTIONS_VALIDATION_UNAVAILABLE = "Нельзя проверить связанные варианты участия. Дождитесь загрузки или повторите попытку.";

type EventProgrammeEditorProps = {
  active: boolean;
  event: AdminEvent;
  participationOptionsRevision: number;
  saveDisabled?: boolean;
  onDirtyChange: (dirty: boolean) => void;
  onSave: (schedule: AdminEventSchedule | null) => Promise<AdminEvent | null>;
};

export function EventProgrammeEditor({
  active,
  event,
  participationOptionsRevision,
  saveDisabled = false,
  onDirtyChange,
  onSave,
}: EventProgrammeEditorProps) {
  const [schedule, setSchedule] = useState<AdminEventSchedule | null>(() => (
    automateProgramme(event, event.schedule ?? null, null)
  ));
  const [baseline, setBaseline] = useState<AdminEventSchedule | null>(() => (
    getProgrammeBaseline(event, event.schedule ?? null, null)
  ));
  const [selectedOccurrence, setSelectedOccurrence] = useState<AdminEventOccurrence | null>(null);
  const [projectionNotice, setProjectionNotice] = useState<string | null>(null);
  const [sourceText, setSourceText] = useState("");
  const [parseRemainder, setParseRemainder] = useState<string[]>([]);
  const [participationOptions, setParticipationOptions] = useState<ParticipationOption[]>([]);
  const [optionsLoading, setOptionsLoading] = useState(false);
  const [optionsError, setOptionsError] = useState<string | null>(null);
  const [loadedOptionsRevision, setLoadedOptionsRevision] = useState<number | null>(null);
  const [optionsReloadAttempt, setOptionsReloadAttempt] = useState(0);
  const [optionsValidationState, setOptionsValidationState] = useState<"idle" | "loading" | "failed">("idle");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [autosaveScheduled, setAutosaveScheduled] = useState(false);
  const [hasUnconfirmedUserIntent, setHasUnconfirmedUserIntent] = useState(false);
  const baselineRef = useRef(baseline);
  const scheduleRef = useRef(schedule);
  const scheduleDirtyRef = useRef(false);
  const selectedOccurrenceRef = useRef<AdminEventOccurrence | null>(null);
  const eventRef = useRef(event);
  const participationOptionsRef = useRef<ParticipationOption[]>([]);
  const optionsAreCurrentRef = useRef(false);
  const optionsErrorRef = useRef<string | null>(null);
  const saveDisabledRef = useRef(saveDisabled);
  const onSaveRef = useRef(onSave);
  const attemptAutosaveRef = useRef<() => void>(() => undefined);
  const autosaveRef = useRef<ProgrammeAutosaveCoordinator | null>(null);
  const activeSaveRequestRef = useRef<ProgrammeSaveRequest | null>(null);
  const requestIdRef = useRef(0);
  const pendingOccurrenceRef = useRef<AdminEventOccurrence | null>(null);

  if (!autosaveRef.current) {
    autosaveRef.current = new ProgrammeAutosaveCoordinator(event.id, () => {
      setAutosaveScheduled(false);
      attemptAutosaveRef.current();
    });
  }
  eventRef.current = event;
  saveDisabledRef.current = saveDisabled;
  onSaveRef.current = onSave;

  const startDate = useMemo(() => (
    getEventStartDate(selectedOccurrence?.startsAt ?? event.startsAt)
  ), [event.startsAt, selectedOccurrence?.startsAt]);
  const scheduleDirty = hasUnconfirmedUserIntent || !sameSchedule(schedule, baseline);
  const optionsAreCurrent = !optionsLoading
    && !optionsError
    && loadedOptionsRevision === participationOptionsRevision;
  const optionsLoadingForSchedule = optionsLoading
    || (!optionsError && loadedOptionsRevision !== participationOptionsRevision);

  useEffect(() => {
    scheduleRef.current = schedule;
  }, [schedule]);

  useEffect(() => {
    selectedOccurrenceRef.current = selectedOccurrence;
  }, [selectedOccurrence]);

  useEffect(() => {
    participationOptionsRef.current = participationOptions;
    optionsAreCurrentRef.current = optionsAreCurrent;
    optionsErrorRef.current = optionsError;
  }, [optionsAreCurrent, optionsError, optionsLoading, participationOptions]);

  useEffect(() => {
    const nextDraft = createProgrammeDraft(event, null);
    autosaveRef.current?.reset(event.id);
    baselineRef.current = cloneSchedule(nextDraft.baseline);
    scheduleRef.current = nextDraft.schedule;
    scheduleDirtyRef.current = false;
    activeSaveRequestRef.current = null;
    selectedOccurrenceRef.current = null;
    pendingOccurrenceRef.current = null;
    setSchedule(nextDraft.schedule);
    setBaseline(cloneSchedule(nextDraft.baseline));
    setSelectedOccurrence(null);
    setProjectionNotice(null);
    setSourceText("");
    setParseRemainder([]);
    setSaveError(null);
    setValidationError(null);
    setSavedAt(null);
    setAutosaveScheduled(false);
    setHasUnconfirmedUserIntent(false);
    setParticipationOptions([]);
    setOptionsLoading(false);
    setOptionsError(null);
    setLoadedOptionsRevision(null);
    setOptionsReloadAttempt(0);
    setOptionsValidationState("idle");
    setSaving(false);
  }, [event.id]);

  useEffect(() => () => autosaveRef.current?.cancel(), []);

  useEffect(() => {
    const nextDraft = recalculateProgrammeForEventContext({
      event,
      hasUnsavedDraft: scheduleDirtyRef.current,
      occurrence: selectedOccurrence,
    });
    if (!nextDraft) return;
    baselineRef.current = cloneSchedule(nextDraft.baseline);
    scheduleRef.current = nextDraft.schedule;
    setSchedule(nextDraft.schedule);
    setBaseline(cloneSchedule(nextDraft.baseline));
  }, [event.eventKind, event.startsAt]);

  useEffect(() => {
    if (!active || event.eventKind !== "shabbat") return;

    const requestId = ++requestIdRef.current;
    let mounted = true;
    setProjectionNotice("Загружаем актуальную дату Шабата для программы…");

    void listAdminEventOccurrences(event.id)
      .then((occurrences) => {
        if (!mounted || requestId !== requestIdRef.current) return;
        const selection = selectAdminProgrammeOccurrence(occurrences);
        if (selection.kind !== "selected") {
          if (scheduleDirtyRef.current) {
            setProjectionNotice("Актуальная дата Шабата изменилась, но несохранённый черновик программы сохранён без изменений.");
            return;
          }
          const templateProjection = automateProgramme(event, event.schedule ?? null, null);
          baselineRef.current = cloneSchedule(templateProjection);
          scheduleRef.current = templateProjection;
          setSchedule(templateProjection);
          setBaseline(cloneSchedule(templateProjection));
          setSelectedOccurrence(null);
          selectedOccurrenceRef.current = null;
          setProjectionNotice(selection.kind === "invalid"
            ? "Не удалось проверить актуальную дату Шабата. Сохранённая программа не изменена."
            : "Нет активной незавершённой даты Шабата для календарной проекции. Показан шаблон программы без актуальных значений.");
          return;
        }

        if (scheduleDirtyRef.current) {
          pendingOccurrenceRef.current = selection.occurrence;
          setProjectionNotice("Найдена более актуальная дата Шабата. Она будет применена после сохранения черновика, чтобы не потерять изменения.");
          return;
        }

        const projected = automateProgramme(event, event.schedule ?? null, selection.occurrence);
        baselineRef.current = cloneSchedule(projected);
        scheduleRef.current = projected;
        setSchedule(projected);
        setBaseline(cloneSchedule(projected));
        setSelectedOccurrence(selection.occurrence);
        selectedOccurrenceRef.current = selection.occurrence;
        setProjectionNotice(null);
      })
      .catch(() => {
        if (!mounted || requestId !== requestIdRef.current) return;
        setProjectionNotice("Не удалось загрузить актуальную дату Шабата. Сохранённая программа не изменена.");
      });

    return () => { mounted = false; };
  }, [active, event.id, event.eventKind]);

  useEffect(() => {
    let active = true;
    setOptionsLoading(true);
    setOptionsError(null);
    if (autosaveRef.current?.hasPendingChanges) setOptionsValidationState("loading");
    void listAdminEventParticipationOptions(event.id)
      .then((options) => {
        if (!active) return;
        setParticipationOptions(options);
        setLoadedOptionsRevision(participationOptionsRevision);
      })
      .catch(() => {
        if (!active) return;
        setParticipationOptions([]);
        setOptionsError("Не удалось загрузить варианты участия. Повторите попытку позже.");
      })
      .finally(() => {
        if (active) setOptionsLoading(false);
      });

    return () => { active = false; };
  }, [event.id, optionsReloadAttempt, participationOptionsRevision]);

  useEffect(() => {
    scheduleDirtyRef.current = scheduleDirty;
    onDirtyChange(scheduleDirty);
  }, [onDirtyChange, scheduleDirty]);

  useEffect(() => () => onDirtyChange(false), [onDirtyChange, event.id]);

  const changeSchedule = (nextSchedule: AdminEventSchedule | null) => {
    const automated = automateProgramme(event, nextSchedule, selectedOccurrence);
    if (sameSchedule(automated, scheduleRef.current)) return;

    // A return to an older baseline is still a new user intent while an older
    // write is in flight. Always give a real user edit a new revision.
    scheduleDirtyRef.current = true;
    scheduleRef.current = automated;
    setSchedule(automated);
    setHasUnconfirmedUserIntent(true);
    setSaveError(null);
    setValidationError(null);
    setSavedAt(null);
    autosaveRef.current?.markUserEdit();
    setAutosaveScheduled(true);
  };

  const parseSchedule = () => {
    if (!sourceText.trim() || !startDate) return;
    if (hasMeaningfulSchedule(schedule) && !window.confirm(
      "Заменить несохранённый черновик программы результатом разбора описания?",
    )) {
      return;
    }

    const result = parseEventScheduleDescription({
      description: sourceText,
      startDate,
      participationOptions: participationOptions.map((option) => ({ id: option.id, title: option.title })),
    });
    changeSchedule(result.schedule);
    setParseRemainder(result.remainder);
    setSaveError(null);
    setValidationError(null);
    setSavedAt(null);
  };

  const savePendingProgramme = async () => {
    const autosave = autosaveRef.current;
    if (!autosave) return;
    if (saveDisabledRef.current) {
      autosave.pauseForBlockedParent();
      return;
    }

    const request = autosave.takeSaveRequest();
    if (!request) return;
    const draftSchedule = cloneSchedule(scheduleRef.current);
    const validation = validateEventSchedule(
      draftSchedule,
      optionsAreCurrentRef.current ? participationOptionsRef.current.map((option) => option.id) : null,
    );
    if (isWaitingForParticipationOptionsValidation(draftSchedule, validation)) {
      const completion = autosave.complete(request, "dependency");
      if (completion.current && completion.completedLatestRevision) {
        setValidationError(null);
        if (optionsErrorRef.current) {
          setOptionsValidationState("failed");
          setSaveError("Не удалось загрузить варианты участия. Проверьте подключение и повторите попытку.");
        } else {
          setOptionsValidationState("loading");
        }
      }
      return;
    }
    if (!validation.valid) {
      const completion = autosave.complete(request, "invalid");
      if (completion.current && completion.completedLatestRevision) {
        setValidationError("Проверьте программу события.");
      }
      return;
    }

    setSaving(true);
    activeSaveRequestRef.current = request;
    setSaveError(null);
    setValidationError(null);
    setOptionsValidationState("idle");
    try {
      const currentEvent = eventRef.current;
      const preparedSchedule = prepareProgrammeScheduleForSave({
        eventKind: currentEvent.eventKind,
        eventStartsAt: currentEvent.startsAt,
        occurrenceStartsAt: selectedOccurrenceRef.current?.startsAt ?? null,
        persistedSchedule: currentEvent.schedule ?? null,
        draftSchedule,
      });
      if (!preparedSchedule.ok) {
        const completion = autosave.complete(request, "invalid");
        if (completion.current && completion.completedLatestRevision) {
          setSaveError(preparedSchedule.error);
        }
        return;
      }
      const confirmed = await onSaveRef.current(preparedSchedule.schedule);
      if (!confirmed) {
        autosave.complete(request, "blocked");
        return;
      }
      const completion = autosave.complete(request, "saved");
      if (!completion.current) return;
      const confirmedSchedule = cloneSchedule(confirmed.schedule ?? null);
      const occurrenceAfterSave = pendingOccurrenceRef.current ?? selectedOccurrenceRef.current;
      const confirmedEvent = { ...eventRef.current, schedule: confirmedSchedule };
      eventRef.current = confirmedEvent;
      const projected = automateProgramme(confirmedEvent, confirmedSchedule, occurrenceAfterSave);
      baselineRef.current = cloneSchedule(projected);
      setBaseline(cloneSchedule(projected));
      if (completion.completedLatestRevision) {
        pendingOccurrenceRef.current = null;
        scheduleDirtyRef.current = false;
        scheduleRef.current = projected;
        selectedOccurrenceRef.current = occurrenceAfterSave;
        setSchedule(projected);
        setSelectedOccurrence(occurrenceAfterSave);
        setProjectionNotice(null);
        setHasUnconfirmedUserIntent(false);
        setSavedAt(new Date().toISOString());
      } else {
        scheduleDirtyRef.current = true;
      }
      if (completion.shouldSave) void savePendingProgramme();
    } catch (error) {
      const completion = autosave.complete(request, "failed");
      if (completion.current && completion.completedLatestRevision) {
        setSaveError(error instanceof Error ? error.message : "Не удалось сохранить программу. Повторите попытку.");
      }
      if (completion.shouldSave) void savePendingProgramme();
    } finally {
      if (isSameProgrammeSaveRequest(activeSaveRequestRef.current, request)) {
        activeSaveRequestRef.current = null;
        setSaving(false);
      }
    }
  };

  attemptAutosaveRef.current = () => { void savePendingProgramme(); };

  useEffect(() => {
    const autosave = autosaveRef.current;
    if (!saveDisabled && autosave?.resumeWhenParentIsAvailable()) {
      void savePendingProgramme();
    }
  }, [saveDisabled]);

  useEffect(() => {
    const autosave = autosaveRef.current;
    if (optionsAreCurrent && autosave?.resumeWhenValidationDependenciesAreAvailable()) {
      setOptionsValidationState("idle");
      void savePendingProgramme();
    }
  }, [optionsAreCurrent]);

  const retrySave = () => {
    if (optionsValidationState === "failed") {
      setOptionsValidationState("loading");
      setOptionsReloadAttempt((current) => current + 1);
      return;
    }
    if (autosaveRef.current?.retry()) {
      setAutosaveScheduled(false);
      void savePendingProgramme();
    }
  };

  return (
    <section className="event-programme-editor" aria-labelledby="event-programme-editor-heading">
      <header className="event-programme-editor__head">
        <div>
          <h2 id="event-programme-editor-heading">Программа</h2>
          <p>Структурированная программа сохраняется отдельно от обычного описания события.</p>
        </div>
      </header>

      {projectionNotice ? <p className="event-programme-editor__notice" role="status">{projectionNotice}</p> : null}

      <label className="event-programme-editor__source">
        <span>Исходный текст программы</span>
        <textarea
          onChange={(input) => setSourceText(input.target.value)}
          placeholder="Вставьте текст программы для разбора"
          value={sourceText}
        />
        <small>Только помощь при подготовке программы: этот текст не сохраняется с событием.</small>
      </label>

      {!startDate ? <p className="event-programme-editor__notice" role="status">
        Укажите дату начала в разделе «Событие», чтобы разобрать исходный текст. Редактирование программы вручную доступно.
      </p> : null}

      <EventScheduleConstructor
        disabled={false}
        onChange={changeSchedule}
        options={participationOptions}
        optionsError={optionsError}
        optionsLoading={optionsLoadingForSchedule}
        parseControl={(
          <button
            className="event-schedule-constructor__parse"
            disabled={!sourceText.trim() || !startDate}
            onClick={parseSchedule}
            title={!startDate ? "Сначала укажите дату начала события." : undefined}
            type="button"
          >
            Разобрать из описания
          </button>
        )}
        parseRemainder={parseRemainder}
        schedule={schedule}
      />

      {validationError ? <p className="event-programme-editor__error" role="alert">{validationError}</p> : null}
      {optionsValidationState === "loading" ? <p className="event-programme-editor__notice" role="status">
        Проверяем варианты участия перед автосохранением…
      </p> : null}
      <div className="event-programme-editor__save">
        <SaveStatusView
          error={saveError}
          recovery="Проверьте программу и повторите сохранение."
          savedAt={savedAt}
          saving={saving}
          scheduled={autosaveScheduled}
          unsaved={scheduleDirty}
        />
        {saveError ? <button type="button" onClick={retrySave}>Повторить</button> : null}
      </div>
    </section>
  );
}

export function cloneSchedule(schedule: AdminEventSchedule | null): AdminEventSchedule | null {
  return schedule === null ? null : {
    version: 1,
    days: schedule.days.map((day) => ({
      date: day.date,
      label: day.label,
      note: day.note,
      items: day.items.map((item) => ({ ...item })),
    })),
  };
}

function sameSchedule(left: AdminEventSchedule | null, right: AdminEventSchedule | null): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function isWaitingForParticipationOptionsValidation(
  schedule: AdminEventSchedule | null,
  validation: EventScheduleValidation,
): boolean {
  if (validation.form !== OPTIONS_VALIDATION_UNAVAILABLE || schedule === null) return false;
  const hasStructuralErrors = validation.days.some((day) => (
    Boolean(day.date || day.label || day.note)
    || day.items.some((item) => Boolean(item.time || item.title))
  ));
  return !hasStructuralErrors && schedule.days.some((day) => day.items.some((item) => item.optionId));
}

function hasMeaningfulSchedule(schedule: AdminEventSchedule | null): boolean {
  return Boolean(schedule?.days.some((day) => (
    Boolean(day.date.trim() || day.label || day.note)
    || day.items.some((item) => Boolean(item.time.trim() || item.title.trim() || item.optionId))
  )));
}

function getEventStartDate(startsAt: string | null): string | null {
  if (!startsAt) return null;
  const date = new Date(startsAt);
  if (Number.isNaN(date.getTime())) return null;

  try {
    return formatDate(date, "Europe/Moscow");
  } catch {
    return formatDate(date);
  }
}

function getProgrammeBaseline(
  event: AdminEvent,
  schedule: AdminEventSchedule | null,
  occurrence: AdminEventOccurrence | null,
): AdminEventSchedule | null {
  // Holiday generation remains an authoring aid: generated values differ from
  // the stored template and therefore retain the existing explicit-save flow.
  if (event.eventKind !== "shabbat") return cloneSchedule(schedule);
  return automateProgramme(event, schedule, occurrence);
}

export function createProgrammeDraft(
  event: AdminEvent,
  occurrence: AdminEventOccurrence | null,
): { schedule: AdminEventSchedule | null; baseline: AdminEventSchedule | null } {
  return {
    schedule: automateProgramme(event, event.schedule ?? null, occurrence),
    baseline: getProgrammeBaseline(event, event.schedule ?? null, occurrence),
  };
}

export function recalculateProgrammeForEventContext({
  event,
  hasUnsavedDraft,
  occurrence,
}: Readonly<{
  event: AdminEvent;
  hasUnsavedDraft: boolean;
  occurrence: AdminEventOccurrence | null;
}>): { schedule: AdminEventSchedule | null; baseline: AdminEventSchedule | null } | null {
  return hasUnsavedDraft ? null : createProgrammeDraft(event, occurrence);
}

export function prepareProgrammeScheduleForSave({
  eventKind,
  eventStartsAt,
  occurrenceStartsAt,
  persistedSchedule,
  draftSchedule,
}: Readonly<{
  eventKind: string;
  eventStartsAt?: string | null;
  occurrenceStartsAt?: string | null;
  persistedSchedule: AdminEventSchedule | null;
  draftSchedule: AdminEventSchedule | null;
}>): ProgrammeScheduleSavePreparation {
  if (eventKind !== "shabbat") return { ok: true, schedule: cloneSchedule(draftSchedule) };

  // A Shabbat draft is rendered for one concrete occurrence, but the event
  // stores a reusable programme template. Drop derived values and restore the
  // source dates for uniquely matched logical weekdays before the explicit save request.
  const withoutOccurrenceValues = applyJewishProgrammeAutomation({
    eventKind: "single",
    referenceDate: null,
    schedule: draftSchedule,
  });
  if (!withoutOccurrenceValues) return { ok: true, schedule: null };

  const sourceDaysByWeekday = new Map<number, AdminEventSchedule["days"][number]>();
  for (const sourceDay of persistedSchedule?.days ?? []) {
    const weekday = getWeekday(sourceDay.date);
    if (weekday === null || sourceDaysByWeekday.has(weekday)) {
      return {
        ok: false,
        error: "Нельзя безопасно сопоставить дни шаблона Шабата. Проверьте даты и повторите сохранение.",
      };
    }
    sourceDaysByWeekday.set(weekday, sourceDay);
  }

  const templateShabbatDates = getTemplateShabbatDates({
    draftSchedule: withoutOccurrenceValues,
    eventStartsAt,
    occurrenceStartsAt,
    sourceDaysByWeekday,
  });
  if (sourceDaysByWeekday.has(5) && sourceDaysByWeekday.has(6) && !templateShabbatDates) {
    return {
      ok: false,
      error: "Нельзя безопасно сопоставить дни шаблона Шабата. Проверьте даты и повторите сохранение.",
    };
  }

  const usedWeekdays = new Set<number>();
  const restoredDates: AdminEventSchedule["days"] = [];
  for (const day of withoutOccurrenceValues.days) {
    const weekday = getWeekday(day.date);
    const sourceDay = weekday === null ? undefined : sourceDaysByWeekday.get(weekday);
    const templateDate = sourceDay?.date ?? (weekday === null ? undefined : templateShabbatDates?.get(weekday));
    if (weekday === null || !templateDate || usedWeekdays.has(weekday)) {
      return {
        ok: false,
        error: "Нельзя безопасно сопоставить дни изменённой программы Шабата с шаблоном. Проверьте даты и повторите сохранение.",
      };
    }
    usedWeekdays.add(weekday);
    restoredDates.push({ ...day, date: templateDate });
  }
  return { ok: true, schedule: { version: 1, days: restoredDates } };
}

export type ProgrammeScheduleSavePreparation =
  | { ok: true; schedule: AdminEventSchedule | null }
  | { ok: false; error: string };

function getTemplateShabbatDates({
  draftSchedule,
  eventStartsAt,
  occurrenceStartsAt,
  sourceDaysByWeekday,
}: Readonly<{
  draftSchedule: AdminEventSchedule;
  eventStartsAt: string | null | undefined;
  occurrenceStartsAt: string | null | undefined;
  sourceDaysByWeekday: ReadonlyMap<number, AdminEventSchedule["days"][number]>;
}>): Map<number, string> | null {
  const existingFriday = sourceDaysByWeekday.get(5)?.date;
  const existingSaturday = sourceDaysByWeekday.get(6)?.date;
  if (existingFriday && existingSaturday) {
    return areConsecutiveDates(existingFriday, existingSaturday)
      ? new Map([[5, existingFriday], [6, existingSaturday]])
      : null;
  }
  if (existingFriday) return shabbatDatesForReference(existingFriday);
  if (existingSaturday) return shabbatDatesForReference(existingSaturday);

  const reference = getEventStartDate(eventStartsAt ?? null)
    ?? getEventStartDate(occurrenceStartsAt ?? null)
    ?? draftSchedule.days.map((day) => day.date).find((date) => {
      const weekday = getWeekday(date);
      return weekday === 5 || weekday === 6;
    });
  return reference ? shabbatDatesForReference(reference) : null;
}

function shabbatDatesForReference(referenceDate: string): Map<number, string> | null {
  const weekday = getWeekday(referenceDate);
  if (weekday === null) return null;
  const saturday = addCalendarDays(referenceDate, (6 - weekday + 7) % 7);
  if (!saturday) return null;
  const friday = addCalendarDays(saturday, -1);
  if (!friday) return null;
  return new Map([[5, friday], [6, saturday]]);
}

function addCalendarDays(date: string, days: number): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return null;
  const value = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + days));
  return Number.isNaN(value.getTime()) ? null : `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, "0")}-${String(value.getUTCDate()).padStart(2, "0")}`;
}

function areConsecutiveDates(first: string, second: string): boolean {
  return addCalendarDays(first, 1) === second;
}

function automateProgramme(
  event: AdminEvent,
  schedule: AdminEventSchedule | null,
  occurrence: AdminEventOccurrence | null,
): AdminEventSchedule | null {
  return applyJewishProgrammeAutomation({
    eventKind: event.eventKind,
    referenceDate: event.eventKind === "shabbat"
      ? getEventStartDate(occurrence?.startsAt ?? null)
      : getEventStartDate(event.startsAt),
    schedule,
  });
}

function getWeekday(date: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return null;
  const civilDate = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return civilDate.getUTCFullYear() === Number(match[1])
    && civilDate.getUTCMonth() === Number(match[2]) - 1
    && civilDate.getUTCDate() === Number(match[3])
    ? civilDate.getUTCDay()
    : null;
}

function formatDate(date: Date, timezone?: string): string | null {
  const parts = new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    month: "2-digit",
    timeZone: timezone,
    year: "numeric",
  }).formatToParts(date);
  const values = new Map(parts.map((part) => [part.type, part.value]));
  const year = values.get("year");
  const month = values.get("month");
  const day = values.get("day");
  return year && month && day ? `${year}-${month}-${day}` : null;
}
