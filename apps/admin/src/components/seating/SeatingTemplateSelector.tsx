import type { SeatingTemplate } from "../../types/seating";

export const BUILT_IN_SEATING_TEMPLATES = [
  {
    id: "builtin:blank",
    title: "Пустой конструктор",
  },
  {
    id: "builtin:holiday_p_row",
    title: "П + ряд — праздничная схема",
  },
  {
    id: "builtin:grid",
    title: "Сетка отдельных столов",
  },
] as const;

export type BuiltInSeatingTemplateId =
  (typeof BUILT_IN_SEATING_TEMPLATES)[number]["id"];
export type UserSeatingTemplateValue = `user:${string}`;
export type SeatingTemplateValue =
  | BuiltInSeatingTemplateId
  | UserSeatingTemplateValue;

export const DEFAULT_SEATING_TEMPLATE_VALUE: BuiltInSeatingTemplateId =
  "builtin:blank";

export function userSeatingTemplateValue(templateId: string): UserSeatingTemplateValue {
  return `user:${templateId}`;
}

export function parseUserSeatingTemplateValue(value: string): string | null {
  return value.startsWith("user:") ? value.slice("user:".length) : null;
}

export function isBuiltInSeatingTemplateId(
  value: string,
): value is BuiltInSeatingTemplateId {
  return BUILT_IN_SEATING_TEMPLATES.some((template) => template.id === value);
}

export function SeatingTemplateSelector({
  canSaveTemplate,
  disabled,
  isApplyingTemplate,
  isDeletingTemplate,
  isLoadingTemplates,
  isSavingTemplate,
  onDeleteTemplate,
  onSaveTemplate,
  onTemplateChange,
  selectedValue,
  templates,
}: {
  canSaveTemplate: boolean;
  disabled: boolean;
  isApplyingTemplate: boolean;
  isDeletingTemplate: boolean;
  isLoadingTemplates: boolean;
  isSavingTemplate: boolean;
  onDeleteTemplate: (template: SeatingTemplate) => void;
  onSaveTemplate: () => void;
  onTemplateChange: (value: SeatingTemplateValue) => void;
  selectedValue: SeatingTemplateValue;
  templates: SeatingTemplate[];
}) {
  const userTemplates = templates.filter(
    (template) => template.isActive && !template.isBuiltin,
  );
  const selectedUserTemplateId = parseUserSeatingTemplateValue(selectedValue);
  const selectedUserTemplate =
    userTemplates.find((template) => template.id === selectedUserTemplateId) ?? null;
  const hasMissingSelectedTemplate =
    Boolean(selectedUserTemplateId) && !selectedUserTemplate;
  const busy =
    disabled ||
    isApplyingTemplate ||
    isDeletingTemplate ||
    isSavingTemplate;

  return (
    <div aria-busy={isLoadingTemplates} className="seat-layouts seat-template-selector">
      <label className="seat-template-field">
        <span>Готовая расстановка</span>
        <select
          aria-label="Готовая расстановка столов"
          disabled={busy}
          onChange={(event) =>
            onTemplateChange(event.target.value as SeatingTemplateValue)
          }
          value={selectedValue}
        >
          <optgroup label="Встроенные">
            {BUILT_IN_SEATING_TEMPLATES.map((template) => (
              <option key={template.id} value={template.id}>
                {template.title}
              </option>
            ))}
          </optgroup>

          {userTemplates.length > 0 ? (
            <optgroup label="Сохранённые">
              {userTemplates.map((template) => (
                <option key={template.id} value={userSeatingTemplateValue(template.id)}>
                  {template.title || "Без названия"}
                </option>
              ))}
            </optgroup>
          ) : null}

          {hasMissingSelectedTemplate ? (
            <option value={selectedValue}>Сохранённый шаблон недоступен</option>
          ) : null}
        </select>
      </label>

      <div className="seat-icon-group">
        <button
          aria-busy={isSavingTemplate || undefined}
          aria-label="Сохранить как шаблон"
          className="seat-icon-button"
          disabled={busy || !canSaveTemplate}
          onClick={onSaveTemplate}
          title={isSavingTemplate ? "Сохраняем шаблон..." : "Сохранить как шаблон"}
          type="button"
        ><TemplateSaveIcon /></button>
        <button
          aria-busy={isDeletingTemplate || undefined}
          aria-label="Удалить шаблон"
          className="seat-icon-button seat-icon-button--danger"
          disabled={busy || !selectedUserTemplate}
          onClick={() => selectedUserTemplate && onDeleteTemplate(selectedUserTemplate)}
          title={isDeletingTemplate ? "Удаляем шаблон..." : "Удалить шаблон"}
          type="button"
        ><TrashIcon /></button>
      </div>
    </div>
  );
}

function TemplateSaveIcon() { return <svg aria-hidden="true" fill="none" height="17" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.7" viewBox="0 0 24 24" width="17"><path d="M5 4h11l3 3v13H5z" /><path d="M8 4v6h8V4M8 20v-6h8v6" /></svg>; }
function TrashIcon() { return <svg aria-hidden="true" fill="none" height="17" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.7" viewBox="0 0 24 24" width="17"><path d="M4 7h16M10 11v5m4-5v5M9 7l1-3h4l1 3m-9 0 1 13h10l1-13" /></svg>; }
