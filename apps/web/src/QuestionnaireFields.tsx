import type { ReactNode } from "react";
import {
  questionnaireControlId,
  type QuestionnaireErrors,
  type QuestionnaireValues,
} from "./questionnaire";
import type { WebQuestionnaireAnswerValue, WebQuestionnaireField } from "./types";

export function QuestionnaireFields({
  fields,
  values,
  errors,
  onChange,
}: {
  fields: WebQuestionnaireField[];
  values: QuestionnaireValues;
  errors: QuestionnaireErrors;
  onChange: (fieldId: string, value: WebQuestionnaireAnswerValue) => void;
}): ReactNode {
  if (fields.length === 0) return null;

  return (
    <section className="surface section-card questionnaire-section" aria-labelledby="questionnaire-heading">
      <h2 id="questionnaire-heading">Дополнительные вопросы</h2>
      <div className="questionnaire-list">
        {fields.map((field) => {
          const controlId = questionnaireControlId(field);
          const errorId = `${controlId}-error`;
          const helpId = `${controlId}-help`;
          const describedBy = errors[field.id] ? `${helpId} ${errorId}` : helpId;
          const value = values[field.id];
          const heading = (
            <>
              <span className="questionnaire-label">{field.label}</span>
              <span className="questionnaire-required">{field.required ? "Обязательный" : "Необязательный"}</span>
            </>
          );
          const transparency = (
            <p className="questionnaire-help" id={helpId}>
              Цель: {field.purpose}<br />
              Хранение: {field.retention_days} дн.
            </p>
          );
          const error = errors[field.id]
            ? <p className="field-error" id={errorId} role="alert">{errors[field.id]}</p>
            : null;

          if (field.field_type === "short_text" || field.field_type === "long_text") {
            const common = {
              id: controlId,
              value: typeof value === "string" ? value : "",
              "aria-invalid": Boolean(errors[field.id]),
              "aria-describedby": describedBy,
              onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onChange(field.id, event.target.value),
            };
            return (
              <div className="questionnaire-field form-field" key={field.id}>
                <label htmlFor={controlId}>{heading}</label>
                {transparency}
                {field.field_type === "long_text"
                  ? <textarea {...common} rows={5} />
                  : <input {...common} type="text" />}
                {error}
              </div>
            );
          }

          if (field.field_type === "boolean") {
            return (
              <fieldset className="questionnaire-field choice-fieldset" key={field.id} aria-describedby={describedBy}>
                <legend>{heading}</legend>
                {transparency}
                <div className="questionnaire-choices inline-choices">
                  <label><input id={controlId} type="radio" name={controlId} checked={value === true} onChange={() => onChange(field.id, true)} /> Да</label>
                  <label><input type="radio" name={controlId} checked={value === false} onChange={() => onChange(field.id, false)} /> Нет</label>
                </div>
                {error}
              </fieldset>
            );
          }

          const selected = Array.isArray(value) ? value : [];
          return (
            <fieldset className="questionnaire-field choice-fieldset" key={field.id} aria-describedby={describedBy}>
              <legend>{heading}</legend>
              {transparency}
              <div className="questionnaire-choices">
                {field.options.map((option, index) => (
                  <label key={option.value}>
                    <input
                      id={index === 0 ? controlId : undefined}
                      type={field.field_type === "single_select" ? "radio" : "checkbox"}
                      name={controlId}
                      checked={field.field_type === "single_select" ? value === option.value : selected.includes(option.value)}
                      onChange={(event) => {
                        if (field.field_type === "single_select") onChange(field.id, option.value);
                        else onChange(
                          field.id,
                          event.target.checked
                            ? [...selected, option.value]
                            : selected.filter((item) => item !== option.value),
                        );
                      }}
                    />
                    {option.label}
                  </label>
                ))}
              </div>
              {error}
            </fieldset>
          );
        })}
      </div>
    </section>
  );
}
