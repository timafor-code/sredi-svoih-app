import type {
  WebQuestionnaireAnswer,
  WebQuestionnaireAnswerValue,
  WebQuestionnaireField,
} from "./types";

export type QuestionnaireValues = Record<string, WebQuestionnaireAnswerValue | undefined>;
export type QuestionnaireErrors = Record<string, string | undefined>;

export function questionnaireControlId(field: WebQuestionnaireField): string {
  return `questionnaire-${field.id}`;
}

function normalizedText(field: WebQuestionnaireField, value: string): string {
  const lineNormalized = field.field_type === "long_text"
    ? value.replace(/\r\n?/g, "\n")
    : value;
  return lineNormalized.trim();
}

function hasUnsafeControls(field: WebQuestionnaireField, value: string): boolean {
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code === 0 || (code < 32 && !(field.field_type === "long_text" && code === 10)) || code === 127) {
      return true;
    }
  }
  return false;
}

export function validateQuestionnaire(
  fields: WebQuestionnaireField[],
  values: QuestionnaireValues,
): { answers: WebQuestionnaireAnswer[]; errors: QuestionnaireErrors } {
  const answers: WebQuestionnaireAnswer[] = [];
  const errors: QuestionnaireErrors = {};

  for (const field of fields) {
    const value = values[field.id];
    if (value === undefined) {
      if (field.required) errors[field.id] = "Ответьте на обязательный вопрос.";
      continue;
    }

    if (field.field_type === "short_text" || field.field_type === "long_text") {
      if (typeof value !== "string") {
        errors[field.id] = "Введите текстовый ответ.";
        continue;
      }
      const normalized = normalizedText(field, value);
      if (hasUnsafeControls(field, normalized)) {
        errors[field.id] = "Ответ содержит недопустимые символы.";
        continue;
      }
      if (field.required && normalized.length === 0) {
        errors[field.id] = "Ответьте на обязательный вопрос.";
        continue;
      }
      const minimum = field.validation.min_length;
      const maximum = field.validation.max_length;
      if (minimum !== undefined && normalized.length < minimum) {
        errors[field.id] = `Введите не менее ${minimum} симв.`;
        continue;
      }
      if (maximum !== undefined && normalized.length > maximum) {
        errors[field.id] = `Введите не более ${maximum} симв.`;
        continue;
      }
      answers.push({ field_id: field.id, value: normalized });
      continue;
    }

    const allowed = new Set(field.options.map((option) => option.value));
    if (field.field_type === "single_select") {
      if (typeof value !== "string" || !allowed.has(value)) {
        errors[field.id] = "Выберите один из предложенных вариантов.";
        continue;
      }
      answers.push({ field_id: field.id, value });
      continue;
    }

    if (field.field_type === "multi_select") {
      if (!Array.isArray(value) || value.some((item) => !allowed.has(item))) {
        errors[field.id] = "Выберите только предложенные варианты.";
        continue;
      }
      const unique = [...new Set(value)];
      const minimum = field.validation.min_selections;
      const maximum = field.validation.max_selections;
      if (field.required && unique.length === 0) {
        errors[field.id] = "Ответьте на обязательный вопрос.";
        continue;
      }
      if (minimum !== undefined && unique.length < minimum) {
        errors[field.id] = `Выберите не менее ${minimum} вариантов.`;
        continue;
      }
      if (maximum !== undefined && unique.length > maximum) {
        errors[field.id] = `Выберите не более ${maximum} вариантов.`;
        continue;
      }
      answers.push({ field_id: field.id, value: unique });
      continue;
    }

    if (typeof value !== "boolean") {
      errors[field.id] = "Выберите «Да» или «Нет».";
      continue;
    }
    answers.push({ field_id: field.id, value });
  }

  return { answers, errors };
}

export function focusFirstQuestionnaireError(
  fields: WebQuestionnaireField[],
  errors: QuestionnaireErrors,
): boolean {
  const field = fields.find((candidate) => errors[candidate.id]);
  if (!field) return false;
  document.getElementById(questionnaireControlId(field))?.focus();
  return true;
}
