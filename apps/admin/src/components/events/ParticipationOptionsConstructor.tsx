import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

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

const TYPE_LABELS: Record<ParticipationOptionType, string> = {
  participation: "Участие",
  meal: "Трапеза",
  package: "Пакет",
  donation: "Пожертвование",
  child: "Детский",
  family: "Семейный",
  other: "Другое",
};

const CURRENCY_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "RUB", label: "₽ RUB" },
  { value: "USD", label: "$ USD" },
  { value: "EUR", label: "€ EUR" },
  { value: "ILS", label: "₪ ILS" },
];

const CURRENCY_SYMBOLS: Record<string, string> = {
  RUB: "₽",
  USD: "$",
  EUR: "€",
  ILS: "₪",
};

function currencySymbol(currency: string): string {
  return CURRENCY_SYMBOLS[currency.toUpperCase()] ?? currency.toUpperCase();
}

function formatPrice(amount: number, currency: string): string {
  return `${amount.toLocaleString("ru-RU")} ${currencySymbol(currency)}`;
}

function typeLabelFor(value: string): string {
  if (isParticipationOptionType(value)) {
    return TYPE_LABELS[value];
  }
  return value;
}

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

type DraftErrors = Partial<Record<keyof DraftOption, string>>;

type ModalState =
  | { kind: "closed" }
  | { kind: "add"; form: DraftOption; errors: DraftErrors }
  | {
      kind: "edit";
      draftId: string;
      form: DraftOption;
      errors: DraftErrors;
    };

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

