import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";

import { Button } from "../ui/Button";
import {
  listAdminEventCapacityUnits,
  listAdminOptionCapacityUnitMappings,
  replaceAdminEventCapacityUnits,
  replaceAdminOptionCapacityUnitMappings,
} from "../../services/adminEventCapacityUnitsService";
import { listAdminEventParticipationOptions } from "../../services/adminParticipationOptionsService";
import type {
  AdminEventCapacityUnit,
  AdminEventCapacityUnitInput,
  AdminOptionCapacityUnitMappingInput,
} from "../../types/eventCapacityUnits";
import type { ParticipationOption } from "../../types/participationOptions";

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

const SHABBAT_UNIT_TEMPLATES = [
  {
    key: "friday_dinner",
    title: "Пятничная вечерняя трапеза",
  },
  {
    key: "shabbat_lunch",
    title: "Субботняя дневная трапеза",
  },
] as const;

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

function buildTemplateDraft(
  template: (typeof SHABBAT_UNIT_TEMPLATES)[number],
  index: number,
): DraftUnit {
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
      draftErrors.key = "Укажите key.";
    } else if (seenKeys.has(normalizedKey)) {
      draftErrors.key = "Key должен быть уникальным.";
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

function mappingKey(optionId: string, unitId: string): string {
  return `${optionId}:${unitId}`;
}

function isOptionDisabledForMapping(option: ParticipationOption): boolean {
  return option.isDonation || !option.countsTowardCapacity;
}

function optionTypeLabel(option: ParticipationOption): string {
  if (option.isDonation) {
    return "Пожертвование";
  }

  if (option.optionType === "meal") {
    return "Трапеза";
  }

  if (option.optionType === "package") {
    return "Пакет";
  }

  return "Участие";
}

export function EventCapacityUnitsConstructor({
  eventId,
}: EventCapacityUnitsConstructorProps) {
  const [unitDrafts, setUnitDrafts] = useState<DraftUnit[]>([]);
  const [unitErrors, setUnitErrors] = useState<Record<string, DraftUnitErrors>>({});
  const [participationOptions, setParticipationOptions] = useState<
    ParticipationOption[]
  >([]);
  const [selectedMappingKeys, setSelectedMappingKeys] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [savingUnits, setSavingUnits] = useState(false);
  const [savingMappings, setSavingMappings] = useState(false);
  const [unitsStatus, setUnitsStatus] = useState<SaveStatus>({
    error: null,
    savedAt: null,
  });
  const [mappingsStatus, setMappingsStatus] = useState<SaveStatus>({
    error: null,
    savedAt: null,
  });

  useEffect(() => {
    let cancelled = false;

    setLoading(true);
    setLoadError(null);
    setUnitErrors({});
    setUnitsStatus({ error: null, savedAt: null });
    setMappingsStatus({ error: null, savedAt: null });

    Promise.all([
      listAdminEventCapacityUnits(eventId),
      listAdminEventParticipationOptions(eventId),
      listAdminOptionCapacityUnitMappings(eventId),
    ])
      .then(([units, options, mappings]) => {
        if (cancelled) return;

        setUnitDrafts(units.map(buildDraftFromUnit));
        setParticipationOptions(options);
        setSelectedMappingKeys(
          mappings.map((mapping) =>
            mappingKey(mapping.optionId, mapping.capacityUnitId),
          ),
        );
      })
      .catch((error) => {
        if (cancelled) return;
        setLoadError(
          error instanceof Error
            ? error.message
            : "Не удалось загрузить настройки capacity units.",
        );
        setUnitDrafts([]);
        setParticipationOptions([]);
        setSelectedMappingKeys([]);
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [eventId]);

  const selectedMappingKeySet = useMemo(
    () => new Set(selectedMappingKeys),
    [selectedMappingKeys],
  );

  const persistedActiveUnits = useMemo(
    () =>
      unitDrafts
        .filter((unit) => unit.remoteId && unit.isActive)
        .sort((a, b) => {
          const left = parseInteger(a.sortOrder);
          const right = parseInteger(b.sortOrder);
          return (left ?? 0) - (right ?? 0);
        }),
    [unitDrafts],
  );

  const hasUnsavedUnits = unitDrafts.some((unit) => !unit.remoteId);
  const disabled = loading || savingUnits || savingMappings;

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

  const addShabbatTemplate = () => {
    setUnitDrafts((current) => {
      const existingKeys = new Set(current.map((unit) => unit.key.trim()));
      const additions = SHABBAT_UNIT_TEMPLATES.filter(
        (template) => !existingKeys.has(template.key),
      ).map((template, offset) =>
        buildTemplateDraft(template, current.length + offset),
      );

      return additions.length > 0 ? [...current, ...additions] : current;
    });
    setUnitsStatus({ error: null, savedAt: null });
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
        error: "Проверьте поля capacity units перед сохранением.",
        savedAt: null,
      });
      return;
    }

    setSavingUnits(true);
    try {
      await replaceAdminEventCapacityUnits(eventId, validation.inputs);
      const [nextUnits, nextMappings] = await Promise.all([
        listAdminEventCapacityUnits(eventId),
        listAdminOptionCapacityUnitMappings(eventId),
      ]);
      setUnitDrafts(nextUnits.map(buildDraftFromUnit));
      setSelectedMappingKeys(
        nextMappings.map((mapping) =>
          mappingKey(mapping.optionId, mapping.capacityUnitId),
        ),
      );
      setUnitsStatus({ error: null, savedAt: new Date().toISOString() });
    } catch (error) {
      setUnitsStatus({
        error:
          error instanceof Error
            ? error.message
            : "Не удалось сохранить capacity units.",
        savedAt: null,
      });
    } finally {
      setSavingUnits(false);
    }
  };

  const toggleMapping = (
    optionId: string,
    capacityUnitId: string,
    checked: boolean,
  ) => {
    const nextKey = mappingKey(optionId, capacityUnitId);

    setSelectedMappingKeys((current) => {
      if (checked) {
        return current.includes(nextKey) ? current : [...current, nextKey];
      }

      return current.filter((entry) => entry !== nextKey);
    });
    setMappingsStatus({ error: null, savedAt: null });
  };

  const saveMappings = async () => {
    if (disabled || persistedActiveUnits.length === 0) return;

    setMappingsStatus({ error: null, savedAt: null });

    const activeUnitIds = new Set(
      persistedActiveUnits
        .map((unit) => unit.remoteId)
        .filter((unitId): unitId is string => Boolean(unitId)),
    );
    const eligibleOptionIds = new Set(
      participationOptions
        .filter((option) => !isOptionDisabledForMapping(option))
        .map((option) => option.id),
    );

    const inputs: AdminOptionCapacityUnitMappingInput[] = selectedMappingKeys
      .map((entry) => {
        const [optionId, capacityUnitId] = entry.split(":");
        return { optionId, capacityUnitId, seatsPerQuantity: 1 };
      })
      .filter(
        (input) =>
          eligibleOptionIds.has(input.optionId) &&
          activeUnitIds.has(input.capacityUnitId),
      );

    setSavingMappings(true);
    try {
      const saved = await replaceAdminOptionCapacityUnitMappings(eventId, inputs);
      setSelectedMappingKeys(
        saved.map((mapping) => mappingKey(mapping.optionId, mapping.capacityUnitId)),
      );
      setMappingsStatus({ error: null, savedAt: new Date().toISOString() });
    } catch (error) {
      setMappingsStatus({
        error:
          error instanceof Error
            ? error.message
            : "Не удалось сохранить маппинг capacity units.",
        savedAt: null,
      });
    } finally {
      setSavingMappings(false);
    }
  };

  return (
    <section className="capacity-units-constructor">
      <header className="capacity-units-constructor__head">
        <div>
          <h2>Учёт мест по трапезам/дням</h2>
          <p>Capacity units и связь вариантов участия с этими buckets.</p>
        </div>
        <div className="capacity-units-constructor__head-actions">
          <Button disabled={disabled} onClick={addShabbatTemplate} size="sm">
            + Шабат
          </Button>
          <Button disabled={disabled} onClick={addUnit} size="sm" variant="gold">
            + Unit
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
            <span>Capacity units</span>
            {hasUnsavedUnits ? <strong>Есть новые unsaved units</strong> : null}
          </div>

          {loading ? (
            <p className="capacity-units-empty">Загружаем capacity units...</p>
          ) : unitDrafts.length === 0 ? (
            <p className="capacity-units-empty">Сначала добавьте capacity units</p>
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
            <Button disabled={disabled} onClick={saveUnits} variant="primary">
              {savingUnits ? "Сохраняем..." : "Сохранить units"}
            </Button>
            <SaveStatusView
              error={unitsStatus.error}
              savedAt={unitsStatus.savedAt}
              saving={savingUnits}
            />
          </footer>
        </section>

        <section className="capacity-units-panel">
          <div className="capacity-units-panel__head">
            <span>Маппинг вариантов участия</span>
            {persistedActiveUnits.length > 0 ? (
              <strong>{persistedActiveUnits.length} active units</strong>
            ) : null}
          </div>

          {loading ? (
            <p className="capacity-units-empty">Загружаем маппинг...</p>
          ) : unitDrafts.length === 0 ? (
            <p className="capacity-units-empty">Сначала добавьте capacity units</p>
          ) : persistedActiveUnits.length === 0 ? (
            <p className="capacity-units-empty">
              Нет активных сохранённых units для маппинга.
            </p>
          ) : participationOptions.length === 0 ? (
            <p className="capacity-units-empty">Сначала добавьте варианты участия.</p>
          ) : (
            <div className="capacity-mapping-table">
              <div className="capacity-mapping-table__head">
                <span>Вариант</span>
                <span>Capacity units</span>
              </div>
              <div className="capacity-mapping-table__body">
                {participationOptions.map((option) => (
                  <MappingRow
                    disabled={disabled || isOptionDisabledForMapping(option)}
                    key={option.id}
                    onToggle={toggleMapping}
                    option={option}
                    selectedMappingKeySet={selectedMappingKeySet}
                    units={persistedActiveUnits}
                  />
                ))}
              </div>
            </div>
          )}

          <footer className="capacity-units-footer">
            <Button
              disabled={disabled || persistedActiveUnits.length === 0}
              onClick={saveMappings}
              variant="primary"
            >
              {savingMappings ? "Сохраняем..." : "Сохранить mappings"}
            </Button>
            <SaveStatusView
              error={mappingsStatus.error}
              savedAt={mappingsStatus.savedAt}
              saving={savingMappings}
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
      <UnitField error={errors.key} label="Key">
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
          <span>{unit.isActive ? "active" : "inactive"}</span>
        </label>
        <button
          aria-label="Удалить capacity unit"
          className="capacity-unit-row__delete"
          disabled={disabled}
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

function MappingRow({
  disabled,
  onToggle,
  option,
  selectedMappingKeySet,
  units,
}: {
  disabled: boolean;
  onToggle: (optionId: string, capacityUnitId: string, checked: boolean) => void;
  option: ParticipationOption;
  selectedMappingKeySet: Set<string>;
  units: DraftUnit[];
}) {
  const inactiveClass = option.isActive ? "" : " capacity-mapping-row--inactive";
  const disabledClass = disabled ? " capacity-mapping-row--disabled" : "";

  return (
    <div className={`capacity-mapping-row${inactiveClass}${disabledClass}`}>
      <div className="capacity-mapping-row__option">
        <span className="capacity-mapping-row__badge">{optionTypeLabel(option)}</span>
        <strong>{option.title}</strong>
        {disabled ? <small>места не занимает</small> : null}
      </div>
      <div className="capacity-mapping-row__units">
        {units.map((unit) => {
          const unitId = unit.remoteId;
          if (!unitId) {
            return null;
          }

          const key = mappingKey(option.id, unitId);
          return (
            <label className="capacity-mapping-checkbox" key={unitId}>
              <input
                checked={selectedMappingKeySet.has(key)}
                disabled={disabled}
                onChange={(event) =>
                  onToggle(option.id, unitId, event.target.checked)
                }
                type="checkbox"
              />
              <span>{unit.key || unit.title}</span>
            </label>
          );
        })}
      </div>
    </div>
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

function SaveStatusView({
  error,
  savedAt,
  saving,
}: {
  error: string | null;
  savedAt: string | null;
  saving: boolean;
}) {
  if (saving) {
    return <span className="capacity-units-status capacity-units-status--saving">Сохраняем...</span>;
  }

  if (error) {
    return (
      <span className="capacity-units-status capacity-units-status--error">
        Ошибка сохранения: {error}
      </span>
    );
  }

  if (savedAt) {
    return (
      <span className="capacity-units-status capacity-units-status--saved">
        Сохранено в {new Date(savedAt).toLocaleTimeString("ru-RU")}
      </span>
    );
  }

  return null;
}
