import { Button } from "../ui/Button";
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

      <Button
        disabled={busy || !canSaveTemplate}
        onClick={onSaveTemplate}
        size="sm"
        variant="secondary"
      >
        {isSavingTemplate ? "Сохраняем..." : "Сохранить как шаблон"}
      </Button>

      <Button
        disabled={busy || !selectedUserTemplate}
        onClick={() => {
          if (selectedUserTemplate) {
            onDeleteTemplate(selectedUserTemplate);
          }
        }}
        size="sm"
        variant="secondary"
      >
        {isDeletingTemplate ? "Удаляем..." : "Удалить шаблон"}
      </Button>
    </div>
  );
}
