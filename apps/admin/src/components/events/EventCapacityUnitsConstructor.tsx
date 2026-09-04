import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { ArrowDown, ArrowUp, Pencil, X } from "lucide-react";

import { Button } from "../ui/Button";
import { SaveStatusView } from "../ui/SaveStatusView";
import { ApiClientError } from "../../services/apiClient";
import {
  listAdminEventCapacityUnits,
  replaceAdminEventCapacityUnits,
} from "../../services/adminEventCapacityUnitsService";
import type {
  AdminEventCapacityUnit,
  AdminEventCapacityUnitInput,
} from "../../types/eventCapacityUnits";

type EventCapacityUnitsConstructorProps = {
  eventId: string;
  active?: boolean;
  onDirtyChange?: (dirty: boolean) => void;
  onPersisted: (units: AdminEventCapacityUnit[], deletedIds: string[]) => void;
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
  Record<"key" | "title" | "description" | "capacity" | "sortOrder", string>
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
    capacity: unit.capacity === null || unit.capacity <= 0 ? "" : String(unit.capacity),
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
    } else if (key.length > 120) {
      draftErrors.key = "Код должен быть не длиннее 120 символов.";
    } else if (seenKeys.has(normalizedKey)) {
      draftErrors.key = "Код слота должен быть уникальным.";
    } else {
      seenKeys.add(normalizedKey);
    }

    if (!title) {
      draftErrors.title = "Укажите название.";
    }

    if (title.length > 240) draftErrors.title = "Не более 240 символов.";
    if (draft.description.length > 1000) draftErrors.description = "Не более 1000 символов.";

    const capacityParsed = parseInteger(draft.capacity);
    let capacity: number | null = null;
    if (capacityParsed !== null) {
      if (Number.isNaN(capacityParsed) || capacityParsed <= 0) {
        draftErrors.capacity = "Лимит должен быть положительным целым числом.";
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

function suggestUnitKey(title: string, drafts: DraftUnit[]): string {
  const letters: Record<string, string> = Object.fromEntries(
    [..."абвгдеёжзийклмнопрстуфхцчшщъыьэюя"].map((letter, index) => [
      letter,
      ["a", "b", "v", "g", "d", "e", "yo", "zh", "z", "i", "y", "k", "l", "m", "n", "o", "p", "r", "s", "t", "u", "f", "kh", "ts", "ch", "sh", "sch", "", "y", "", "e", "yu", "ya"][index],
    ]),
  );
  const base = [...title.toLowerCase()].map((letter) => letters[letter] ?? letter)
    .join("").normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 110) || "slot";
  const keys = new Set(drafts.map((draft) => draft.key.trim().toLowerCase()));
  let key = base;
  for (let suffix = 2; keys.has(key); suffix += 1) key = `${base}_${suffix}`;
  return key;
}

// Only completed, validated edits enter this collection. The modal's partial
// input stays separate. Full-list PUTs are serialized and intermediate edits coalesce.
function createUnitSaveQueue(
  eventId: string,
  onDrafts: (drafts: DraftUnit[]) => void,
  onSaved: (drafts: DraftUnit[], units: AdminEventCapacityUnit[]) => void,
  onStatus: (status: SaveStatus & { saving: boolean }) => void,
) {
  let latest: DraftUnit[] = [];
  let running = false;
  let pending = false;
  let uncertain: DraftUnit[] | null = null;
  let rejected: DraftUnit[] | null = null;

  const update = (drafts: DraftUnit[]) => {
    latest = drafts;
    onDrafts(latest);
  };
  const attachIds = (sent: DraftUnit[], units: AdminEventCapacityUnit[]) => {
    const ids = new Map(sent.map((draft) => [draft.draftId,
      draft.remoteId ?? units.find((unit) => unit.key === draft.key.trim())?.id ?? null,
    ]));
    const hydrate = (drafts: DraftUnit[]) => drafts.map((draft) => ({
      ...draft, remoteId: draft.remoteId ?? ids.get(draft.draftId) ?? null,
    }));
    update(hydrate(latest));
    return hydrate(sent);
  };

  const restoreRejectedDeletion = async () => {
    if (!rejected) return 0;
    // Keep the deterministic rejection until GET succeeds. A failed recovery
    // must retry reconciliation before another PUT, never repeat the deletion.
    const units = await listAdminEventCapacityUnits(eventId);
    attachIds(rejected, units);
    const retainedIds = new Set(latest.map((draft) => draft.remoteId));
    const restored = units.filter((unit) => !retainedIds.has(unit.id)).map(buildDraftFromUnit);
    // Read latest after GET: edits completed during either request win over the
    // server's older versions. Only missing persisted units are restored.
    update([...latest, ...restored]);
    rejected = null;
    return restored.length;
  };

  const save = async () => {
    pending = true;
    if (running) return;
    running = true;
    onStatus({ saving: true, error: null, savedAt: null });
    try {
      if (rejected) await restoreRejectedDeletion();
      // A lost response may follow a successful PUT. Recover assigned IDs before
      // retrying so newly created slots (and their mappings) are not recreated.
      if (uncertain) {
        const units = await listAdminEventCapacityUnits(eventId);
        attachIds(uncertain, units);
        uncertain = null;
      }
      while (pending) {
        pending = false;
        const sent = latest;
        const validation = validateUnitDrafts(sent);
        if (!validation.ok) throw new Error("Проверьте поля слотов.");
        uncertain = sent;
        let units: AdminEventCapacityUnit[];
        try {
          units = await replaceAdminEventCapacityUnits(eventId, validation.inputs);
        } catch (error) {
          if (error instanceof ApiClientError && error.status === 409) {
            // Unlike a lost response, this transaction was rejected/rolled back.
            rejected = sent;
            uncertain = null;
            const restoredCount = await restoreRejectedDeletion();
            throw new Error(restoredCount > 0
              ? "Слот нельзя удалить, потому что по нему уже есть регистрации. Слот восстановлен."
              : "Сохранение отклонено из-за конфликта. Локальные изменения сохранены.");
          }
          throw error;
        }
        const saved = attachIds(sent, units);
        uncertain = null;
        onSaved(saved, units);
      }
      onStatus({ saving: false, error: null, savedAt: new Date().toISOString() });
    } catch (error) {
      pending = false;
      onStatus({ saving: false, savedAt: null, error: rejected
        ? "Не удалось восстановить слоты после конфликта. Повторите попытку."
        : error instanceof Error
        ? error.message : "Не удалось сохранить слоты." });
    } finally {
      running = false;
    }
  };
  return { update, save, getDrafts: () => latest };
}

export function EventCapacityUnitsConstructor({ eventId, onPersisted, active = true, onDirtyChange }: EventCapacityUnitsConstructorProps) {
  const [drafts, setDrafts] = useState<DraftUnit[]>([]);
  const [savedSnapshot, setSavedSnapshot] = useState("[]");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [status, setStatus] = useState<SaveStatus & { saving: boolean }>({ error: null, savedAt: null, saving: false });
  const [editor, setEditor] = useState<DraftUnit | null>(null);
  const [errors, setErrors] = useState<DraftUnitErrors>({});
  const autoKey = useRef(false);
  const mounted = useRef(false);
  const persistedUnits = useRef<AdminEventCapacityUnit[]>([]);
  const [queue] = useState(() => createUnitSaveQueue(eventId,
    (next) => {
      if (!mounted.current) return;
      setDrafts(next);
      setEditor((current) => current ? {
        ...current, remoteId: next.find((draft) => draft.draftId === current.draftId)?.remoteId ?? current.remoteId,
      } : null);
    },
    (saved, units) => {
      if (!mounted.current) return;
      setSavedSnapshot(JSON.stringify(saved));
      const retainedIds = new Set(saved.map((draft) => draft.remoteId));
      const deletedIds = persistedUnits.current.filter((unit) => !retainedIds.has(unit.id)).map((unit) => unit.id);
      persistedUnits.current = units;
      onPersisted(units, deletedIds);
    },
    (next) => { if (mounted.current) setStatus(next); },
  ));

  useEffect(() => {
    mounted.current = true;
    let cancelled = false;
    listAdminEventCapacityUnits(eventId).then((units) => {
      if (cancelled) return;
      const next = units.map(buildDraftFromUnit);
      queue.update(next);
      setSavedSnapshot(JSON.stringify(next));
      persistedUnits.current = units;
      onPersisted(units, []);
    }).catch((error) => {
      if (!cancelled) setLoadError(error instanceof Error ? error.message : "Не удалось загрузить слоты.");
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; mounted.current = false; };
  }, [eventId, onPersisted, queue]);

  const openEditor = (draft: DraftUnit, isNew = false) => {
    autoKey.current = isNew;
    setErrors({});
    setEditor(draft);
  };
  const edit = (patch: Partial<DraftUnit>) => {
    if (!editor) return;
    if (patch.key !== undefined) autoKey.current = false;
    const next = { ...editor, ...patch };
    if (patch.title !== undefined && autoKey.current) {
      next.key = suggestUnitKey(next.title, queue.getDrafts().filter((draft) => draft.draftId !== next.draftId));
    }
    setEditor(next);
    setErrors({});
  };
  const completeEdit = () => {
    if (!editor) return true;
    const current = queue.getDrafts();
    const existing = current.find((draft) => draft.draftId === editor.draftId);
    const next = { ...editor, remoteId: existing?.remoteId ?? editor.remoteId };
    const collection = existing ? current.map((draft) => draft.draftId === next.draftId ? next : draft) : [...current, next];
    const validation = validateUnitDrafts(collection);
    if (!validation.ok) {
      setErrors(validation.errors[next.draftId] ?? { key: "Проверьте коды других слотов." });
      return false;
    }
    autoKey.current = false;
    if (JSON.stringify(collection) !== JSON.stringify(current)) {
      queue.update(collection);
      void queue.save();
    }
    return true;
  };
  const closeEditor = () => {
    if (completeEdit()) setEditor(null);
  };
  const addPreset = (templates: UnitTemplate[]) => {
    const current = queue.getDrafts();
    const keys = new Set(current.map((draft) => draft.key.trim().toLowerCase()));
    const additions = templates.filter((template) => !keys.has(template.key.toLowerCase()))
      .map((template, index) => buildTemplateDraft(template, current.length + index));
    if (!additions.length) return;
    queue.update([...current, ...additions]);
    void queue.save();
  };
  const ordered = [...drafts].sort((left, right) => Number(left.sortOrder) - Number(right.sortOrder));
  const move = (draftId: string, direction: -1 | 1) => {
    const next = [...ordered];
    const index = next.findIndex((draft) => draft.draftId === draftId);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    queue.update(withSequentialSortOrder(next));
    void queue.save();
  };
  const deleteSlot = () => {
    if (!editor) return;
    const next = queue.getDrafts().filter((draft) => draft.draftId !== editor.draftId);
    setEditor(null);
    setErrors({});
    queue.update(withSequentialSortOrder(next));
    void queue.save();
  };
  const editorDirty = editor !== null && JSON.stringify(editor) !== JSON.stringify(drafts.find((draft) => draft.draftId === editor.draftId));
  const unsaved = editorDirty || JSON.stringify(drafts) !== savedSnapshot;
  useEffect(() => { onDirtyChange?.(unsaved); }, [unsaved, onDirtyChange]);
  useEffect(() => () => onDirtyChange?.(false), [eventId, onDirtyChange]);

  const feedback = <SaveStatusView saving={status.saving} error={Object.keys(errors).length ? "Исправьте поля слота. Изменения пока не сохранены." : status.error}
    unsaved={unsaved} savedAt={status.savedAt} recovery={status.error ? "Изменения сохранены локально. Повторите попытку." : undefined} />;
  const disabled = loading || Boolean(loadError);

  return (
    <section className="tickets-capacity-panel" aria-label="Слоты регистраций">
      <h3>Слоты регистраций</h3>
      <p>Общие лимиты для связанных вариантов участия.</p>
      {loadError ? <p className="form-error" role="alert">{loadError}</p> : null}
      {loading ? <p>Загружаем слоты…</p> : !drafts.length ? <p>Добавьте слот или выберите готовый набор.</p> : (
        <ul className="tickets-capacity-list">
          {ordered.map((draft, index) => (
            <li key={draft.draftId} className={`tickets-capacity-row${draft.isActive ? "" : " tickets-capacity-row--inactive"}`}>
              <button type="button" className="tickets-capacity-row__body" onClick={() => openEditor(draft)}>
                <span className="tickets-capacity-row__name"><strong>{draft.title}</strong><span>{draft.isActive ? "Активен" : "Неактивен"}</span></span>
                <span className="tickets-capacity-row__limit">{draft.capacity ? `Лимит: ${draft.capacity}` : "Без лимита"}</span>
              </button>
              <div className="participation-option-row__actions">
                <button type="button" className="participation-option-row__action" aria-label={`Редактировать слот «${draft.title}»`} title="Редактировать слот" onClick={() => openEditor(draft)}><Pencil aria-hidden size={16} /></button>
                <button type="button" className="participation-option-row__action" aria-label={`Переместить слот «${draft.title}» выше`} title="Переместить выше" disabled={index === 0} onClick={() => move(draft.draftId, -1)}><ArrowUp aria-hidden size={16} /></button>
                <button type="button" className="participation-option-row__action" aria-label={`Переместить слот «${draft.title}» ниже`} title="Переместить ниже" disabled={index === ordered.length - 1} onClick={() => move(draft.draftId, 1)}><ArrowDown aria-hidden size={16} /></button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <Button className="tickets-capacity-add" variant="gold" disabled={disabled} onClick={() => openEditor(buildEmptyDraft(drafts.length), true)}>+ Добавить слот</Button>
      <div className="tickets-capacity-presets">
        <Button size="sm" variant="gold" disabled={disabled} onClick={() => addPreset(SHABBAT_UNIT_TEMPLATES)}>+ Шабат</Button>
        <Button size="sm" variant="gold" disabled={disabled} onClick={() => addPreset(YOM_TOV_ONE_DAY_UNIT_TEMPLATES)}>+ Йом Тов 1 день</Button>
        <Button size="sm" variant="gold" disabled={disabled} onClick={() => addPreset(YOM_TOV_TWO_DAYS_UNIT_TEMPLATES)}>+ Йом Тов 2 дня</Button>
      </div>
      <p className="tickets-capacity-invariant">Лимит слота ограничивает регистрации, а не число физических мест на схеме рассадки.</p>
      {feedback}
      {status.error ? <Button size="sm" onClick={() => { if (completeEdit()) void queue.save(); }}>Повторить сохранение</Button> : null}
      {editor ? createPortal(
        <SlotModal active={active} onClose={closeEditor}>
          <header className="participation-modal__head">
            <h3 id="slot-editor-title">{editor.remoteId ? "Редактировать слот" : "Новый слот"}</h3>
            <button type="button" className="participation-modal__close" aria-label="Закрыть редактор слота" onClick={closeEditor}><X aria-hidden size={18} /></button>
          </header>
          <div className="participation-modal__body" onBlur={(event) => {
            if (event.relatedTarget instanceof HTMLElement && event.relatedTarget.closest("[data-discard-slot]")) return;
            if (event.target instanceof HTMLInputElement) completeEdit();
          }}>
            <p className="tickets-capacity-hint">Корректные изменения сохраняются при выходе из поля.</p>
            <UnitField label="Название" error={errors.title}><input value={editor.title} onChange={(event) => edit({ title: event.target.value })} /></UnitField>
            <UnitField label="Лимит" error={errors.capacity}><input inputMode="numeric" placeholder="Без лимита" value={editor.capacity} onChange={(event) => edit({ capacity: event.target.value })} /></UnitField>
            <label className="tickets-capacity-active"><input type="checkbox" checked={editor.isActive} onChange={(event) => edit({ isActive: event.target.checked })} />Активен</label>
            <UnitField label="Описание (необязательно)" error={errors.description}><input value={editor.description} onChange={(event) => edit({ description: event.target.value })} /></UnitField>
            <details className="participation-modal__advanced" open={errors.key || errors.sortOrder ? true : undefined}>
              <summary>Дополнительные параметры</summary>
              <UnitField label="Технический код" error={errors.key}><input value={editor.key} onChange={(event) => edit({ key: event.target.value })} /></UnitField>
              <p className="tickets-capacity-hint">Создаётся из названия нового слота. После первого сохранения меняется только вручную.</p>
              <UnitField label="Порядок сортировки" error={errors.sortOrder}><input inputMode="numeric" value={editor.sortOrder} onChange={(event) => edit({ sortOrder: event.target.value })} /></UnitField>
            </details>
            {feedback}
            {status.error ? <Button onClick={() => { if (completeEdit()) void queue.save(); }}>Повторить сохранение</Button> : null}
          </div>
          <footer className="participation-modal__footer">
            <Button variant="destructive" data-discard-slot onClick={deleteSlot}>Удалить слот</Button>
            <Button variant="ghost" data-discard-slot onClick={() => { setEditor(null); setErrors({}); }}>Отменить несохранённое</Button>
            <Button variant="success" onClick={closeEditor}>Готово</Button>
          </footer>
        </SlotModal>, document.body,
      ) : null}
    </section>
  );
}

function SlotModal({ children, onClose, active }: { children: ReactNode; onClose: () => void; active: boolean }) {
  const dialog = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    if (!active) return;
    const previousFocus = document.activeElement;
    dialog.current?.querySelector("input")?.focus();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); close.current(); }
      if (event.key !== "Tab") return;
      const controls = Array.from(dialog.current?.querySelectorAll<HTMLElement>(
        'button:not(:disabled), input:not(:disabled), summary, [tabindex="0"]',
      ) ?? []).filter((element) => element.getClientRects().length > 0);
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("keydown", handleKey);
      if (previousFocus instanceof HTMLElement) previousFocus.focus();
    };
  }, [active]);
  return <div className="participation-modal-overlay" style={active ? undefined : { display: "none" }} onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="participation-modal tickets-slot-modal" ref={dialog} role="dialog" aria-modal="true" aria-labelledby="slot-editor-title">{children}</div>
  </div>;
}

function UnitField({ children, error, label }: { children: ReactNode; error?: string; label: string }) {
  return <label className="participation-modal__field"><span>{label}</span>{children}{error ? <small role="alert">{error}</small> : null}</label>;
}
