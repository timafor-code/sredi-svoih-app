import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type InputHTMLAttributes,
  type ReactNode,
} from "react";

import { Button } from "../ui/Button";
import type {
  AdminEvent,
  AdminEventMutationInput,
  AdminEventRegistrationMode,
  AdminEventStatus,
  AdminEventVisibility,
} from "../../types/events";
import {
  ADMIN_EVENT_REGISTRATION_MODES,
  ADMIN_EVENT_STATUSES,
  ADMIN_EVENT_VISIBILITIES,
} from "../../types/events";

const DEFAULT_TIMEZONE = "Europe/Moscow";
const DEFAULT_PRICE_CURRENCY = "RUB";

type EventFormMode = "create" | "edit";

type EventFormState = {
  title: string;
  subtitle: string;
  shortDescription: string;
  description: string;
  category: string;
  audience: string;
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
  timezone: string;
  locationName: string;
  address: string;
  imageUrl: string;
  status: string;
  visibility: string;
  registrationMode: string;
  registrationUrl: string;
  capacity: string;
  waitlistEnabled: boolean;
  requiresApproval: boolean;
  priceAmount: string;
  priceCurrency: string;
};

type StringFormField = {
  [Field in keyof EventFormState]: EventFormState[Field] extends string ? Field : never;
}[keyof EventFormState];

type FormErrorKey = StringFormField | "waitlistEnabled" | "requiresApproval" | "form";
type FormErrors = Partial<Record<FormErrorKey, string>>;

type EventFormProps = {
  cancelLabel?: string;
  disabled?: boolean;
  disabledMessage?: string | null;
  forceDraftHidden?: boolean;
  initialEvent?: AdminEvent | null;
  mode: EventFormMode;
  notice?: ReactNode;
  onCancel: () => void;
  onRegistrationModeChange?: (mode: string) => void;
  onSubmit: (input: AdminEventMutationInput) => Promise<boolean>;
  submitLabel?: string;
  submitError?: string | null;
  submittingLabel?: string;
  submitting: boolean;
};

const defaultForm: EventFormState = {
  title: "",
  subtitle: "",
  shortDescription: "",
  description: "",
  category: "",
  audience: "",
  startDate: "",
  startTime: "",
  endDate: "",
  endTime: "",
  timezone: DEFAULT_TIMEZONE,
  locationName: "",
  address: "",
  imageUrl: "",
  status: "draft",
  visibility: "hidden",
  registrationMode: "none",
  registrationUrl: "",
  capacity: "",
  waitlistEnabled: false,
  requiresApproval: false,
  priceAmount: "",
  priceCurrency: DEFAULT_PRICE_CURRENCY,
};

const statusOptions = ADMIN_EVENT_STATUSES.map((value) => ({ label: value, value }));
const visibilityOptions = ADMIN_EVENT_VISIBILITIES.map((value) => ({ label: value, value }));
const registrationModeOptions = ADMIN_EVENT_REGISTRATION_MODES.map((value) => ({
  label: value,
  value,
}));

