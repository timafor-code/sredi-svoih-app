import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";

import { Button } from "../ui/Button";
import { SaveStatusView } from "../ui/SaveStatusView";
import {
  listAdminEventCapacityUnits,
  replaceAdminEventCapacityUnits,
} from "../../services/adminEventCapacityUnitsService";
import type {
  AdminEventCapacityUnit,
  AdminEventCapacityUnitInput,
} from "../../types/eventCapacityUnits";

const CAPACITY_UNITS_UPDATED_EVENT = "admin-event-capacity-units-updated";

type EventCapacityUnitsConstructorProps = {
  eventId: string;
};

type DraftUnit = {
  draftId: string;
  remoteId: string | null;
  key: string;
  title: string;
  description: string;
  capacity: string;
  sortOrder: string;
  isActive: boolean;
};

type DraftUnitErrors = Partial<
  Record<"key" | "title" | "capacity" | "sortOrder", string>
>;

type ValidationResult =
  | { ok: true; inputs: AdminEventCapacityUnitInput[] }
  | { ok: false; errors: Record<string, DraftUnitErrors> };

type SaveStatus = {
  error: string | null;
  savedAt: string | null;
};

type UnitTemplate = {
  key: string;
  title: string;
};

const SHABBAT_UNIT_TEMPLATES: UnitTemplate[] = [
  {
    key: "friday_dinner",
    title: "Пятничная вечерняя трапеза",
  },
  {
    key: "shabbat_lunch",
    title: "Субботняя дневная трапеза",
  },
];

const YOM_TOV_ONE_DAY_UNIT_TEMPLATES: UnitTemplate[] = [
  {
    key: "yomtov_day1_evening",
    title: "Йом Тов — вечерняя трапеза",
  },
  {
    key: "yomtov_day1_lunch",
    title: "Йом Тов — дневная трапеза",
  },
];

const YOM_TOV_TWO_DAYS_UNIT_TEMPLATES: UnitTemplate[] = [
  {
    key: "yomtov_day1_evening",
    title: "Йом Тов день 1 — вечерняя трапеза",
  },
  {
    key: "yomtov_day1_lunch",
    title: "Йом Тов день 1 — дневная трапеза",
  },
  {
    key: "yomtov_day2_evening",
    title: "Йом Тов день 2 — вечерняя трапеза",
  },
  {
    key: "yomtov_day2_lunch",
    title: "Йом Тов день 2 — дневная трапеза",
  },
];

let draftUnitCounter = 0;

