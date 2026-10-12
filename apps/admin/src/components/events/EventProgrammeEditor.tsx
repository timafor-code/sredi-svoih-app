import { useEffect, useMemo, useRef, useState } from "react";

import { selectAdminProgrammeOccurrence } from "../../lib/adminProgrammeOccurrence";
import { parseEventScheduleDescription } from "../../lib/eventScheduleParser";
import { applyJewishProgrammeAutomation } from "../../lib/jewishProgrammeAutomation";
import { listAdminEventOccurrences } from "../../services/adminEventOccurrencesService";
import { listAdminEventParticipationOptions } from "../../services/adminParticipationOptionsService";
import type { AdminEvent, AdminEventSchedule } from "../../types/events";
import type { AdminEventOccurrence } from "../../types/eventOccurrences";
import type { ParticipationOption } from "../../types/participationOptions";
import { Button } from "../ui/Button";
import { SaveStatusView } from "../ui/SaveStatusView";
import {
  EventScheduleConstructor,
  validateEventSchedule,
} from "./EventScheduleConstructor";

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
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const baselineRef = useRef(baseline);
  const scheduleDirtyRef = useRef(false);
  const requestIdRef = useRef(0);
  const pendingOccurrenceRef = useRef<AdminEventOccurrence | null>(null);

  const startDate = useMemo(() => (
    getEventStartDate(selectedOccurrence?.startsAt ?? event.startsAt)
  ), [event.startsAt, selectedOccurrence?.startsAt]);
  const scheduleDirty = !sameSchedule(schedule, baseline);
  const optionsAreCurrent = !optionsLoading
    && !optionsError
    && loadedOptionsRevision === participationOptionsRevision;
  const optionsLoadingForSchedule = optionsLoading
    || (!optionsError && loadedOptionsRevision !== participationOptionsRevision);

  useEffect(() => {
    const nextDraft = createProgrammeDraft(event, null);
    baselineRef.current = cloneSchedule(nextDraft.baseline);
    scheduleDirtyRef.current = false;
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
    setParticipationOptions([]);
    setOptionsLoading(false);
    setOptionsError(null);
    setLoadedOptionsRevision(null);
    setSaving(false);
  }, [event.id]);

  useEffect(() => {
    const nextDraft = recalculateProgrammeForEventContext({
      event,
      hasUnsavedDraft: scheduleDirtyRef.current,
      occurrence: selectedOccurrence,
    });
    if (!nextDraft) return;
    baselineRef.current = cloneSchedule(nextDraft.baseline);
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
          setSchedule(templateProjection);
          setBaseline(cloneSchedule(templateProjection));
          setSelectedOccurrence(null);
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
        setSchedule(projected);
        setBaseline(cloneSchedule(projected));
        setSelectedOccurrence(selection.occurrence);
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
  }, [event.id, participationOptionsRevision]);

  useEffect(() => {
    scheduleDirtyRef.current = scheduleDirty;
    onDirtyChange(scheduleDirty);
  }, [onDirtyChange, scheduleDirty]);

  useEffect(() => () => onDirtyChange(false), [onDirtyChange, event.id]);

  const changeSchedule = (nextSchedule: AdminEventSchedule | null) => {
    const automated = automateProgramme(event, nextSchedule, selectedOccurrence);
    scheduleDirtyRef.current = !sameSchedule(automated, baselineRef.current);
    setSchedule(automated);
    setSaveError(null);
    setValidationError(null);
    setSavedAt(null);
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

  const save = async () => {
    if (saving || saveDisabled) return;
    const validation = validateEventSchedule(
      schedule,
      optionsAreCurrent ? participationOptions.map((option) => option.id) : null,
    );
    if (!validation.valid) {
      setValidationError("Проверьте программу события.");
      return;
    }

    setSaving(true);
    setSaveError(null);
    setValidationError(null);
    try {
      const confirmed = await onSave(prepareProgrammeScheduleForSave({
        eventKind: event.eventKind,
        persistedSchedule: event.schedule ?? null,
        draftSchedule: schedule,
      }));
      if (!confirmed) {
        setSaveError("Программа сейчас не может быть сохранена. Дождитесь завершения другого изменения и повторите попытку.");
        return;
      }
      const confirmedSchedule = cloneSchedule(confirmed.schedule ?? null);
      const occurrenceAfterSave = pendingOccurrenceRef.current ?? selectedOccurrence;
      const projected = automateProgramme(event, confirmedSchedule, occurrenceAfterSave);
      pendingOccurrenceRef.current = null;
      baselineRef.current = cloneSchedule(projected);
      scheduleDirtyRef.current = false;
      setSchedule(projected);
      setBaseline(cloneSchedule(projected));
      setSelectedOccurrence(occurrenceAfterSave);
      setProjectionNotice(null);
      setSavedAt(new Date().toISOString());
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Не удалось сохранить программу. Повторите попытку.");
    } finally {
      setSaving(false);
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
        disabled={saving}
        onChange={changeSchedule}
        options={participationOptions}
        optionsError={optionsError}
        optionsLoading={optionsLoadingForSchedule}
        parseControl={(
          <button
            className="event-schedule-constructor__parse"
            disabled={saving || !sourceText.trim() || !startDate}
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
      <div className="event-programme-editor__save">
        <SaveStatusView
          error={saveError}
          recovery="Проверьте программу и повторите сохранение."
          savedAt={savedAt}
          saving={saving}
          unsaved={scheduleDirty}
        />
        <Button disabled={saveDisabled || saving || !scheduleDirty} onClick={() => void save()} variant="success">
          Сохранить программу
        </Button>
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
  persistedSchedule,
  draftSchedule,
}: Readonly<{
  eventKind: string;
  persistedSchedule: AdminEventSchedule | null;
  draftSchedule: AdminEventSchedule | null;
}>): AdminEventSchedule | null {
  if (eventKind !== "shabbat") return cloneSchedule(draftSchedule);

  // A Shabbat draft is rendered for one concrete occurrence, but the event
  // stores a reusable programme template. Drop derived values and restore the
  // source dates for unchanged logical days before the explicit save request.
  const withoutOccurrenceValues = applyJewishProgrammeAutomation({
    eventKind: "single",
    referenceDate: null,
    schedule: draftSchedule,
  });
  if (!withoutOccurrenceValues || !persistedSchedule) return withoutOccurrenceValues;

  const restoredDates = withoutOccurrenceValues.days.map((day, index) => {
    const sourceDay = persistedSchedule.days[index];
    if (sourceDay && getWeekday(day.date) === getWeekday(sourceDay.date)) {
      return { ...day, date: sourceDay.date };
    }
    return day;
  });
  return { version: 1, days: restoredDates };
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
