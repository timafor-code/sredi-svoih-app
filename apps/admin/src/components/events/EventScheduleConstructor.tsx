import type { ReactNode } from "react";

import type {
  AdminEventSchedule,
  AdminEventScheduleDay,
  AdminEventScheduleItem,
} from "../../types/events";
import type { ParticipationOption } from "../../types/participationOptions";

const MAX_DAYS = 30;
const MAX_ITEMS_PER_DAY = 60;
const MAX_TEXT_LENGTH = 200;

type ScheduleItemErrors = Partial<Record<"time" | "title" | "optionId", string>>;
type ScheduleDayErrors = Partial<Pick<Record<"date" | "label" | "note", string>, "date" | "label" | "note">> & {
  items: ScheduleItemErrors[];
};

export type EventScheduleValidation = {
  days: ScheduleDayErrors[];
  form: string | null;
  valid: boolean;
};

type EventScheduleConstructorProps = {
  disabled?: boolean;
  options: ParticipationOption[];
  optionsError?: string | null;
  optionsLoading?: boolean;
  onChange: (schedule: AdminEventSchedule | null) => void;
  schedule: AdminEventSchedule | null;
};

export function EventScheduleConstructor({
  disabled = false,
  options,
  optionsError = null,
  optionsLoading = false,
  onChange,
  schedule,
}: EventScheduleConstructorProps) {
  const optionIds = optionsLoading || optionsError ? null : options.map((option) => option.id);
  const validation = validateEventSchedule(schedule, optionIds);
  const sortedOptions = [...options].sort((left, right) => (
    left.sortOrder === right.sortOrder
      ? left.title.localeCompare(right.title, "ru")
      : left.sortOrder - right.sortOrder
  ));
  const optionsById = new Map(sortedOptions.map((option) => [option.id, option]));

  const updateSchedule = (updater: (current: AdminEventSchedule) => AdminEventSchedule) => {
    onChange(updater(schedule ?? { version: 1, days: [] }));
  };

  const addDay = () => {
    if (disabled || (schedule?.days.length ?? 0) >= MAX_DAYS) return;
    updateSchedule((current) => ({
      ...current,
      days: [...current.days, { date: "", label: null, note: null, items: [] }],
    }));
  };

  const removeDay = (dayIndex: number) => {
    if (disabled || !schedule) return;
    const days = schedule.days.filter((_, index) => index !== dayIndex);
    onChange(days.length > 0 ? { version: 1, days } : null);
  };

  const moveDay = (dayIndex: number, direction: -1 | 1) => {
    if (disabled || !schedule) return;
    const targetIndex = dayIndex + direction;
    if (targetIndex < 0 || targetIndex >= schedule.days.length) return;
    const days = [...schedule.days];
    [days[dayIndex], days[targetIndex]] = [days[targetIndex], days[dayIndex]];
    onChange({ version: 1, days });
  };

  const updateDay = <Field extends keyof Omit<AdminEventScheduleDay, "items">>(
    dayIndex: number,
    field: Field,
    value: AdminEventScheduleDay[Field],
  ) => {
    updateSchedule((current) => ({
      ...current,
      days: current.days.map((day, index) => index === dayIndex ? { ...day, [field]: value } : day),
    }));
  };

  const addItem = (dayIndex: number) => {
    if (disabled || !schedule || schedule.days[dayIndex].items.length >= MAX_ITEMS_PER_DAY) return;
    updateSchedule((current) => ({
      ...current,
      days: current.days.map((day, index) => index === dayIndex ? {
        ...day,
        items: [...day.items, { time: "", title: "", optionId: null }],
      } : day),
    }));
  };

  const updateItem = <Field extends keyof AdminEventScheduleItem>(
    dayIndex: number,
    itemIndex: number,
    field: Field,
    value: AdminEventScheduleItem[Field],
  ) => {
    updateSchedule((current) => ({
      ...current,
      days: current.days.map((day, currentDayIndex) => currentDayIndex === dayIndex ? {
        ...day,
        items: day.items.map((item, currentItemIndex) => currentItemIndex === itemIndex
          ? { ...item, [field]: value }
          : item),
      } : day),
    }));
  };

  const removeItem = (dayIndex: number, itemIndex: number) => {
    if (disabled) return;
    updateSchedule((current) => ({
      ...current,
      days: current.days.map((day, index) => index === dayIndex ? {
        ...day,
        items: day.items.filter((_, currentItemIndex) => currentItemIndex !== itemIndex),
      } : day),
    }));
  };

  const moveItem = (dayIndex: number, itemIndex: number, direction: -1 | 1) => {
    if (disabled || !schedule) return;
    const items = schedule.days[dayIndex].items;
    const targetIndex = itemIndex + direction;
    if (targetIndex < 0 || targetIndex >= items.length) return;
    updateSchedule((current) => ({
      ...current,
      days: current.days.map((day, index) => {
        if (index !== dayIndex) return day;
        const nextItems = [...day.items];
        [nextItems[itemIndex], nextItems[targetIndex]] = [nextItems[targetIndex], nextItems[itemIndex]];
        return { ...day, items: nextItems };
      }),
    }));
  };

  return (
    <section className="event-form-section event-schedule-constructor" aria-labelledby="event-schedule-heading">
      <header className="event-schedule-constructor__head">
        <div>
          <h2 id="event-schedule-heading">Программа</h2>
          <p>Дни и пункты программы. Описание события остаётся отдельным полем.</p>
        </div>
        <button
          className="event-schedule-constructor__add"
          disabled={disabled || (schedule?.days.length ?? 0) >= MAX_DAYS}
          onClick={addDay}
          type="button"
        >
          + Добавить день
        </button>
      </header>

      {schedule === null ? (
        <div className="event-schedule-constructor__empty">
          <p>Программа пока не добавлена.</p>
          <button disabled={disabled} onClick={addDay} type="button">+ Добавить первый день</button>
        </div>
      ) : (
        <div className="event-schedule-constructor__days">
          {schedule.days.map((day, dayIndex) => {
            const dayErrors = validation.days[dayIndex] ?? { items: [] };
            return (
              <section className="event-schedule-day" key={`${dayIndex}-${day.date}`}>
                <header className="event-schedule-day__head">
                  <h3>{`День ${dayIndex + 1}`}</h3>
                  <div className="event-schedule-actions">
                    <button aria-label="Переместить день выше" disabled={disabled || dayIndex === 0}
                      onClick={() => moveDay(dayIndex, -1)} title="Переместить выше" type="button">↑</button>
                    <button aria-label="Переместить день ниже" disabled={disabled || dayIndex === schedule.days.length - 1}
                      onClick={() => moveDay(dayIndex, 1)} title="Переместить ниже" type="button">↓</button>
                    <button aria-label="Удалить день" className="event-schedule-actions__danger" disabled={disabled}
                      onClick={() => removeDay(dayIndex)} title="Удалить день" type="button">×</button>
                  </div>
                </header>

                <div className="event-schedule-day__fields">
                  <ScheduleField error={dayErrors.date} label="Дата *">
                    <input aria-invalid={Boolean(dayErrors.date)} disabled={disabled} onChange={(event) => updateDay(dayIndex, "date", event.target.value)} type="date" value={day.date} />
                  </ScheduleField>
                  <ScheduleField error={dayErrors.label} label="Название дня">
                    <input aria-invalid={Boolean(dayErrors.label)} disabled={disabled}
                      onChange={(event) => updateDay(dayIndex, "label", optionalText(event.target.value))} value={day.label ?? ""} />
                  </ScheduleField>
                  <ScheduleField error={dayErrors.note} label="Примечание">
                    <input aria-invalid={Boolean(dayErrors.note)} disabled={disabled}
                      onChange={(event) => updateDay(dayIndex, "note", optionalText(event.target.value))} value={day.note ?? ""} />
                  </ScheduleField>
                </div>

                <div className="event-schedule-items">
                  <div className="event-schedule-items__head">
                    <h4>Пункты программы</h4>
                    <span>{`${day.items.length} / ${MAX_ITEMS_PER_DAY}`}</span>
                  </div>
                  {day.items.length === 0 ? <p className="event-schedule-items__empty">Добавьте первый пункт программы.</p> : null}
                  {day.items.map((item, itemIndex) => {
                    const itemErrors = dayErrors.items[itemIndex] ?? {};
                    const linkedOption = item.optionId ? optionsById.get(item.optionId) : null;
                    const missingOption = item.optionId && !linkedOption;
                    const missingOptionLabel = optionsLoading || optionsError
                      ? `Недоступный вариант (${item.optionId})`
                      : `Удалённый вариант (${item.optionId})`;
                    const selectDisabled = disabled || optionsLoading || Boolean(optionsError)
                      || (item.optionId === null && sortedOptions.length === 0);
                    return (
                      <div className="event-schedule-item" key={`${itemIndex}-${item.optionId ?? "none"}`}>
                        <ScheduleField error={itemErrors.time} label="Время *">
                          <input aria-invalid={Boolean(itemErrors.time)} disabled={disabled} onChange={(event) => updateItem(dayIndex, itemIndex, "time", event.target.value)} type="time" value={item.time} />
                        </ScheduleField>
                        <ScheduleField error={itemErrors.title} label="Название *">
                          <input aria-invalid={Boolean(itemErrors.title)} disabled={disabled}
                            onChange={(event) => updateItem(dayIndex, itemIndex, "title", event.target.value)} value={item.title} />
                        </ScheduleField>
                        <ScheduleField error={itemErrors.optionId} label="Вариант участия">
                          <select aria-invalid={Boolean(itemErrors.optionId)} disabled={selectDisabled}
                            onChange={(event) => updateItem(dayIndex, itemIndex, "optionId", event.target.value || null)} value={item.optionId ?? ""}>
                            <option value="">Без связанного варианта</option>
                            {missingOption ? <option value={item.optionId ?? ""}>{missingOptionLabel}</option> : null}
                            {sortedOptions.map((option) => <option key={option.id} value={option.id}>{formatOption(option)}</option>)}
                          </select>
                          {optionsLoading ? <small>Загружаем варианты участия…</small> : null}
                          {!optionsLoading && !optionsError && sortedOptions.length === 0 ? <small>Для этого события ещё нет вариантов участия.</small> : null}
                        </ScheduleField>
                        <div className="event-schedule-item__actions event-schedule-actions">
                          <button aria-label="Переместить пункт выше" disabled={disabled || itemIndex === 0}
                            onClick={() => moveItem(dayIndex, itemIndex, -1)} title="Переместить выше" type="button">↑</button>
                          <button aria-label="Переместить пункт ниже" disabled={disabled || itemIndex === day.items.length - 1}
                            onClick={() => moveItem(dayIndex, itemIndex, 1)} title="Переместить ниже" type="button">↓</button>
                          <button aria-label="Удалить пункт" className="event-schedule-actions__danger" disabled={disabled}
                            onClick={() => removeItem(dayIndex, itemIndex)} title="Удалить пункт" type="button">×</button>
                        </div>
                      </div>
                    );
                  })}
                  <button className="event-schedule-items__add" disabled={disabled || day.items.length >= MAX_ITEMS_PER_DAY}
                    onClick={() => addItem(dayIndex)} type="button">+ Добавить пункт</button>
                </div>
              </section>
            );
          })}
        </div>
      )}
      {optionsError ? <p className="event-schedule-constructor__notice" role="alert">{optionsError}</p> : null}
      {validation.form ? <p className="event-schedule-constructor__notice" role="alert">{validation.form}</p> : null}
    </section>
  );
}