function nextDraftId(): string {
  draftUnitCounter += 1;
  return `capacity-unit-${Date.now().toString(36)}-${draftUnitCounter}`;
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

function buildDraftFromUnit(unit: AdminEventCapacityUnit): DraftUnit {
  return {
    draftId: nextDraftId(),
    remoteId: unit.id,
    key: unit.key,
    title: unit.title,
    description: unit.description ?? "",
    capacity: unit.capacity === null ? "" : String(unit.capacity),
    sortOrder: String(unit.sortOrder),
    isActive: unit.isActive,
  };
}

function buildEmptyDraft(index: number): DraftUnit {
  return {
    draftId: nextDraftId(),
    remoteId: null,
    key: "",
    title: "",
    description: "",
    capacity: "",
    sortOrder: String(index),
    isActive: true,
  };
}

function buildTemplateDraft(template: UnitTemplate, index: number): DraftUnit {
  return {
    ...buildEmptyDraft(index),
    key: template.key,
    title: template.title,
  };
}

function withSequentialSortOrder(drafts: DraftUnit[]): DraftUnit[] {
  return drafts.map((draft, index) => ({ ...draft, sortOrder: String(index) }));
}

function validateUnitDrafts(drafts: DraftUnit[]): ValidationResult {
  const errors: Record<string, DraftUnitErrors> = {};
  const seenKeys = new Set<string>();
  const inputs: AdminEventCapacityUnitInput[] = [];

  drafts.forEach((draft, index) => {
    const draftErrors: DraftUnitErrors = {};
    const key = draft.key.trim();
    const title = draft.title.trim();
    const normalizedKey = key.toLowerCase();

    if (!key) {
      draftErrors.key = "Укажите код слота.";
    } else if (seenKeys.has(normalizedKey)) {
      draftErrors.key = "Код слота должен быть уникальным.";
    } else {
      seenKeys.add(normalizedKey);
    }

    if (!title) {
      draftErrors.title = "Укажите название.";
    }

    const capacityParsed = parseInteger(draft.capacity);
    let capacity: number | null = null;
    if (capacityParsed !== null) {
      if (Number.isNaN(capacityParsed) || capacityParsed <= 0) {
        draftErrors.capacity = "Вместимость должна быть целым числом > 0.";
      } else {
        capacity = capacityParsed;
      }
    }

    const sortOrderParsed = parseInteger(draft.sortOrder);
    const sortOrder =
      sortOrderParsed === null || Number.isNaN(sortOrderParsed)
        ? index
        : sortOrderParsed;

    if (
      draft.sortOrder.trim() &&
      (sortOrderParsed === null || Number.isNaN(sortOrderParsed))
    ) {
      draftErrors.sortOrder = "Порядок должен быть целым числом.";
    }

    if (Object.keys(draftErrors).length > 0) {
      errors[draft.draftId] = draftErrors;
      return;
    }

    inputs.push({
      id: draft.remoteId,
      key,
      title,
      description: draft.description.trim() ? draft.description.trim() : null,
      capacity,
      sortOrder,
      isActive: draft.isActive,
    });
  });

  return Object.keys(errors).length > 0 ? { ok: false, errors } : { ok: true, inputs };
}

export function EventCapacityUnitsConstructor({
  eventId,
}: EventCapacityUnitsConstructorProps) {
  const [unitDrafts, setUnitDrafts] = useState<DraftUnit[]>([]);
  const [unitErrors, setUnitErrors] = useState<Record<string, DraftUnitErrors>>({});
  const [savedDraftSnapshot, setSavedDraftSnapshot] = useState("[]");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [savingUnits, setSavingUnits] = useState(false);
  const [unitsStatus, setUnitsStatus] = useState<SaveStatus>({
    error: null,
    savedAt: null,
  });

  useEffect(() => {
    let cancelled = false;

    setLoading(true);
    setLoadError(null);
    setUnitErrors({});
    setUnitsStatus({ error: null, savedAt: null });

    listAdminEventCapacityUnits(eventId)
      .then((units) => {
        if (cancelled) return;

        const drafts = units.map(buildDraftFromUnit);
        setUnitDrafts(drafts);
        setSavedDraftSnapshot(JSON.stringify(drafts));
      })
      .catch((error) => {
        if (cancelled) return;
        setLoadError(
          error instanceof Error
            ? error.message
            : "Не удалось загрузить настройки слотов мест.",
        );
        setUnitDrafts([]);
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [eventId]);

  const currentDraftSnapshot = useMemo(() => JSON.stringify(unitDrafts), [unitDrafts]);
  const hasUnsavedUnits = !loading && !loadError && currentDraftSnapshot !== savedDraftSnapshot;
  const disabled = loading || savingUnits;

  const updateUnitDraft = (
    draftId: string,
    updater: (draft: DraftUnit) => DraftUnit,
  ) => {
    setUnitDrafts((current) =>
      current.map((draft) => (draft.draftId === draftId ? updater(draft) : draft)),
    );
    setUnitErrors((current) => {
      if (!current[draftId]) {
        return current;
      }

      const next = { ...current };
      delete next[draftId];
      return next;
    });
    setUnitsStatus({ error: null, savedAt: null });
  };

  const addUnit = () => {
    setUnitDrafts((current) => [...current, buildEmptyDraft(current.length)]);
    setUnitsStatus({ error: null, savedAt: null });
  };

  const addTemplateUnits = (templates: UnitTemplate[]) => {
    setUnitDrafts((current) => {
      const existingKeys = new Set(
        current.map((unit) => unit.key.trim().toLowerCase()),
      );
      const additions = templates.filter(
        (template) => !existingKeys.has(template.key.toLowerCase()),
      ).map((template, offset) =>
        buildTemplateDraft(template, current.length + offset),
      );

      return additions.length > 0 ? [...current, ...additions] : current;
    });
    setUnitsStatus({ error: null, savedAt: null });
  };

  const addShabbatTemplate = () => {
    addTemplateUnits(SHABBAT_UNIT_TEMPLATES);
  };

  const addYomTovOneDayTemplate = () => {
    addTemplateUnits(YOM_TOV_ONE_DAY_UNIT_TEMPLATES);
  };

  const addYomTovTwoDaysTemplate = () => {
    addTemplateUnits(YOM_TOV_TWO_DAYS_UNIT_TEMPLATES);
  };

  const deleteUnit = (draftId: string) => {
    setUnitDrafts((current) =>
      withSequentialSortOrder(current.filter((unit) => unit.draftId !== draftId)),
    );
    setUnitErrors((current) => {
      const next = { ...current };
      delete next[draftId];
      return next;
    });
    setUnitsStatus({ error: null, savedAt: null });
  };

  const saveUnits = async () => {
    if (disabled) return;

    setUnitsStatus({ error: null, savedAt: null });
    setUnitErrors({});

    const validation = validateUnitDrafts(unitDrafts);
    if (!validation.ok) {
      setUnitErrors(validation.errors);
      setUnitsStatus({
        error: "Проверьте поля слотов мест перед сохранением.",
        savedAt: null,
      });
      return;
    }

    setSavingUnits(true);
    try {
      await replaceAdminEventCapacityUnits(eventId, validation.inputs);
      const nextUnits = await listAdminEventCapacityUnits(eventId);
      const savedDrafts = nextUnits.map(buildDraftFromUnit);
      setUnitDrafts(savedDrafts);
      setSavedDraftSnapshot(JSON.stringify(savedDrafts));
      window.dispatchEvent(
        new CustomEvent(CAPACITY_UNITS_UPDATED_EVENT, {
          detail: { eventId },
        }),
      );
      setUnitsStatus({ error: null, savedAt: new Date().toISOString() });
    } catch (error) {
      setUnitsStatus({
        error:
          error instanceof Error
            ? error.message
            : "Не удалось сохранить слоты мест.",
        savedAt: null,
      });
    } finally {
      setSavingUnits(false);
    }
  };

  return (
    <section className="capacity-units-constructor">
      <header className="capacity-units-constructor__head">
        <div>
          <h2>Слоты мест для вариантов участия</h2>
          <p>
            После сохранения слотов они появятся в окне создания/редактирования
            вариантов участия.
          </p>
        </div>
        <div className="capacity-units-constructor__head-actions">
          <Button disabled={disabled} onClick={addShabbatTemplate} size="sm" variant="gold">
            + Шабат
          </Button>
          <Button disabled={disabled} onClick={addYomTovOneDayTemplate} size="sm" variant="gold">
            + Йом Тов 1 день
          </Button>
          <Button disabled={disabled} onClick={addYomTovTwoDaysTemplate} size="sm" variant="gold">
            + Йом Тов 2 дня
          </Button>
          <Button disabled={disabled} onClick={addUnit} size="sm" variant="gold">
            + Слот
          </Button>
        </div>
      </header>

      {loadError ? (
        <div className="form-error" role="alert">
          {loadError}
        </div>
      ) : null}

      <div className="capacity-units-constructor__layout">
        <section className="capacity-units-panel">
          <div className="capacity-units-panel__head">
            <span>Слоты мест</span>
          </div>

          {loading ? (
            <p className="capacity-units-empty">Загружаем слоты мест...</p>
          ) : unitDrafts.length === 0 ? (
            <p className="capacity-units-empty">Сначала добавьте слоты мест</p>
          ) : (
            <ul className="capacity-unit-rows">
              {unitDrafts.map((unit) => (
                <CapacityUnitRow
                  disabled={disabled}
                  errors={unitErrors[unit.draftId] ?? {}}
                  key={unit.draftId}
                  onDelete={() => deleteUnit(unit.draftId)}
                  onUpdate={(updater) => updateUnitDraft(unit.draftId, updater)}
                  unit={unit}
                />
              ))}
            </ul>
          )}

          <footer className="capacity-units-footer">
            <Button disabled={disabled} onClick={saveUnits} variant="success">
              {savingUnits ? "Сохраняем…" : "Сохранить слоты"}
            </Button>
            <SaveStatusView
              error={unitsStatus.error}
              savedAt={unitsStatus.savedAt}
              saving={savingUnits}
              unsaved={hasUnsavedUnits}
              recovery="Проверьте поля и повторите сохранение."
            />
          </footer>
        </section>
      </div>
    </section>
  );
}

function CapacityUnitRow({
  disabled,
  errors,
  onDelete,
  onUpdate,
  unit,
}: {
  disabled: boolean;
  errors: DraftUnitErrors;
  onDelete: () => void;
  onUpdate: (updater: (unit: DraftUnit) => DraftUnit) => void;
  unit: DraftUnit;
}) {
  return (
    <li
      className={`capacity-unit-row${unit.isActive ? "" : " capacity-unit-row--inactive"}`}
    >
      <UnitField error={errors.key} label="Код слота">
        <input
          disabled={disabled}
          onChange={(event) =>
            onUpdate((current) => ({ ...current, key: event.target.value }))
          }
          placeholder="friday_dinner"
          type="text"
          value={unit.key}
        />
      </UnitField>
      <UnitField error={errors.title} label="Название">
        <input
          disabled={disabled}
          onChange={(event) =>
            onUpdate((current) => ({ ...current, title: event.target.value }))
          }
          placeholder="Пятничная вечерняя трапеза"
          type="text"
          value={unit.title}
        />
      </UnitField>
      <UnitField error={errors.capacity} label="Мест">
        <input
          disabled={disabled}
          min={1}
          onChange={(event) =>
            onUpdate((current) => ({ ...current, capacity: event.target.value }))
          }
          placeholder="без лимита"
          type="number"
          value={unit.capacity}
        />
      </UnitField>
      <UnitField error={errors.sortOrder} label="Порядок">
        <input
          disabled={disabled}
          onChange={(event) =>
            onUpdate((current) => ({ ...current, sortOrder: event.target.value }))
          }
          type="number"
          value={unit.sortOrder}
        />
      </UnitField>
      <UnitField label="Описание">
        <input
          disabled={disabled}
          onChange={(event) =>
            onUpdate((current) => ({ ...current, description: event.target.value }))
          }
          placeholder="необязательно"
          type="text"
          value={unit.description}
        />
      </UnitField>
      <div className="capacity-unit-row__actions">
        <label className="capacity-unit-row__toggle">
          <input
            checked={unit.isActive}
            disabled={disabled}
            onChange={(event) =>
              onUpdate((current) => ({ ...current, isActive: event.target.checked }))
            }
            type="checkbox"
          />
          <span>{unit.isActive ? "Активен" : "Неактивен"}</span>
        </label>
        <Button
          variant="destructive"
          size="sm"
          aria-label="Удалить слот"
          className="capacity-unit-row__delete"
          disabled={disabled}
          onClick={onDelete}
          title="Удалить"
          type="button"
        >
          ✕
        </Button>
      </div>
    </li>
  );
}

function UnitField({
  children,
  error,
  label,
}: {
  children: ReactNode;
  error?: string;
  label: string;
}) {
  return (
    <label className="capacity-unit-field">
      <span>{label}</span>
      {children}
      {error ? <small>{error}</small> : null}
    </label>
  );
}