export function EventForm({
  cancelLabel,
  disabled = false,
  disabledMessage = null,
  forceDraftHidden = false,
  initialEvent = null,
  mode,
  notice = null,
  onCancel,
  onRegistrationModeChange,
  onSubmit,
  submitLabel,
  submitError = null,
  submittingLabel,
  submitting,
}: EventFormProps) {
  const [form, setForm] = useState<EventFormState>(() =>
    buildInitialForm(initialEvent, forceDraftHidden),
  );
  const [errors, setErrors] = useState<FormErrors>({});
  const [isDirty, setIsDirty] = useState(false);
  const [hasSuccessfulEditSave, setHasSuccessfulEditSave] = useState(false);
  const previousEventIdRef = useRef<string | null>(initialEvent?.id ?? null);

  useEffect(() => {
    const nextEventId = initialEvent?.id ?? null;
    const isDifferentEvent = nextEventId !== previousEventIdRef.current;

    setForm(buildInitialForm(initialEvent, forceDraftHidden));
    setErrors({});
    setIsDirty(false);

    if (mode === "create" || isDifferentEvent) {
      setHasSuccessfulEditSave(false);
    }

    previousEventIdRef.current = nextEventId;
  }, [forceDraftHidden, initialEvent, mode]);

  const effectiveStatus = forceDraftHidden ? "draft" : form.status;
  const effectiveVisibility = forceDraftHidden ? "hidden" : form.visibility;
  const resolvedSubmitLabel =
    submitLabel ??
    (mode === "create" && effectiveStatus === "draft" && effectiveVisibility === "hidden"
      ? "Сохранить как черновик"
      : mode === "create"
        ? "Создать событие"
        : "Сохранить изменения");
  const resolvedSubmittingLabel =
    submittingLabel ?? (mode === "create" ? "Сохраняем..." : "Обновляем...");
  const resolvedCancelLabel = cancelLabel ?? (mode === "create" ? "К списку" : "Назад к списку");
  const isSavedEditState = mode === "edit" && hasSuccessfulEditSave && !isDirty;
  const submitButtonLabel = submitting
    ? resolvedSubmittingLabel
    : isSavedEditState
      ? "Изменения сохранены"
      : resolvedSubmitLabel;
  const isSubmitDisabled = disabled || submitting || isSavedEditState;

  const updateField = <Field extends keyof EventFormState>(
    field: Field,
    value: EventFormState[Field],
  ) => {
    if (forceDraftHidden && (field === "status" || field === "visibility")) {
      return;
    }

    setForm((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined, form: undefined }));

    if (field === "registrationMode" && typeof value === "string") {
      onRegistrationModeChange?.(value);
    }

    if (mode === "edit") {
      setIsDirty(true);
      setHasSuccessfulEditSave(false);
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (disabled) {
      setErrors({ form: disabledMessage ?? "Форма сейчас недоступна." });
      return;
    }

    const formForValidation = forceDraftHidden
      ? { ...form, status: "draft", visibility: "hidden" }
      : form;
    const validation = validateForm(formForValidation);
    setErrors(validation.errors);

    if (!validation.input) {
      return;
    }

    const isSaved = await onSubmit(validation.input);

    if (mode === "edit" && isSaved) {
      setIsDirty(false);
      setHasSuccessfulEditSave(true);
    }
  };

  return (
    <form className="event-create-form" noValidate onSubmit={handleSubmit}>
      {disabledMessage ? (
        <div className="form-error" role="alert">
          {disabledMessage}
        </div>
      ) : null}

      {submitError ? (
        <div className="form-error" role="alert">
          {submitError}
        </div>
      ) : null}

      {notice}

      <section className="event-form-section">
        <div className="event-form-section__head">
          <h2>Основное</h2>
        </div>
        <div className="event-form-grid event-form-grid--two">
          <TextField
            error={errors.title}
            label="Название *"
            onChange={(value) => updateField("title", value)}
            value={form.title}
          />
          <TextField
            error={errors.category}
            label="Категория *"
            onChange={(value) => updateField("category", value)}
            placeholder="Например: лекция, праздник, встреча"
            value={form.category}
          />
          <TextField
            label="Подзаголовок"
            onChange={(value) => updateField("subtitle", value)}
            value={form.subtitle}
          />
          <TextField
            label="Аудитория"
            onChange={(value) => updateField("audience", value)}
            placeholder="Для кого это событие"
            value={form.audience}
          />
          <TextAreaField
            label="Краткое описание"
            onChange={(value) => updateField("shortDescription", value)}
            value={form.shortDescription}
          />
          <TextAreaField
            label="Описание"
            onChange={(value) => updateField("description", value)}
            value={form.description}
          />
        </div>
      </section>

      <section className="event-form-section">
        <div className="event-form-section__head">
          <h2>Дата и время</h2>
        </div>
        <div className="event-form-grid event-form-grid--time">
          <TextField
            error={errors.startDate}
            label="Дата начала *"
            onChange={(value) => updateField("startDate", value)}
            type="date"
            value={form.startDate}
          />
          <TextField
            error={errors.startTime}
            label="Время начала *"
            onChange={(value) => updateField("startTime", value)}
            type="time"
            value={form.startTime}
          />
          <TextField
            error={errors.endDate}
            label="Дата окончания"
            onChange={(value) => updateField("endDate", value)}
            type="date"
            value={form.endDate}
          />
          <TextField
            error={errors.endTime}
            label="Время окончания"
            onChange={(value) => updateField("endTime", value)}
            type="time"
            value={form.endTime}
          />
          <TextField
            error={errors.timezone}
            label="Timezone"
            onChange={(value) => updateField("timezone", value)}
            value={form.timezone}
          />
        </div>
      </section>

      <section className="event-form-section">
        <div className="event-form-section__head">
          <h2>Место и афиша</h2>
        </div>
        <div className="event-form-grid event-form-grid--two">
          <TextField
            label="Название места"
            onChange={(value) => updateField("locationName", value)}
            value={form.locationName}
          />
          <TextField
            label="Адрес"
            onChange={(value) => updateField("address", value)}
            value={form.address}
          />
          <TextField
            label="Image URL"
            onChange={(value) => updateField("imageUrl", value)}
            placeholder="https://..."
            value={form.imageUrl}
          />
        </div>
      </section>

      <section className="event-form-section">
        <div className="event-form-section__head">
          <h2>Видимость и статус</h2>
        </div>
        <div className="event-form-grid event-form-grid--two">
          <SelectField
            error={errors.status}
            disabled={forceDraftHidden}
            label="Status"
            onChange={(value) => updateField("status", value)}
            options={statusOptions}
            value={effectiveStatus}
          />
          <SelectField
            error={errors.visibility}
            disabled={forceDraftHidden}
            label="Visibility"
            onChange={(value) => updateField("visibility", value)}
            options={visibilityOptions}
            value={effectiveVisibility}
          />
        </div>
      </section>

      <section className="event-form-section">
        <div className="event-form-section__head">
          <h2>Регистрация</h2>
        </div>
        <div className="event-form-grid event-form-grid--two">
          <SelectField
            error={errors.registrationMode}
            label="Registration mode *"
            onChange={(value) => updateField("registrationMode", value)}
            options={registrationModeOptions}
            value={form.registrationMode}
          />
          <TextField
            error={errors.registrationUrl}
            label="Registration URL"
            onChange={(value) => updateField("registrationUrl", value)}
            placeholder="https://..."
            value={form.registrationUrl}
          />
          <TextField
            error={errors.capacity}
            label="Capacity"
            min={1}
            onChange={(value) => updateField("capacity", value)}
            type="number"
            value={form.capacity}
          />
          <TextField
            error={errors.priceAmount}
            label="Price amount"
            min={0}
            onChange={(value) => updateField("priceAmount", value)}
            type="number"
            value={form.priceAmount}
          />
          <TextField
            label="Price currency"
            onChange={(value) => updateField("priceCurrency", value)}
            value={form.priceCurrency}
          />
        </div>

        <div className="event-form-checks">
          <CheckboxField
            checked={form.waitlistEnabled}
            label="Waitlist enabled"
            onChange={(value) => updateField("waitlistEnabled", value)}
          />
          <CheckboxField
            checked={form.requiresApproval}
            label="Requires approval"
            onChange={(value) => updateField("requiresApproval", value)}
          />
        </div>

        {form.registrationMode === "internal_paid" && mode === "create" ? (
          <div className="event-form-notice">
            Варианты участия и оплаты можно добавить после создания события.
          </div>
        ) : null}
      </section>

      {errors.form ? (
        <div className="form-error" role="alert">
          {errors.form}
        </div>
      ) : null}

      <div className="event-create-actions">
        <Button disabled={submitting} onClick={onCancel} variant="ghost">
          {resolvedCancelLabel}
        </Button>
        <Button disabled={isSubmitDisabled} type="submit" variant="primary">
          {submitButtonLabel}
        </Button>
      </div>
    </form>
  );
}

