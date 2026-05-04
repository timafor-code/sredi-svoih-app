import { useEffect, useMemo, useState } from "react";

import { Button } from "../ui/Button";
import {
  listAdminEventParticipationOptions,
  replaceAdminEventParticipationOptions,
} from "../../services/adminParticipationOptionsService";
import {
  PARTICIPATION_OPTION_TYPES,
  type ParticipationOption,
  type ParticipationOptionInput,
  type ParticipationOptionType,
} from "../../types/participationOptions";

const DEFAULT_PRICE_CURRENCY = "RUB";

type ParticipationOptionsConstructorProps = {
  eventId: string;
  eventCapacity: number | null;
  defaultPriceCurrency?: string | null;
};

type DraftOption = {
  draftId: string;
  remoteId: string | null;
  title: string;
  description: string;
  priceAmount: string;
  priceCurrency: string;
  optionType: ParticipationOptionType;
  seatLimit: string;
  allowQuantity: boolean;
  minQuantity: string;
  maxQuantity: string;
  isDonation: boolean;
  countsTowardCapacity: boolean;
  groupKey: string;
  conflictsWith: string;
  sortOrder: string;
  isActive: boolean;
};

type DraftValidation =
  | { ok: true; input: ParticipationOptionInput }
  | { ok: false; errors: Partial<Record<keyof DraftOption, string>> };

let draftIdCounter = 0;

function nextDraftId(): string {
  draftIdCounter += 1;
  return `draft-${Date.now().toString(36)}-${draftIdCounter}`;
}

function isParticipationOptionType(value: string): value is ParticipationOptionType {
  return (PARTICIPATION_OPTION_TYPES as readonly string[]).includes(value);
}

function buildDraftFromOption(option: ParticipationOption): DraftOption {
  return {
    draftId: nextDraftId(),
    remoteId: option.id,
    title: option.title,
    description: option.description ?? "",
    priceAmount: String(option.priceAmount),
    priceCurrency: option.priceCurrency,
    optionType: isParticipationOptionType(option.optionType)
      ? option.optionType
      : "participation",
    seatLimit: option.seatLimit === null ? "" : String(option.seatLimit),
    allowQuantity: option.allowQuantity,
    minQuantity: String(option.minQuantity),
    maxQuantity: String(option.maxQuantity),
    isDonation: option.isDonation,
    countsTowardCapacity: option.countsTowardCapacity,
    groupKey: option.groupKey ?? "",
    conflictsWith: option.conflictsWith.join(", "),
    sortOrder: String(option.sortOrder),
    isActive: option.isActive,
  };
}

function buildEmptyDraft(
  index: number,
  currency: string,
): DraftOption {
  return {
    draftId: nextDraftId(),
    remoteId: null,
    title: "",
    description: "",
    priceAmount: "0",
    priceCurrency: currency,
    optionType: "participation",
    seatLimit: "",
    allowQuantity: false,
    minQuantity: "1",
    maxQuantity: "1",
    isDonation: false,
    countsTowardCapacity: true,
    groupKey: "",
    conflictsWith: "",
    sortOrder: String(index),
    isActive: true,
  };
}

function parseInteger(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  if (!/^-?\d+$/.test(trimmed)) {
    return Number.NaN;
  }
  const parsed = Number(trimmed);
  return Number.isSafeInteger(parsed) ? parsed : Number.NaN;
}

