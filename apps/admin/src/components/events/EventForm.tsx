import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type InputHTMLAttributes,
  type ReactNode,
} from "react";

import { Button } from "../ui/Button";
import type {
  AdminEvent,
  AdminEventKind,
  AdminEventMutationInput,
  AdminEventRegistrationMode,
  AdminEventStatus,
  AdminEventVisibility,
} from "../../types/events";
import {
  ADMIN_EVENT_KINDS,
  ADMIN_EVENT_REGISTRATION_MODES,
  ADMIN_EVENT_STATUSES,
  ADMIN_EVENT_VISIBILITIES,
  EVENT_STATUS_LABELS,
  EVENT_VISIBILITY_LABELS,
  REGISTRATION_MODE_LABELS,
} from "../../types/events";
import type { AdminCommunityLocation } from "../../types/communityLocations";
import type { AdminEventCategory } from "../../types/eventCategories";

const DEFAULT_TIMEZONE = "Europe/Moscow";
const DEFAULT_PRICE_CURRENCY = "RUB";
const LEGACY_LOCATION_VALUE = "__current_event_location__";

type EventFormMode = "create" | "edit";
type EventFormActionsPlacement = "bottom" | "stickyTop";

type RegistrationModeSlotContext = {
  registrationMode: string;
};

type EventFormState = {
  title: string;
  eventKind: string;
  subtitle: string;
  shortDescription: string;
  description: string;
  category: string;
  audience: string;
  startDate: string;
  startTime: string;
  isPermanent: boolean;
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
};

type StringFormField = {
  [Field in keyof EventFormState]: EventFormState[Field] extends string ? Field : never;
}[keyof EventFormState];

type FormErrorKey = StringFormField | "isPermanent" | "form";
type FormErrors = Partial<Record<FormErrorKey, string>>;

type EventFormProps = {
  actionsPlacement?: EventFormActionsPlacement;
  cancelLabel?: string;
  categories?: AdminEventCategory[];
  categoriesLoading?: boolean;
  categoriesError?: string | null;
  communityLocations?: AdminCommunityLocation[];
  communityLocationsLoading?: boolean;
  communityLocationsError?: string | null;
  disabled?: boolean;
  disabledMessage?: string | null;
  forceDraftHidden?: boolean;
  initialEvent?: AdminEvent | null;
  mode: EventFormMode;
  notice?: ReactNode;
  onCancel: () => void;
  onRegistrationModeChange?: (mode: string) => void;
  registrationModeSlot?: ReactNode | ((context: RegistrationModeSlotContext) => ReactNode);
  showEventKind?: boolean;
  onSubmit: (input: AdminEventMutationInput) => Promise<boolean>;
  submitLabel?: string;
  submitError?: string | null;
  submittingLabel?: string;
  submitting: boolean;
};

const defaultForm: EventFormState = {
  title: "",
  eventKind: "single",
  subtitle: "",
  shortDescription: "",
  description: "",
  category: "",
  audience: "",
  startDate: "",
  startTime: "",
  isPermanent: false,
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
};

const statusOptions = ADMIN_EVENT_STATUSES.map((value) => ({
  label: EVENT_STATUS_LABELS[value],
  value,
}));
const visibilityOptions = ADMIN_EVENT_VISIBILITIES.map((value) => ({
  label: EVENT_VISIBILITY_LABELS[value],
  value,
}));
const eventKindLabels: Record<AdminEventKind, string> = {
  single: "Разовое событие",
  course: "Курс / серия занятий",
  sunday_school: "Воскресная школа",
  shabbat: "Шабат",
  holiday: "Праздник",
  announcement: "Новость / объявление",
};
const eventKindOptions = ADMIN_EVENT_KINDS.map((value) => ({
  label: eventKindLabels[value],
  value,
}));
const registrationModeOptions = ADMIN_EVENT_REGISTRATION_MODES.map((value) => ({
  label: REGISTRATION_MODE_LABELS[value],
  value,
}));