function TextField({
  error,
  label,
  onChange,
  value,
  ...props
}: {
  error?: string;
  label: string;
  onChange: (value: string) => void;
  value: string;
} & Pick<InputHTMLAttributes<HTMLInputElement>, "min" | "placeholder" | "type">) {
  return (
    <label className="event-form-field">
      <span>{label}</span>
      <input
        aria-invalid={Boolean(error)}
        onChange={(event) => onChange(event.target.value)}
        value={value}
        {...props}
      />
      {error ? <small>{error}</small> : null}
    </label>
  );
}

function TextAreaField({
  label,
  onChange,
  value,
}: {
  label: string;
  onChange: (value: string) => void;
  value: string;
}) {
  return (
    <label className="event-form-field event-form-field--wide">
      <span>{label}</span>
      <textarea onChange={(event) => onChange(event.target.value)} value={value} />
    </label>
  );
}

function SelectField({
  disabled = false,
  error,
  label,
  onChange,
  options,
  value,
}: {
  disabled?: boolean;
  error?: string;
  label: string;
  onChange: (value: string) => void;
  options: Array<{ label: string; value: string }>;
  value: string;
}) {
  return (
    <label className="event-form-field">
      <span>{label}</span>
      <select
        aria-invalid={Boolean(error)}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        value={value}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {error ? <small>{error}</small> : null}
    </label>
  );
}