function validateDraft(draft: DraftOption, fallbackIndex: number): DraftValidation {
  const errors: Partial<Record<keyof DraftOption, string>> = {};

  const title = draft.title.trim();
  if (!title) {
    errors.title = "Укажите название варианта.";
  }

  const priceAmount = parseInteger(draft.priceAmount);
  if (priceAmount === null || Number.isNaN(priceAmount) || priceAmount < 0) {
    errors.priceAmount = "Цена должна быть целым числом >= 0.";
  }

  const priceCurrency = draft.priceCurrency.trim().toUpperCase();
  if (!priceCurrency) {
    errors.priceCurrency = "Укажите валюту.";
  }

  let seatLimit: number | null = null;
  if (draft.seatLimit.trim()) {
    const parsed = parseInteger(draft.seatLimit);
    if (parsed === null || Number.isNaN(parsed) || parsed <= 0) {
      errors.seatLimit = "Лимит мест должен быть положительным целым числом.";
    } else {
      seatLimit = parsed;
    }
  }

  const minQuantityParsed = draft.allowQuantity ? parseInteger(draft.minQuantity) : 1;
  const maxQuantityParsed = draft.allowQuantity ? parseInteger(draft.maxQuantity) : 1;

  const minQuantity =
    typeof minQuantityParsed === "number" && !Number.isNaN(minQuantityParsed)
      ? minQuantityParsed
      : null;
  const maxQuantity =
    typeof maxQuantityParsed === "number" && !Number.isNaN(maxQuantityParsed)
      ? maxQuantityParsed
      : null;

  if (draft.allowQuantity) {
    if (minQuantity === null || minQuantity < 1) {
      errors.minQuantity = "Минимум должен быть >= 1.";
    }
    if (maxQuantity === null || maxQuantity < 1) {
      errors.maxQuantity = "Максимум должен быть >= 1.";
    }
    if (
      minQuantity !== null &&
      maxQuantity !== null &&
      maxQuantity < minQuantity
    ) {
      errors.maxQuantity = "Максимум должен быть >= минимума.";
    }
  }

  const sortOrderParsed = parseInteger(draft.sortOrder);
  const sortOrder =
    sortOrderParsed === null || Number.isNaN(sortOrderParsed)
      ? fallbackIndex
      : sortOrderParsed;

  if (draft.sortOrder.trim() && (sortOrderParsed === null || Number.isNaN(sortOrderParsed))) {
    errors.sortOrder = "Sort order должен быть целым числом.";
  }

  const conflictsWith = draft.conflictsWith
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  if (Object.keys(errors).length > 0) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    input: {
      title,
      description: draft.description.trim() ? draft.description.trim() : null,
      priceAmount: priceAmount as number,
      priceCurrency,
      optionType: draft.optionType,
      seatLimit,
      allowQuantity: draft.allowQuantity,
      minQuantity: minQuantity ?? 1,
      maxQuantity: maxQuantity ?? 1,
      isDonation: draft.isDonation,
      countsTowardCapacity: draft.countsTowardCapacity,
      groupKey: draft.groupKey.trim() ? draft.groupKey.trim() : null,
      conflictsWith,
      sortOrder,
      isActive: draft.isActive,
    },
  };
}

function formatPriceRange(min: number, max: number, currency: string): string {
  if (min === max) {
    return `${min} ${currency}`;
  }
  return `${min}–${max} ${currency}`;
}

