import { useEffect, useMemo, useState } from "react";

import { parseEventScheduleDescription } from "../../lib/eventScheduleParser";
import { applyJewishProgrammeAutomation } from "../../lib/jewishProgrammeAutomation";
import { listAdminEventParticipationOptions } from "../../services/adminParticipationOptionsService";
import type { AdminEvent, AdminEventSchedule } from "../../types/events";
import type { ParticipationOption } from "../../types/participationOptions";
import { Button } from "../ui/Button";
import { SaveStatusView } from "../ui/SaveStatusView";
import {
  EventScheduleConstructor,
  validateEventSchedule,
} from "./EventScheduleConstructor";

type EventProgrammeEditorProps = {
  event: AdminEvent;
  participationOptionsRevision: number;
  saveDisabled?: boolean;
  onDirtyChange: (dirty: boolean) => void;
  onSave: (schedule: AdminEventSchedule | null) => Promise<AdminEvent | null>;
};

export function EventProgrammeEditor({
  event,
  participationOptionsRevision,
  saveDisabled = false,
  onDirtyChange,
  onSave,
}: EventProgrammeEditorProps) {
  const [schedule, setSchedule] = useState<AdminEventSchedule | null>(() => (
    automateProgramme(event, event.schedule ?? null)
  ));
  const [baseline, setBaseline] = useState<AdminEventSchedule | null>(() => cloneSchedule(event.schedule ?? null));
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

  const startDate = useMemo(() => getEventStartDate(event), [event.startsAt]);
  const scheduleDirty = !sameSchedule(schedule, baseline);
  const optionsAreCurrent = !optionsLoading
    && !optionsError
    && loadedOptionsRevision === participationOptionsRevision;
  const optionsLoadingForSchedule = optionsLoading
    || (!optionsError && loadedOptionsRevision !== participationOptionsRevision);

  useEffect(() => {
    const nextSchedule = cloneSchedule(event.schedule ?? null);
    setSchedule(automateProgramme(event, nextSchedule));
    setBaseline(nextSchedule);
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
    // This reacts only to persisted event context. Its pure transform does not
    // depend on the Programme draft, so normal edits cannot create a loop.
    setSchedule((current) => automateProgramme(event, current));
  }, [event.eventKind, event.startsAt]);

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
    onDirtyChange(scheduleDirty);
  }, [onDirtyChange, scheduleDirty]);

  useEffect(() => () => onDirtyChange(false), [onDirtyChange, event.id]);

  const changeSchedule = (nextSchedule: AdminEventSchedule | null) => {
    setSchedule(automateProgramme(event, nextSchedule));
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
    setSchedule(automateProgramme(event, result.schedule));
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
      const confirmed = await onSave(schedule);
      if (!confirmed) {
        setSaveError("Программа сейчас не может быть сохранена. Дождитесь завершения другого изменения и повторите попытку.");
        return;
      }
      const confirmedSchedule = cloneSchedule(confirmed.schedule ?? null);
      setSchedule(automateProgramme(event, confirmedSchedule));
      setBaseline(confirmedSchedule);
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

function getEventStartDate(event: AdminEvent): string | null {
  if (!event.startsAt) return null;
  const date = new Date(event.startsAt);
  if (Number.isNaN(date.getTime())) return null;

  try {
    return formatDate(date, "Europe/Moscow");
  } catch {
    return formatDate(date);
  }
}

function automateProgramme(event: AdminEvent, schedule: AdminEventSchedule | null): AdminEventSchedule | null {
  return applyJewishProgrammeAutomation({
    eventKind: event.eventKind,
    referenceDate: getEventStartDate(event),
    schedule,
  });
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