function CheckboxField({
  checked,
  label,
  onChange,
}: {
  checked: boolean;
  label: string;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="event-form-check">
      <input
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        type="checkbox"
      />
      <span>{label}</span>
    </label>
  );
}

function buildInitialForm(
  event: AdminEvent | null,
  forceDraftHidden: boolean,
): EventFormState {
  const nextForm = event ? buildFormFromEvent(event) : defaultForm;

  return forceDraftHidden
    ? {
        ...nextForm,
        status: "draft",
        visibility: "hidden",
      }
    : nextForm;
}

function buildFormFromEvent(event: AdminEvent): EventFormState {
  const timezone = cleanString(event.timezone ?? "") ?? DEFAULT_TIMEZONE;
  const start = formatDateTimeForForm(event.startsAt, timezone);
  const end = formatDateTimeForForm(event.endsAt, timezone);

  return {
    title: event.title,
    subtitle: event.subtitle ?? "",
    shortDescription: event.shortDescription ?? "",
    description: event.description ?? "",
    category: event.category ?? "",
    audience: event.audience ?? "",
    startDate: start.date,
    startTime: start.time,
    endDate: end.date,
    endTime: end.time,
    timezone,
    locationName: event.locationName ?? "",
    address: event.address ?? "",
    imageUrl: event.imageUrl ?? "",
    status: event.status,
    visibility: event.visibility,
    registrationMode: event.registrationMode,
    registrationUrl: event.registrationUrl ?? "",
    capacity: event.capacity === null ? "" : String(event.capacity),
    waitlistEnabled: event.waitlistEnabled,
    requiresApproval: event.requiresApproval,
    priceAmount: event.priceAmount === null ? "" : String(event.priceAmount),
    priceCurrency: event.priceCurrency ?? DEFAULT_PRICE_CURRENCY,
  };
}