export function EventForm({
  actionsPlacement = "bottom",
  cancelLabel,
  categories = [],
  categoriesLoading = false,
  categoriesError = null,
  communityLocations = [],
  communityLocationsLoading = false,
  communityLocationsError = null,
  disabled = false,
  disabledMessage = null,
  forceDraftHidden = false,
  initialEvent = null,
  mode,
  notice = null,
  onCancel,
  onRegistrationModeChange,
  registrationModeSlot = null,
  showEventKind = true,
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
  const isSubmitDisabled =
    disabled || submitting || isSavedEditState || (mode === "edit" && !isDirty);
  const hasActiveEditSave = mode === "edit" && isDirty && !isSubmitDisabled;
  const submitButtonVariant = hasActiveEditSave ? "success" : "secondary";

  const currentCategorySlug = form.category.trim();

  const categoryOptions = useMemo(() => {
    const sortedCategories = [...categories].sort((left, right) => (
      left.sortOrder === right.sortOrder
        ? left.title.localeCompare(right.title, "ru")
        : left.sortOrder - right.sortOrder
    ));

    const options = sortedCategories
      .filter((category) => category.isActive || category.slug === currentCategorySlug)
      .map((category) => ({
        label: `${category.icon} ${category.title}${category.isActive ? "" : " (\u0430\u0440\u0445\u0438\u0432)"} - ${category.slug}`,
        value: category.slug,
      }));

    if (currentCategorySlug && !options.some((option) => option.value === currentCategorySlug)) {
      options.push({
        label: `${currentCategorySlug} (\u0442\u0435\u043a\u0443\u0449\u0430\u044f \u043a\u0430\u0442\u0435\u0433\u043e\u0440\u0438\u044f \u043d\u0435 \u043d\u0430\u0439\u0434\u0435\u043d\u0430)`,
        value: currentCategorySlug,
      });
    }

    return options;
  }, [categories, currentCategorySlug]);

  const currentCategory = categories.find((category) => category.slug === currentCategorySlug) ?? null;
  const currentCategoryInactive = Boolean(currentCategory && !currentCategory.isActive);
  const activeCommunityLocations = useMemo(
    () =>
      [...communityLocations]
        .filter((location) => location.isActive)
        .sort((left, right) => {
          if (left.isDefault !== right.isDefault) {
            return left.isDefault ? -1 : 1;
          }

          return left.sortOrder === right.sortOrder
            ? left.title.localeCompare(right.title, "ru")
            : left.sortOrder - right.sortOrder;
        }),
    [communityLocations],
  );

  const currentLocationValue = useMemo(() => {
    const matchingLocation = activeCommunityLocations.find((location) =>
      isSameLocation(location, form.locationName, form.address),
    );

    if (matchingLocation) {
      return matchingLocation.id;
    }

    if (cleanString(form.locationName) || cleanString(form.address)) {
      return LEGACY_LOCATION_VALUE;
    }

    return "";
  }, [activeCommunityLocations, form.address, form.locationName]);

  const currentSelectedLocation =
    activeCommunityLocations.find((location) => location.id === currentLocationValue) ?? null;

  const locationOptions = useMemo(() => {
    if (communityLocationsLoading) {
      if (currentLocationValue === LEGACY_LOCATION_VALUE) {
        return [
          { label: "Текущее место из события", value: LEGACY_LOCATION_VALUE },
          { label: "Загружаем адреса...", value: "" },
        ];
      }

      return [{ label: "Загружаем адреса...", value: "" }];
    }

    const options = activeCommunityLocations.map((location) => ({
      label: `${location.title}${location.isDefault ? " (по умолчанию)" : ""} — ${location.address}`,
      value: location.id,
    }));

    if (currentLocationValue === "" && options.length > 0) {
      options.unshift({
        label: "Выберите место проведения",
        value: "",
      });
    }

    if (currentLocationValue === LEGACY_LOCATION_VALUE) {
      options.unshift({
        label: "Текущее место из события",
        value: LEGACY_LOCATION_VALUE,
      });
    }

    if (options.length === 0) {
      options.push({ label: "Адреса не добавлены", value: "" });
    }

    return options;
  }, [activeCommunityLocations, communityLocationsLoading, currentLocationValue]);

  useEffect(() => {
    if (mode !== "create" || form.category || categoryOptions.length === 0) {
      return;
    }

    const defaultCategory =
      categoryOptions.find((option) => option.value === "community") ?? categoryOptions[0];

    setForm((current) => (
      current.category ? current : { ...current, category: defaultCategory.value }
    ));
  }, [categoryOptions, form.category, mode]);

  useEffect(() => {
    if (
      mode !== "create" ||
      communityLocationsLoading ||
      form.locationName ||
      form.address
    ) {
      return;
    }

    const defaultLocation = activeCommunityLocations.find((location) => location.isDefault);
    if (!defaultLocation) {
      return;
    }

    setForm((current) =>
      current.locationName || current.address
        ? current
        : {
            ...current,
            locationName: defaultLocation.title,
            address: defaultLocation.address,
          },
    );
  }, [
    activeCommunityLocations,
    communityLocationsLoading,
    form.address,
    form.locationName,
    mode,
  ]);

  const updateField = <Field extends keyof EventFormState>(
    field: Field,
    value: EventFormState[Field],
  ) => {
    if (forceDraftHidden && (field === "status" || field === "visibility")) {
      return;
    }

    setForm((current) => {
      const next = { ...current, [field]: value };

      if (
        field === "registrationMode" &&
        typeof value === "string" &&
        value !== "external_link"
      ) {
        next.registrationUrl = "";
      }

      return next;
    });
    setErrors((current) => ({
      ...current,
      [field]: undefined,
      endDate: field === "isPermanent" && value === true ? undefined : current.endDate,
      endTime: field === "isPermanent" && value === true ? undefined : current.endTime,
      registrationUrl: field === "registrationMode" ? undefined : current.registrationUrl,
      form: undefined,
    }));

    if (field === "registrationMode" && typeof value === "string") {
      onRegistrationModeChange?.(value);
    }

    if (mode === "edit") {
      setIsDirty(true);
      setHasSuccessfulEditSave(false);
    }
  };

  const renderedRegistrationModeSlot =
    typeof registrationModeSlot === "function"
      ? registrationModeSlot({
          registrationMode: form.registrationMode,
        })
      : registrationModeSlot;

  const handleLocationSelect = (locationId: string) => {
    if (locationId === LEGACY_LOCATION_VALUE) {
      return;
    }

    const location = activeCommunityLocations.find((candidate) => candidate.id === locationId);

    setForm((current) => ({
      ...current,
      locationName: location?.title ?? "",
      address: location?.address ?? "",
    }));
    setErrors((current) => ({
      ...current,
      locationName: undefined,
      address: undefined,
      form: undefined,
    }));

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
      {actionsPlacement === "stickyTop" ? (
        <div className="event-form-sticky-actions">
          <Button
            className="event-form-sticky-actions__back"
            disabled={submitting}
            onClick={onCancel}
            variant="secondary"
          >
            {resolvedCancelLabel}
          </Button>
          <Button
            className="event-form-sticky-actions__submit"
            disabled={isSubmitDisabled}
            type="submit"
            variant={submitButtonVariant}
          >
            {submitButtonLabel}
          </Button>
        </div>
      ) : null}

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
          {showEventKind ? (
            <SelectField
              error={errors.eventKind}
              label="Тип события"
              onChange={(value) => updateField("eventKind", value)}
              options={eventKindOptions}
              value={form.eventKind}
            />
          ) : null}
          <SelectField
            disabled={categoriesLoading || categoryOptions.length === 0}
            error={errors.category}
            label={"\u041a\u0430\u0442\u0435\u0433\u043e\u0440\u0438\u044f *"}
            onChange={(value) => updateField("category", value)}
            options={
              categoryOptions.length > 0
                ? categoryOptions
                : [
                    {
                      label: categoriesLoading
                        ? "\u0417\u0430\u0433\u0440\u0443\u0436\u0430\u0435\u043c \u043a\u0430\u0442\u0435\u0433\u043e\u0440\u0438\u0438..."
                        : "\u041a\u0430\u0442\u0435\u0433\u043e\u0440\u0438\u0438 \u043d\u0435 \u043d\u0430\u0439\u0434\u0435\u043d\u044b",
                      value: "",
                    },
                  ]
            }
            value={form.category}
          />
          {categoriesError ? (
            <div className="event-form-notice event-form-field--wide" role="alert">
              {categoriesError}
            </div>
          ) : null}
          {currentCategoryInactive ? (
            <div className="event-form-notice event-form-field--wide">
              {"\u041a\u0430\u0442\u0435\u0433\u043e\u0440\u0438\u044f \u0430\u0440\u0445\u0438\u0432\u0438\u0440\u043e\u0432\u0430\u043d\u0430. \u0414\u043b\u044f \u043d\u043e\u0432\u044b\u0445 \u0441\u043e\u0431\u044b\u0442\u0438\u0439 \u0432\u044b\u0431\u0435\u0440\u0438\u0442\u0435 \u0430\u043a\u0442\u0438\u0432\u043d\u0443\u044e \u043a\u0430\u0442\u0435\u0433\u043e\u0440\u0438\u044e."}
            </div>
          ) : null}
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
          <CheckboxField
            checked={form.isPermanent}
            helperText="Не переносить событие в прошедшие по времени окончания. Используется для курсов, Шабата и серий."
            label="Постоянное событие"
            onChange={(value) => updateField("isPermanent", value)}
            variant="permanent"
          />
          <TextField
            disabled={form.isPermanent}
            error={errors.endDate}
            label="Дата окончания"
            onChange={(value) => updateField("endDate", value)}
            type="date"
            value={form.isPermanent ? "" : form.endDate}
          />
          <TextField
            disabled={form.isPermanent}
            error={errors.endTime}
            label="Время окончания"
            onChange={(value) => updateField("endTime", value)}
            type="time"
            value={form.isPermanent ? "" : form.endTime}
          />
          <TextField
            error={errors.timezone}
            label="Часовой пояс"
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
          <SelectField
            disabled={
              communityLocationsLoading ||
              (activeCommunityLocations.length === 0 &&
                currentLocationValue !== LEGACY_LOCATION_VALUE)
            }
            label="Место проведения"
            onChange={handleLocationSelect}
            options={locationOptions}
            value={currentLocationValue}
          />
          <TextField
            label="Ссылка на изображение"
            onChange={(value) => updateField("imageUrl", value)}
            placeholder="https://..."
            value={form.imageUrl}
          />
          {communityLocationsError ? (
            <div className="event-form-notice event-form-field--wide" role="alert">
              {communityLocationsError}
            </div>
          ) : null}
          {!communityLocationsLoading && activeCommunityLocations.length === 0 ? (
            <div className="event-form-notice event-form-field--wide">
              Добавьте адрес общины в Настройках
            </div>
          ) : null}
          {currentLocationValue === LEGACY_LOCATION_VALUE ? (
            <div className="event-form-notice event-form-field--wide">
              Текущее место из события сохранено как fallback. Выберите адрес из
              справочника, когда он будет добавлен в Настройках.
            </div>
          ) : null}
          {currentSelectedLocation ? (
            <div className="event-form-selected-location event-form-field--wide">
              <span>{currentSelectedLocation.title}</span>
              <strong>{currentSelectedLocation.address}</strong>
            </div>
          ) : null}
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
            label="Статус"
            onChange={(value) => updateField("status", value)}
            options={statusOptions}
            value={effectiveStatus}
          />
          <SelectField
            error={errors.visibility}
            disabled={forceDraftHidden}
            label="Видимость"
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
            label="Тип регистрации *"
            onChange={(value) => updateField("registrationMode", value)}
            options={registrationModeOptions}
            value={form.registrationMode}
          />
          {form.registrationMode === "external_link" ? (
            <TextField
              error={errors.registrationUrl}
              label="Ссылка регистрации"
              onChange={(value) => updateField("registrationUrl", value)}
              placeholder="https://..."
              value={form.registrationUrl}
            />
          ) : null}
          <TextField
            error={errors.capacity}
            label="Лимит мест"
            min={1}
            onChange={(value) => updateField("capacity", value)}
            type="number"
            value={form.capacity}
          />
        </div>

        {form.registrationMode === "internal_paid" && mode === "create" ? (
          <div className="event-form-notice">
            Варианты участия можно настроить после создания черновика события.
          </div>
        ) : null}

        {renderedRegistrationModeSlot}
      </section>

      {errors.form ? (
        <div className="form-error" role="alert">
          {errors.form}
        </div>
      ) : null}

      {actionsPlacement === "bottom" ? (
        <div className="event-create-actions">
          <Button disabled={submitting} onClick={onCancel} variant="ghost">
            {resolvedCancelLabel}
          </Button>
          <Button disabled={isSubmitDisabled} type="submit" variant="primary">
            {submitButtonLabel}
          </Button>
        </div>
      ) : null}
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
} & Pick<InputHTMLAttributes<HTMLInputElement>, "disabled" | "min" | "placeholder" | "type">) {
  return (
    <label
      className={
        props.disabled ? "event-form-field event-form-field--disabled" : "event-form-field"
      }
    >
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
  helperText,
  label,
  onChange,
  variant,
}: {
  checked: boolean;
  helperText?: string;
  label: string;
  onChange: (value: boolean) => void;
  variant?: "default" | "permanent";
}) {
  return (
    <label
      className={
        variant === "permanent"
          ? "event-form-check event-form-check--permanent"
          : "event-form-check"
      }
    >
      <input
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        type="checkbox"
      />
      <span className="event-form-check__content">
        <span>{label}</span>
        {helperText ? <small>{helperText}</small> : null}
      </span>
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
    eventKind: isAdminEventKind(event.eventKind) ? event.eventKind : "single",
    subtitle: event.subtitle ?? "",
    shortDescription: event.shortDescription ?? "",
    description: event.description ?? "",
    category: event.category ?? "",
    audience: event.audience ?? "",
    startDate: start.date,
    startTime: start.time,
    isPermanent: event.isPermanent,
    endDate: end.date,
    endTime: end.time,
    timezone,
    locationName: event.locationName ?? "",
    address: event.address ?? "",
    imageUrl: event.imageUrl ?? "",
    status: event.status,
    visibility: event.visibility,
    registrationMode: event.registrationMode,
    registrationUrl: event.registrationMode === "external_link" ? event.registrationUrl ?? "" : "",
    capacity: event.capacity === null ? "" : String(event.capacity),
  };
}

function validateForm(
  form: EventFormState,
): { errors: FormErrors; input: AdminEventMutationInput | null } {
  const errors: FormErrors = {};
  const title = cleanString(form.title);
  const eventKind = isAdminEventKind(form.eventKind) ? form.eventKind : null;
  const category = cleanString(form.category);
  const timezone = cleanString(form.timezone) ?? DEFAULT_TIMEZONE;
  const isPermanent = form.isPermanent;
  const status = isAdminEventStatus(form.status) ? form.status : null;
  const visibility = isAdminEventVisibility(form.visibility) ? form.visibility : null;
  const registrationMode = isAdminEventRegistrationMode(form.registrationMode)
    ? form.registrationMode
    : null;

  if (!title) {
    errors.title = "Укажите название события.";
  }

  if (!eventKind) {
    errors.eventKind = "Выберите корректный тип события.";
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
    errors.status = "Выберите корректный статус.";
  }

  if (!visibility) {
    errors.visibility = "Выберите корректную видимость.";
  }

  if (!registrationMode) {
    errors.registrationMode = "Выберите корректный тип регистрации.";
  }

  if (registrationMode === "external_link" && !cleanString(form.registrationUrl)) {
    errors.registrationUrl = "Для внешней регистрации нужна ссылка.";
  }

  let startsAt: string | null = null;
  if (form.startDate && form.startTime) {
    try {
      startsAt = buildZonedIso(form.startDate, form.startTime, timezone);
    } catch {
      errors.startDate = "Дата и время начала должны быть валидными.";
      errors.timezone = "Проверьте часовой пояс.";
    }
  }

  if (status === "published" && !startsAt) {
    errors.status = "Для публикации нужно валидное время начала.";
  }

  let endsAt: string | null = null;
  if (!isPermanent && (form.endDate || form.endTime)) {
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

  if (!isPermanent && startsAt && endsAt && new Date(endsAt).getTime() <= new Date(startsAt).getTime()) {
    errors.endDate = "Окончание должно быть позже начала.";
  }

  const capacity = parseIntegerField(form.capacity, false);
  if (capacity.error) {
    errors.capacity = "Лимит мест должен быть положительным целым числом.";
  }

  if (
    Object.keys(errors).length > 0 ||
    !startsAt ||
    !title ||
    !eventKind ||
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
      eventKind,
      subtitle: cleanString(form.subtitle),
      shortDescription: cleanString(form.shortDescription),
      description: cleanString(form.description),
      startsAt,
      endsAt: isPermanent ? null : endsAt,
      isPermanent,
      timezone,
      locationName: cleanString(form.locationName),
      address: cleanString(form.address),
      imageUrl: cleanString(form.imageUrl),
      category,
      audience: cleanString(form.audience),
      visibility,
      status,
      registrationMode,
      registrationUrl:
        registrationMode === "external_link" ? cleanString(form.registrationUrl) : null,
      capacity: capacity.value,
      waitlistEnabled: false,
      requiresApproval: false,
      priceAmount: null,
      priceCurrency: DEFAULT_PRICE_CURRENCY,
    },
  };
}

function isSameLocation(
  location: AdminCommunityLocation,
  locationName: string,
  address: string,
): boolean {
  return (
    normalizeLocationText(location.title) === normalizeLocationText(locationName) &&
    normalizeLocationText(location.address) === normalizeLocationText(address)
  );
}

function normalizeLocationText(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("ru");
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

function isAdminEventKind(value: string): value is AdminEventKind {
  return (ADMIN_EVENT_KINDS as readonly string[]).includes(value);
}

function isAdminEventRegistrationMode(value: string): value is AdminEventRegistrationMode {
  return (ADMIN_EVENT_REGISTRATION_MODES as readonly string[]).includes(value);
}