function buildEmptyDraft(index: number, currency: string): DraftOption {
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

type DraftValidation =
  | { ok: true; input: ParticipationOptionInput }
  | { ok: false; errors: DraftErrors };

function validateDraft(draft: DraftOption, fallbackIndex: number): DraftValidation {
  const errors: DraftErrors = {};

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

  if (
    draft.sortOrder.trim() &&
    (sortOrderParsed === null || Number.isNaN(sortOrderParsed))
  ) {
    errors.sortOrder = "Порядок должен быть целым числом.";
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
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const [modalState, setModalState] = useState<ModalState>({ kind: "closed" });

  const loadOptions = (markClean: boolean) => {
    setLoading(true);
    setLoadError(null);
    setSaveError(null);
    setSavedAt(null);
    if (markClean) {
      setIsDirty(false);
    }

    let cancelled = false;
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
  };

  useEffect(() => {
    return loadOptions(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId]);

  const markDirty = () => {
    setIsDirty(true);
    setSavedAt(null);
  };

  const handleToggleActive = (draftId: string) => {
    setDrafts((current) =>
      current.map((draft) =>
        draft.draftId === draftId ? { ...draft, isActive: !draft.isActive } : draft,
      ),
    );
    markDirty();
  };

  const handleDelete = (draftId: string) => {
    setDrafts((current) => current.filter((draft) => draft.draftId !== draftId));
    markDirty();
  };

  const openAddModal = () => {
    setModalState({
      kind: "add",
      form: buildEmptyDraft(drafts.length, fallbackCurrency),
      errors: {},
    });
  };

  const openEditModal = (draftId: string) => {
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

  const updateModalForm = (updater: (form: DraftOption) => DraftOption) => {
    setModalState((current) => {
      if (current.kind === "closed") return current;
      return { ...current, form: updater(current.form), errors: {} };
    });
  };

  const submitModal = () => {
    if (modalState.kind === "closed") return;
    const fallbackIndex =
      modalState.kind === "edit"
        ? drafts.findIndex((d) => d.draftId === modalState.draftId)
        : drafts.length;
    const result = validateDraft(modalState.form, fallbackIndex);
    if (!result.ok) {
      setModalState({ ...modalState, errors: result.errors });
      return;
    }

    if (modalState.kind === "add") {
      setDrafts((current) => [...current, modalState.form]);
    } else {
      const targetId = modalState.draftId;
      setDrafts((current) =>
        current.map((draft) =>
          draft.draftId === targetId ? { ...modalState.form, draftId: targetId } : draft,
        ),
      );
    }

    markDirty();
    closeModal();
  };

  const handleReset = () => {
    loadOptions(true);
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
      setSaveError(
        "В одном из вариантов есть ошибки. Откройте вариант и исправьте поля.",
      );
      return;
    }

    const inputs = validations.map((entry) => {
      if (!entry.result.ok) {
        throw new Error("unreachable");
      }
      return entry.result.input;
    });

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

  const summary = useMemo(() => {
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
      minSum,
      maxSum,
      currency,
      totalSeatLimit,
      unlimitedSeats,
    };
  }, [drafts, fallbackCurrency]);

  const seatsExceedCapacity =
    typeof eventCapacity === "number" &&
    eventCapacity > 0 &&
    summary.unlimitedSeats === 0 &&
    summary.totalSeatLimit > eventCapacity;

  return (
    <section className="participation-constructor">
      <header className="participation-constructor__head">
        <div>
          <h2>Варианты участия и оплаты</h2>
          <p>Настройте, что пользователь сможет выбрать при записи на событие.</p>
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

      <div className="participation-constructor__layout">
        <div className="participation-constructor__main">
          <div className="participation-constructor__list-label">Варианты</div>

          {loading ? (
            <p className="participation-constructor__empty">
              Загрузка вариантов...
            </p>
          ) : drafts.length === 0 ? (
            <p className="participation-constructor__empty">
              Нет вариантов. Нажмите «+ Добавить вариант», чтобы создать первый.
            </p>
          ) : (
            <ul className="participation-option-rows">
              {drafts.map((draft) => (
                <OptionRow
                  draft={draft}
                  key={draft.draftId}
                  onDelete={() => handleDelete(draft.draftId)}
                  onEdit={() => openEditModal(draft.draftId)}
                  onToggleActive={() => handleToggleActive(draft.draftId)}
                />
              ))}
            </ul>
          )}

          <button
            className="participation-add-option-btn"
            disabled={loading}
            onClick={openAddModal}
            type="button"
          >
            + Добавить вариант
          </button>
        </div>

        <aside className="participation-preview-panel">
          <header>
            <span aria-hidden>◎</span>
            <span>Предпросмотр для пользователя</span>
          </header>
          <div className="participation-preview-panel__body">
            <PreviewPanel
              capacityWarning={
                seatsExceedCapacity && typeof eventCapacity === "number"
                  ? `Сумма seat_limit (${summary.totalSeatLimit}) больше capacity события (${eventCapacity}).`
                  : null
              }
              drafts={drafts}
              summary={summary}
            />
          </div>
        </aside>
      </div>

      <footer className="participation-constructor__footer">
        <div className="participation-constructor__footer-status">
          {savedAt ? (
            <span className="participation-constructor__saved">
              Сохранено в {new Date(savedAt).toLocaleTimeString("ru-RU")}
            </span>
          ) : isDirty ? (
            <span className="participation-constructor__dirty">
              Есть несохранённые изменения
            </span>
          ) : null}
        </div>
        <div className="participation-constructor__footer-actions">
          <Button
            disabled={loading || saving || !isDirty}
            onClick={handleReset}
            variant="ghost"
          >
            Сбросить изменения
          </Button>
          <Button
            disabled={loading || saving || !isDirty}
            onClick={handleSave}
            variant="primary"
          >
            {saving ? "Сохраняем..." : "Сохранить варианты"}
          </Button>
        </div>
      </footer>

      {modalState.kind !== "closed"
        ? createPortal(
            <OptionModal
              onChange={updateModalForm}
              onClose={closeModal}
              onSubmit={submitModal}
              state={modalState}
            />,
            document.body,
          )
        : null}
    </section>
  );
}

type OptionRowProps = {
  draft: DraftOption;
  onDelete: () => void;
  onEdit: () => void;
  onToggleActive: () => void;
};

function OptionRow({ draft, onDelete, onEdit, onToggleActive }: OptionRowProps) {
  const priceParsed = parseInteger(draft.priceAmount);
  const price =
    priceParsed === null || Number.isNaN(priceParsed) || priceParsed < 0
      ? 0
      : priceParsed;
  const typeKey = isParticipationOptionType(draft.optionType)
    ? draft.optionType
    : "other";
  const title = draft.title.trim() || "Без названия";
  const description = draft.description.trim();

  return (
    <li
      className={`participation-option-row${draft.isActive ? "" : " participation-option-row--inactive"}`}
    >
      <span aria-hidden className="participation-option-row__handle">
        ⠿
      </span>
      <span
        className={`participation-option-row__badge participation-option-row__badge--${typeKey}`}
      >
        {typeLabelFor(draft.optionType)}
      </span>
      <div className="participation-option-row__title">
        <strong>{title}</strong>
        {description ? <span>{description}</span> : null}
      </div>
      <span className="participation-option-row__price">
        {formatPrice(price, draft.priceCurrency || DEFAULT_PRICE_CURRENCY)}
      </span>
      <div className="participation-option-row__actions">
        <button
          aria-label="Редактировать вариант"
          className="participation-option-row__action"
          onClick={onEdit}
          title="Редактировать"
          type="button"
        >
          ✎
        </button>
        <button
          aria-label={draft.isActive ? "Скрыть вариант" : "Показать вариант"}
          className="participation-option-row__action"
          onClick={onToggleActive}
          title={draft.isActive ? "Скрыть" : "Показать"}
          type="button"
        >
          {draft.isActive ? "◎" : "◉"}
        </button>
        <button
          aria-label="Удалить вариант"
          className="participation-option-row__action participation-option-row__action--danger"
          onClick={onDelete}
          title="Удалить"
          type="button"
        >
          ✕
        </button>
      </div>
    </li>
  );
}

type SummaryShape = {
  activeCount: number;
  donationCount: number;
  minSum: number;
  maxSum: number;
  currency: string;
  totalSeatLimit: number;
  unlimitedSeats: number;
};

type PreviewPanelProps = {
  capacityWarning: string | null;
  drafts: DraftOption[];
  summary: SummaryShape;
};

function PreviewPanel({ capacityWarning, drafts, summary }: PreviewPanelProps) {
  const activeDrafts = drafts.filter((draft) => draft.isActive);
  const inactiveDrafts = drafts.filter((draft) => !draft.isActive);

  if (activeDrafts.length === 0 && inactiveDrafts.length === 0) {
    return (
      <p className="participation-preview-panel__empty">Нет активных вариантов</p>
    );
  }

  const totalLabel =
    summary.minSum === summary.maxSum
      ? formatPrice(summary.minSum, summary.currency)
      : `${formatPrice(summary.minSum, summary.currency)} – ${formatPrice(
          summary.maxSum,
          summary.currency,
        )}`;

  return (
    <>
      {activeDrafts.length === 0 ? (
        <p className="participation-preview-panel__empty">Нет активных вариантов</p>
      ) : (
        <ul className="participation-preview-list">
          {activeDrafts.map((draft) => (
            <PreviewRow draft={draft} key={draft.draftId} />
          ))}
        </ul>
      )}

      {activeDrafts.length > 0 ? (
        <div className="participation-preview-total">
          <span>Итого</span>
          <strong>{totalLabel}</strong>
        </div>
      ) : null}

      {activeDrafts.length > 0 ? (
        <div className="participation-preview-meta">
          <span>
            Мест:{" "}
            <strong>
              {summary.totalSeatLimit}
              {summary.unlimitedSeats > 0
                ? ` + ${summary.unlimitedSeats} без лимита`
                : ""}
            </strong>
          </span>
          {summary.donationCount > 0 ? (
            <span>
              Donation: <strong>{summary.donationCount}</strong>
            </span>
          ) : null}
        </div>
      ) : null}

      {capacityWarning ? (
        <div className="participation-preview-warning">{capacityWarning}</div>
      ) : null}

      {inactiveDrafts.length > 0 ? (
        <div className="participation-preview-inactive">
          <div className="participation-preview-inactive__label">Скрытые</div>
          <ul className="participation-preview-list participation-preview-list--inactive">
            {inactiveDrafts.map((draft) => (
              <PreviewRow draft={draft} key={draft.draftId} />
            ))}
          </ul>
        </div>
      ) : null}
    </>
  );
}

function PreviewRow({ draft }: { draft: DraftOption }) {
  const priceParsed = parseInteger(draft.priceAmount);
  const price =
    priceParsed === null || Number.isNaN(priceParsed) || priceParsed < 0
      ? 0
      : priceParsed;
  const description = draft.description.trim();

  return (
    <li className="participation-preview-row">
      <div className="participation-preview-row__body">
        <div className="participation-preview-row__title">
          {draft.title.trim() || "Без названия"}
        </div>
        {description ? (
          <div className="participation-preview-row__desc">{description}</div>
        ) : null}
        {draft.isDonation ? (
          <div className="participation-preview-row__hint participation-preview-row__hint--donation">
            ♡ Благотворительный взнос
          </div>
        ) : null}
        {!draft.countsTowardCapacity ? (
          <div className="participation-preview-row__hint participation-preview-row__hint--info">
            Не занимает место
          </div>
        ) : null}
      </div>
      <div className="participation-preview-row__price">
        {formatPrice(price, draft.priceCurrency || DEFAULT_PRICE_CURRENCY)}
      </div>
    </li>
  );
}

type OptionModalProps = {
  onChange: (updater: (form: DraftOption) => DraftOption) => void;
  onClose: () => void;
  onSubmit: () => void;
  state: Exclude<ModalState, { kind: "closed" }>;
};

function OptionModal({ onChange, onClose, onSubmit, state }: OptionModalProps) {
  const { form, errors } = state;

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const isEdit = state.kind === "edit";
  const title = isEdit ? "Редактировать вариант участия" : "Новый вариант участия";
  const submitLabel = isEdit ? "Сохранить" : "Добавить";

  return (
    <div
      className="participation-modal-overlay"
      onClick={onClose}
      role="presentation"
    >
      <div
        aria-modal="true"
        className="participation-modal"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
      >
        <header className="participation-modal__head">
          <h3>{title}</h3>
          <button
            aria-label="Закрыть"
            className="participation-modal__close"
            onClick={onClose}
            type="button"
          >
            ✕
          </button>
        </header>

        <div className="participation-modal__body">
          <div className="participation-modal__grid participation-modal__grid--two">
            <ModalField error={errors.title} label="Название *">
              <input
                onChange={(event) =>
                  onChange((current) => ({ ...current, title: event.target.value }))
                }
                placeholder="Название варианта..."
                type="text"
                value={form.title}
              />
            </ModalField>
            <ModalField label="Описание">
              <input
                onChange={(event) =>
                  onChange((current) => ({
                    ...current,
                    description: event.target.value,
                  }))
                }
                placeholder="Краткое описание..."
                type="text"
                value={form.description}
              />
            </ModalField>
          </div>

          <div className="participation-modal__grid participation-modal__grid--three">
            <ModalField error={errors.priceAmount} label="Цена *">
              <input
                min={0}
                onChange={(event) =>
                  onChange((current) => ({
                    ...current,
                    priceAmount: event.target.value,
                  }))
                }
                placeholder="0"
                type="number"
                value={form.priceAmount}
              />
            </ModalField>
            <ModalField error={errors.priceCurrency} label="Валюта">
              <select
                onChange={(event) =>
                  onChange((current) => ({
                    ...current,
                    priceCurrency: event.target.value,
                  }))
                }
                value={form.priceCurrency}
              >
                {CURRENCY_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
                {!CURRENCY_OPTIONS.some(
                  (option) => option.value === form.priceCurrency,
                ) && form.priceCurrency ? (
                  <option value={form.priceCurrency}>{form.priceCurrency}</option>
                ) : null}
              </select>
            </ModalField>
            <ModalField label="Тип">
              <select
                onChange={(event) =>
                  onChange((current) => ({
                    ...current,
                    optionType: isParticipationOptionType(event.target.value)
                      ? event.target.value
                      : current.optionType,
                  }))
                }
                value={form.optionType}
              >
                {PARTICIPATION_OPTION_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {TYPE_LABELS[type]}
                  </option>
                ))}
              </select>
            </ModalField>
          </div>

          <div className="participation-modal__grid participation-modal__grid--two">
            <ModalField error={errors.seatLimit} label="Лимит мест (необязательно)">
              <input
                min={1}
                onChange={(event) =>
                  onChange((current) => ({
                    ...current,
                    seatLimit: event.target.value,
                  }))
                }
                placeholder="Без лимита"
                type="number"
                value={form.seatLimit}
              />
            </ModalField>
            <ModalToggle
              checked={form.allowQuantity}
              label="Разрешить количество"
              onChange={(value) =>
                onChange((current) => ({
                  ...current,
                  allowQuantity: value,
                  minQuantity: value ? current.minQuantity || "1" : "1",
                  maxQuantity: value ? current.maxQuantity || "1" : "1",
                }))
              }
            />
          </div>

          {form.allowQuantity ? (
            <div className="participation-modal__grid participation-modal__grid--two">
              <ModalField error={errors.minQuantity} label="Мин. количество">
                <input
                  min={1}
                  onChange={(event) =>
                    onChange((current) => ({
                      ...current,
                      minQuantity: event.target.value,
                    }))
                  }
                  type="number"
                  value={form.minQuantity}
                />
              </ModalField>
              <ModalField error={errors.maxQuantity} label="Макс. количество">
                <input
                  min={1}
                  onChange={(event) =>
                    onChange((current) => ({
                      ...current,
                      maxQuantity: event.target.value,
                    }))
                  }
                  type="number"
                  value={form.maxQuantity}
                />
              </ModalField>
            </div>
          ) : null}

          <div className="participation-modal__toggles">
            <ModalToggle
              checked={form.isDonation}
              label="Благотворительный вариант"
              onChange={(value) =>
                onChange((current) => ({ ...current, isDonation: value }))
              }
            />
            <ModalToggle
              checked={form.countsTowardCapacity}
              label="Занимает место"
              onChange={(value) =>
                onChange((current) => ({
                  ...current,
                  countsTowardCapacity: value,
                }))
              }
            />
            <ModalToggle
              checked={form.isActive}
              label="Активен"
              onChange={(value) =>
                onChange((current) => ({ ...current, isActive: value }))
              }
            />
          </div>

          <details className="participation-modal__advanced">
            <summary>Дополнительные параметры</summary>
            <div className="participation-modal__grid participation-modal__grid--two">
              <ModalField label="Group key">
                <input
                  onChange={(event) =>
                    onChange((current) => ({
                      ...current,
                      groupKey: event.target.value,
                    }))
                  }
                  placeholder="например, meal-plan"
                  type="text"
                  value={form.groupKey}
                />
              </ModalField>
              <ModalField error={errors.sortOrder} label="Порядок сортировки">
                <input
                  onChange={(event) =>
                    onChange((current) => ({
                      ...current,
                      sortOrder: event.target.value,
                    }))
                  }
                  type="number"
                  value={form.sortOrder}
                />
              </ModalField>
              <ModalField label="Conflicts with (UUID через запятую)">
                <input
                  onChange={(event) =>
                    onChange((current) => ({
                      ...current,
                      conflictsWith: event.target.value,
                    }))
                  }
                  placeholder="uuid-1, uuid-2"
                  type="text"
                  value={form.conflictsWith}
                />
              </ModalField>
            </div>
          </details>
        </div>

        <footer className="participation-modal__footer">
          <Button onClick={onClose} variant="ghost">
            Отмена
          </Button>
          <Button onClick={onSubmit} variant="primary">
            {submitLabel}
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
  children: React.ReactNode;
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
