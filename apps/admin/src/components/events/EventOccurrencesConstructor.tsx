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

type EventOccurrencesConstructorProps = {
  defaultTimezone?: string | null;
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

function withSequentialSortOrder(drafts: DraftOccurrence[]): DraftOccurrence[] {
  return drafts.map((draft, index) => ({ ...draft, sortOrder: String(index) }));
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

export function EventOccurrencesConstructor({
  defaultTimezone,
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
  const saveInFlightRef = useRef(false);

  useEffect(() => {
    let cancelled = false;

    setLoading(true);
    setLoadError(null);
    setSaveError(null);
    setSavedAt(null);

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

  const summary = useMemo(() => buildSummary(drafts, eventCapacity), [
    drafts,
    eventCapacity,
  ]);

  const persistDrafts = async (nextDrafts: DraftOccurrence[]) => {
    setSaveError(null);
    setSavedAt(null);

    const { inputs, hasErrors } = buildInputList(nextDrafts);
    if (hasErrors) {
      setSaveError(
        "В одной из дат есть ошибки. Откройте дату и исправьте поля.",
      );
      return;
    }

    saveInFlightRef.current = true;
    setSaving(true);

    try {
      const saved = await replaceAdminEventOccurrences(eventId, inputs);
      setDrafts(sortDrafts(saved.map(buildDraftFromOccurrence)));
      setSaveError(null);
      setSavedAt(new Date().toISOString());
    } catch (error) {
      setSaveError(
        error instanceof Error
          ? error.message
          : "Не удалось сохранить даты и сеансы события.",
      );
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

  const disabled = loading || saving || Boolean(loadError);

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
        <Button disabled={disabled} onClick={openAddModal} variant="secondary">
          + Добавить дату
        </Button>
      </header>

      <div className="event-occurrences-constructor__hint">
        Если лимит даты пустой, она наследует общий capacity события.
      </div>

      {loadError ? (
        <div className="form-error" role="alert">
          {loadError}
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
            <ul className="event-occurrence-rows">
              {drafts.map((draft, index) => (
                <OccurrenceRow
                  disabled={disabled}
                  draft={draft}
                  index={index}
                  key={draft.draftId}
                  onDelete={() => handleDelete(draft.draftId)}
                  onEdit={() => openEditModal(draft.draftId)}
                  onMoveDown={() => handleMove(draft.draftId, 1)}
                  onMoveUp={() => handleMove(draft.draftId, -1)}
                  onStatusChange={(status) =>
                    handleStatusChange(draft.draftId, status)
                  }
                  total={drafts.length}
                />
              ))}
            </ul>
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
    </section>
  );
}

function OccurrenceRow({
  disabled,
  draft,
  index,
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

  return (
    <li
      className={`event-occurrence-row event-occurrence-row--${draft.status}`}
    >
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
    </li>
  );
}

type Summary = {
  activeCount: number;
  capacityText: string;
  hasClosedRegistration: boolean;
  nextActiveLabel: string;
};

function buildSummary(
  drafts: DraftOccurrence[],
  eventCapacity: number | null,
): Summary {
  const now = Date.now();
  const activeDrafts = drafts.filter((draft) => draft.status === "active");
  const futureActiveDrafts = activeDrafts
    .map((draft) => ({ draft, timestamp: draftStartTimestamp(draft) }))
    .filter((entry) => entry.timestamp >= now)
    .sort((left, right) => left.timestamp - right.timestamp);
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
    activeCount: activeDrafts.length,
    capacityText,
    hasClosedRegistration,
    nextActiveLabel: futureActiveDrafts[0]
      ? formatDraftDateTime(futureActiveDrafts[0].draft)
      : "Нет будущих активных дат",
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
          <dt>Активных дат</dt>
          <dd>{summary.activeCount}</dd>
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
            <ModalField error={errors.timezone} label="Timezone">
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
            <ModalField error={errors.status} label="Status">
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
              label="Waitlist enabled"
              onChange={(value) =>
                onChange((current) => ({ ...current, waitlistEnabled: value }))
              }
            />
            <ModalToggle
              checked={form.requiresApproval}
              label="Requires approval"
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