function ScheduleField({ children, error, label }: { children: ReactNode; error?: string; label: string }) {
  return <label className="event-schedule-field"><span>{label}</span>{children}{error ? <small>{error}</small> : null}</label>;
}

function optionalText(value: string): string | null {
  return value.trim() ? value : null;
}

function formatOption(option: ParticipationOption): string {
  const inactive = option.isActive ? "" : " (неактивен)";
  return `${option.title}${inactive} · ${formatPrice(option.priceAmount, option.priceCurrency)}`;
}

function formatPrice(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat("ru-RU", { style: "currency", currency: currency || "RUB", maximumFractionDigits: 0 }).format(amount);
  } catch {
    return `${amount.toLocaleString("ru-RU")} ${currency || "RUB"}`;
  }
}

export function validateEventSchedule(
  schedule: AdminEventSchedule | null,
  availableOptionIds: readonly string[] | null,
): EventScheduleValidation {
  if (schedule === null) return { days: [], form: null, valid: true };

  const days: ScheduleDayErrors[] = schedule.days.map((day) => ({
    date: isCalendarDate(day.date) ? undefined : "Укажите корректную дату в формате ГГГГ-ММ-ДД.",
    label: exceedsMaxLength(day.label) ? "Не более 200 символов." : undefined,
    note: exceedsMaxLength(day.note) ? "Не более 200 символов." : undefined,
    items: day.items.map((item) => ({
      time: isTime(item.time) ? undefined : "Укажите время в формате ЧЧ:ММ.",
      title: !item.title.trim() ? "Укажите название пункта." : exceedsMaxLength(item.title) ? "Не более 200 символов." : undefined,
      optionId: item.optionId && availableOptionIds !== null && !availableOptionIds.includes(item.optionId)
        ? "Связанный вариант участия удалён. Выберите другой вариант или снимите связь."
        : undefined,
    })),
  }));
  const tooManyDays = schedule.days.length > MAX_DAYS;
  const tooManyItems = schedule.days.some((day) => day.items.length > MAX_ITEMS_PER_DAY);
  const unavailableOptions = availableOptionIds === null && schedule.days.some((day) => day.items.some((item) => item.optionId));
  const invalidFields = days.some((day) => Boolean(day.date || day.label || day.note || day.items.some((item) => Object.values(item).some(Boolean))));
  const form = tooManyDays
    ? `В программе может быть не более ${MAX_DAYS} дней.`
    : tooManyItems
      ? `В одном дне может быть не более ${MAX_ITEMS_PER_DAY} пунктов.`
      : unavailableOptions
        ? "Нельзя проверить связанные варианты участия. Дождитесь загрузки или повторите попытку."
        : null;

  return { days, form, valid: !invalidFields && !form };
}

function exceedsMaxLength(value: string | null): boolean {
  return (value?.length ?? 0) > MAX_TEXT_LENGTH;
}

function isCalendarDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function isTime(value: string): boolean {
  return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
}