export function ParticipationOptionsConstructor({
  eventId,
  eventCapacity,
  defaultPriceCurrency,
}: ParticipationOptionsConstructorProps) {
  const fallbackCurrency =
    defaultPriceCurrency && defaultPriceCurrency.trim()
      ? defaultPriceCurrency.trim().toUpperCase()
      : DEFAULT_PRICE_CURRENCY;

  const [drafts, setDrafts] = useState<DraftOption[]>([]);
  const [errorsByDraft, setErrorsByDraft] = useState<
    Record<string, Partial<Record<keyof DraftOption, string>>>
  >({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [isDirty, setIsDirty] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    setSaveError(null);
    setSavedAt(null);
    setIsDirty(false);

    listAdminEventParticipationOptions(eventId)
      .then((options) => {
        if (cancelled) return;
        setDrafts(options.map(buildDraftFromOption));
      })
      .catch((error) => {
        if (cancelled) return;
        setLoadError(
          error instanceof Error
            ? error.message
            : "Не удалось загрузить варианты участия.",
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

  const updateDraft = (
    draftId: string,
    updater: (draft: DraftOption) => DraftOption,
  ) => {
    setDrafts((current) =>
      current.map((draft) => (draft.draftId === draftId ? updater(draft) : draft)),
    );
    setErrorsByDraft((current) => {
      if (!current[draftId]) return current;
      const { [draftId]: _omitted, ...rest } = current;
      return rest;
    });
    setIsDirty(true);
    setSavedAt(null);
  };

  const handleAdd = () => {
    setDrafts((current) => [
      ...current,
      buildEmptyDraft(current.length, fallbackCurrency),
    ]);
    setIsDirty(true);
    setSavedAt(null);
  };

  const handleDelete = (draftId: string) => {
    setDrafts((current) => current.filter((draft) => draft.draftId !== draftId));
    setErrorsByDraft((current) => {
      if (!current[draftId]) return current;
      const { [draftId]: _omitted, ...rest } = current;
      return rest;
    });
    setIsDirty(true);
    setSavedAt(null);
  };

  const handleToggleActive = (draftId: string) => {
    updateDraft(draftId, (draft) => ({ ...draft, isActive: !draft.isActive }));
  };

  const handleAllowQuantityChange = (draftId: string, value: boolean) => {
    updateDraft(draftId, (draft) => ({
      ...draft,
      allowQuantity: value,
      minQuantity: value ? draft.minQuantity || "1" : "1",
      maxQuantity: value ? draft.maxQuantity || "1" : "1",
    }));
  };

  const handleReset = () => {
    setLoading(true);
    setLoadError(null);
    setSaveError(null);
    setSavedAt(null);
    setIsDirty(false);
    setErrorsByDraft({});

    listAdminEventParticipationOptions(eventId)
      .then((options) => {
        setDrafts(options.map(buildDraftFromOption));
      })
      .catch((error) => {
        setLoadError(
          error instanceof Error
            ? error.message
            : "Не удалось перечитать варианты участия.",
        );
      })
      .finally(() => {
        setLoading(false);
      });
  };

  const handleSave = async () => {
    setSaveError(null);
    setSavedAt(null);

    const validations = drafts.map((draft, index) => ({
      draft,
      result: validateDraft(draft, index),
    }));

    const failed = validations.filter((entry) => !entry.result.ok);
    if (failed.length > 0) {
      const nextErrors: Record<string, Partial<Record<keyof DraftOption, string>>> = {};
      for (const entry of failed) {
        if (!entry.result.ok) {
          nextErrors[entry.draft.draftId] = entry.result.errors;
        }
      }
      setErrorsByDraft(nextErrors);
      setSaveError("Исправьте ошибки в вариантах перед сохранением.");
      return;
    }

    const inputs = validations.map((entry) => {
      if (!entry.result.ok) {
        throw new Error("unreachable");
      }
      return entry.result.input;
    });

    setErrorsByDraft({});
    setSaving(true);

    try {
      const saved = await replaceAdminEventParticipationOptions(eventId, inputs);
      setDrafts(saved.map(buildDraftFromOption));
      setIsDirty(false);
      setSavedAt(new Date().toISOString());
    } catch (error) {
      setSaveError(
        error instanceof Error
          ? error.message
          : "Не удалось сохранить варианты участия.",
      );
    } finally {
      setSaving(false);
    }
  };

  const livePreview = useMemo(() => {
    let minSum = 0;
    let maxSum = 0;
    let totalSeatLimit = 0;
    let unlimitedSeats = 0;
    let activeCount = 0;
    let donationCount = 0;
    let currency = fallbackCurrency;

    for (const draft of drafts) {
      if (!draft.isActive) continue;
      activeCount += 1;

      if (draft.priceCurrency.trim()) {
        currency = draft.priceCurrency.trim().toUpperCase();
      }

      const priceParsed = parseInteger(draft.priceAmount);
      const price =
        priceParsed === null || Number.isNaN(priceParsed) || priceParsed < 0
          ? 0
          : priceParsed;

      const minQty = draft.allowQuantity
        ? Math.max(1, parseInteger(draft.minQuantity) ?? 1)
        : 1;
      const maxQty = draft.allowQuantity
        ? Math.max(minQty, parseInteger(draft.maxQuantity) ?? 1)
        : 1;

      if (draft.isDonation) {
        donationCount += 1;
      } else {
        minSum += price * minQty;
        maxSum += price * maxQty;
      }

      if (draft.countsTowardCapacity) {
        const seatLimitParsed = draft.seatLimit.trim()
          ? parseInteger(draft.seatLimit)
          : null;
        if (
          seatLimitParsed !== null &&
          !Number.isNaN(seatLimitParsed) &&
          seatLimitParsed > 0
        ) {
          totalSeatLimit += seatLimitParsed;
        } else {
          unlimitedSeats += 1;
        }
      }
    }

    return {
      activeCount,
      donationCount,
      priceRange: formatPriceRange(minSum, maxSum, currency),
      totalSeatLimit,
      unlimitedSeats,
    };
  }, [drafts, fallbackCurrency]);

  const seatsExceedCapacity =
    typeof eventCapacity === "number" &&
    eventCapacity > 0 &&
    livePreview.unlimitedSeats === 0 &&
    livePreview.totalSeatLimit > eventCapacity;

  return (
    <section className="participation-constructor">
      <header className="participation-constructor__head">
        <div>
          <h2>Варианты участия и оплаты</h2>
          <p>
            Сохранение идёт через RPC admin_replace_event_participation_options и
            полностью заменяет текущий список вариантов события.
          </p>
        </div>
        <div className="participation-constructor__head-actions">
          <Button
            disabled={loading || saving}
            onClick={handleReset}
            variant="ghost"
          >
            Сбросить изменения
          </Button>
          <Button
            disabled={loading || saving}
            onClick={handleAdd}
            variant="secondary"
          >
            Добавить вариант
          </Button>
        </div>
      </header>

      {loadError ? (
        <div className="form-error" role="alert">
          {loadError}
        </div>
      ) : null}

      {saveError ? (
        <div className="form-error" role="alert">
          {saveError}
        </div>
      ) : null}

      <div className="participation-constructor__preview">
        <div>
          <span>Активных вариантов</span>
          <strong>{livePreview.activeCount}</strong>
        </div>
        <div>
          <span>Сумма за регистрацию</span>
          <strong>{livePreview.priceRange}</strong>
        </div>
        <div>
          <span>Лимит мест по вариантам</span>
          <strong>
            {livePreview.totalSeatLimit}
            {livePreview.unlimitedSeats > 0
              ? ` + ${livePreview.unlimitedSeats} без лимита`
              : ""}
          </strong>
        </div>
        {livePreview.donationCount > 0 ? (
          <div>
            <span>Из них donation</span>
            <strong>{livePreview.donationCount}</strong>
          </div>
        ) : null}
        {seatsExceedCapacity ? (
          <div className="participation-constructor__preview-warning">
            Сумма seat_limit ({livePreview.totalSeatLimit}) больше capacity
            события ({eventCapacity}).
          </div>
        ) : null}
      </div>

      {loading ? (
        <p className="participation-constructor__empty">Загрузка вариантов...</p>
      ) : drafts.length === 0 ? (
        <p className="participation-constructor__empty">
          Вариантов пока нет. Нажмите «Добавить вариант», чтобы создать первый.
        </p>
      ) : (
        <ol className="participation-constructor__list">
          {drafts.map((draft, index) => {
            const draftErrors = errorsByDraft[draft.draftId] ?? {};
            return (
              <li
                key={draft.draftId}
                className={`participation-option-card ${
                  draft.isActive ? "" : "participation-option-card--inactive"
                }`}
              >
                <div className="participation-option-card__head">
                  <div className="participation-option-card__title">
                    <span className="participation-option-card__index">
                      #{index + 1}
                    </span>
                    <strong>{draft.title.trim() || "Без названия"}</strong>
                    {!draft.isActive ? <em>скрыт</em> : null}
                  </div>
                  <div className="participation-option-card__actions">
                    <Button
                      onClick={() => handleToggleActive(draft.draftId)}
                      size="sm"
                      variant="ghost"
                    >
                      {draft.isActive ? "Скрыть" : "Показать"}
                    </Button>
                    <Button
                      onClick={() => handleDelete(draft.draftId)}
                      size="sm"
                      variant="ghost"
                    >
                      Удалить
                    </Button>
                  </div>
                </div>

                <div className="event-form-grid event-form-grid--two">
                  <Field
                    error={draftErrors.title}
                    label="Название *"
                    onChange={(value) =>
                      updateDraft(draft.draftId, (current) => ({
                        ...current,
                        title: value,
                      }))
                    }
                    value={draft.title}
                  />
                  <SelectFieldRaw
                    label="Тип"
                    onChange={(value) =>
                      updateDraft(draft.draftId, (current) => ({
                        ...current,
                        optionType: isParticipationOptionType(value)
                          ? value
                          : current.optionType,
                      }))
                    }
                    options={PARTICIPATION_OPTION_TYPES.map((type) => ({
                      label: type,
                      value: type,
                    }))}
                    value={draft.optionType}
                  />
                  <TextAreaFieldRaw
                    label="Описание"
                    onChange={(value) =>
                      updateDraft(draft.draftId, (current) => ({
                        ...current,
                        description: value,
                      }))
                    }
                    value={draft.description}
                  />
                </div>

                <div className="event-form-grid event-form-grid--two">
                  <Field
                    error={draftErrors.priceAmount}
                    label="Цена (целое, в копейках/единицах)"
                    min={0}
                    onChange={(value) =>
                      updateDraft(draft.draftId, (current) => ({
                        ...current,
                        priceAmount: value,
                      }))
                    }
                    type="number"
                    value={draft.priceAmount}
                  />
                  <Field
                    error={draftErrors.priceCurrency}
                    label="Валюта"
                    onChange={(value) =>
                      updateDraft(draft.draftId, (current) => ({
                        ...current,
                        priceCurrency: value,
                      }))
                    }
                    value={draft.priceCurrency}
                  />
                  <Field
                    error={draftErrors.seatLimit}
                    label="Лимит мест (пусто = без лимита)"
                    min={1}
                    onChange={(value) =>
                      updateDraft(draft.draftId, (current) => ({
                        ...current,
                        seatLimit: value,
                      }))
                    }
                    type="number"
                    value={draft.seatLimit}
                  />
                  <Field
                    error={draftErrors.sortOrder}
                    label="Sort order"
                    onChange={(value) =>
                      updateDraft(draft.draftId, (current) => ({
                        ...current,
                        sortOrder: value,
                      }))
                    }
                    type="number"
                    value={draft.sortOrder}
                  />
                </div>

                <div className="event-form-checks">
                  <Check
                    checked={draft.allowQuantity}
                    label="Allow quantity"
                    onChange={(value) =>
                      handleAllowQuantityChange(draft.draftId, value)
                    }
                  />
                  <Check
                    checked={draft.isDonation}
                    label="Is donation"
                    onChange={(value) =>
                      updateDraft(draft.draftId, (current) => ({
                        ...current,
                        isDonation: value,
                      }))
                    }
                  />
                  <Check
                    checked={draft.countsTowardCapacity}
                    label="Counts toward capacity"
                    onChange={(value) =>
                      updateDraft(draft.draftId, (current) => ({
                        ...current,
                        countsTowardCapacity: value,
                      }))
                    }
                  />
                  <Check
                    checked={draft.isActive}
                    label="Активен"
                    onChange={(value) =>
                      updateDraft(draft.draftId, (current) => ({
                        ...current,
                        isActive: value,
                      }))
                    }
                  />
                </div>

                {draft.allowQuantity ? (
                  <div className="event-form-grid event-form-grid--two">
                    <Field
                      error={draftErrors.minQuantity}
                      label="Min quantity"
                      min={1}
                      onChange={(value) =>
                        updateDraft(draft.draftId, (current) => ({
                          ...current,
                          minQuantity: value,
                        }))
                      }
                      type="number"
                      value={draft.minQuantity}
                    />
                    <Field
                      error={draftErrors.maxQuantity}
                      label="Max quantity"
                      min={1}
                      onChange={(value) =>
                        updateDraft(draft.draftId, (current) => ({
                          ...current,
                          maxQuantity: value,
                        }))
                      }
                      type="number"
                      value={draft.maxQuantity}
                    />
                  </div>
                ) : null}

                <div className="event-form-grid event-form-grid--two">
                  <Field
                    label="Group key"
                    onChange={(value) =>
                      updateDraft(draft.draftId, (current) => ({
                        ...current,
                        groupKey: value,
                      }))
                    }
                    placeholder="например, meal-plan"
                    value={draft.groupKey}
                  />
                  <Field
                    label="Conflicts with (UUID списком через запятую)"
                    onChange={(value) =>
                      updateDraft(draft.draftId, (current) => ({
                        ...current,
                        conflictsWith: value,
                      }))
                    }
                    placeholder="uuid-1, uuid-2"
                    value={draft.conflictsWith}
                  />
                </div>
              </li>
            );
          })}
        </ol>
      )}

      <div className="participation-constructor__footer">
        {savedAt ? (
          <span className="participation-constructor__saved">
            Сохранено в {new Date(savedAt).toLocaleTimeString("ru-RU")}
          </span>
        ) : isDirty ? (
          <span className="participation-constructor__dirty">
            Есть несохранённые изменения
          </span>
        ) : null}
        <Button
          disabled={loading || saving || !isDirty}
          onClick={handleSave}
          variant="primary"
        >
          {saving ? "Сохраняем..." : "Сохранить варианты"}
        </Button>
      </div>
    </section>
  );
}

function Field({
  error,
  label,
  onChange,
  value,
  min,
  placeholder,
  type,
}: {
  error?: string;
  label: string;
  onChange: (value: string) => void;
  value: string;
  min?: number;
  placeholder?: string;
  type?: string;
}) {
  return (
    <label className="event-form-field">
      <span>{label}</span>
      <input
        aria-invalid={Boolean(error)}
        min={min}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        type={type}
        value={value}
      />
      {error ? <small>{error}</small> : null}
    </label>
  );
}

function TextAreaFieldRaw({
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
      <textarea
        onChange={(event) => onChange(event.target.value)}
        value={value}
      />
    </label>
  );
}

function SelectFieldRaw({
  label,
  onChange,
  options,
  value,
}: {
  label: string;
  onChange: (value: string) => void;
  options: Array<{ label: string; value: string }>;
  value: string;
}) {
  return (
    <label className="event-form-field">
      <span>{label}</span>
      <select onChange={(event) => onChange(event.target.value)} value={value}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function Check({
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