function validateForm(
  form: EventFormState,
): { errors: FormErrors; input: AdminEventMutationInput | null } {
  const errors: FormErrors = {};
  const title = cleanString(form.title);
  const category = cleanString(form.category);
  const timezone = cleanString(form.timezone) ?? DEFAULT_TIMEZONE;
  const status = isAdminEventStatus(form.status) ? form.status : null;
  const visibility = isAdminEventVisibility(form.visibility) ? form.visibility : null;
  const registrationMode = isAdminEventRegistrationMode(form.registrationMode)
    ? form.registrationMode
    : null;

  if (!title) {
    errors.title = "Укажите название события.";
  }

  if (!category) {
    errors.category = "Укажите категорию события.";
  }

  if (!form.startDate) {
    errors.startDate = "Укажите дату начала.";
  }

  if (!form.startTime) {
    errors.startTime = "Укажите время начала.";
  }

  if (!status) {
    errors.status = "Выберите корректный status.";
  }

  if (!visibility) {
    errors.visibility = "Выберите корректную visibility.";
  }

  if (!registrationMode) {
    errors.registrationMode = "Выберите корректный registration mode.";
  }

  if (registrationMode === "external_link" && !cleanString(form.registrationUrl)) {
    errors.registrationUrl = "Для external_link нужна ссылка регистрации.";
  }

  let startsAt: string | null = null;
  if (form.startDate && form.startTime) {
    try {
      startsAt = buildZonedIso(form.startDate, form.startTime, timezone);
    } catch {
      errors.startDate = "Дата и время начала должны быть валидными.";
      errors.timezone = "Проверьте timezone.";
    }
  }

  if (status === "published" && !startsAt) {
    errors.status = "Для published нужно валидное время начала.";
  }

  let endsAt: string | null = null;
  if (form.endDate || form.endTime) {
    if (!form.endDate) {
      errors.endDate = "Укажите дату окончания или очистите время окончания.";
    }

    if (!form.endTime) {
      errors.endTime = "Укажите время окончания или очистите дату окончания.";
    }

    if (form.endDate && form.endTime) {
      try {
        endsAt = buildZonedIso(form.endDate, form.endTime, timezone);
      } catch {
        errors.endDate = "Дата и время окончания должны быть валидными.";
      }
    }
  }

  if (startsAt && endsAt && new Date(endsAt).getTime() <= new Date(startsAt).getTime()) {
    errors.endDate = "Окончание должно быть позже начала.";
  }

  const capacity = parseIntegerField(form.capacity, false);
  if (capacity.error) {
    errors.capacity = "Capacity должен быть положительным целым числом.";
  }

  const priceAmount = parseIntegerField(form.priceAmount, true);
  if (priceAmount.error) {
    errors.priceAmount = "Price amount должен быть нулём или положительным целым числом.";
  }

  if (
    Object.keys(errors).length > 0 ||
    !startsAt ||
    !title ||
    !category ||
    !status ||
    !visibility ||
    !registrationMode
  ) {
    return { errors, input: null };
  }

  return {
    errors,
    input: {
      title,
      subtitle: cleanString(form.subtitle),
      shortDescription: cleanString(form.shortDescription),
      description: cleanString(form.description),
      startsAt,
      endsAt,
      timezone,
      locationName: cleanString(form.locationName),
      address: cleanString(form.address),
      imageUrl: cleanString(form.imageUrl),
      category,
      audience: cleanString(form.audience),
      visibility,
      status,
      registrationMode,
      registrationUrl: cleanString(form.registrationUrl),
      capacity: capacity.value,
      waitlistEnabled: form.waitlistEnabled,
      requiresApproval: form.requiresApproval,
      priceAmount: priceAmount.value,
      priceCurrency: cleanString(form.priceCurrency)?.toUpperCase() ?? DEFAULT_PRICE_CURRENCY,
    },
  };
}

function cleanString(value: string): string | null {
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function parseIntegerField(
  value: string,
  allowZero: boolean,
): { error: boolean; value: number | null } {
  const normalized = value.trim();

  if (!normalized) {
    return { error: false, value: null };
  }

  if (!/^\d+$/.test(normalized)) {
    return { error: true, value: null };
  }

  const parsed = Number(normalized);
  const isAllowed = Number.isSafeInteger(parsed) && (allowZero ? parsed >= 0 : parsed > 0);

  return isAllowed ? { error: false, value: parsed } : { error: true, value: null };
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
    timeZone: timezone,
    year: "numeric",
  });
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

function isAdminEventStatus(value: string): value is AdminEventStatus {
  return (ADMIN_EVENT_STATUSES as readonly string[]).includes(value);
}

function isAdminEventVisibility(value: string): value is AdminEventVisibility {
  return (ADMIN_EVENT_VISIBILITIES as readonly string[]).includes(value);
}

function isAdminEventRegistrationMode(value: string): value is AdminEventRegistrationMode {
  return (ADMIN_EVENT_REGISTRATION_MODES as readonly string[]).includes(value);
}
