import type { ReactNode } from "react";
import {
  formatQuestionnaireRetention,
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
            <div className="questionnaire-heading-row">
              <span className="questionnaire-label">{field.label}</span>
              <span className="questionnaire-required">{field.required ? "Обязательный" : "Необязательный"}</span>
            </div>
          );
          const transparency = (
            <p className="questionnaire-help" id={helpId}>
              Цель: {field.purpose} <span aria-hidden="true">·</span> Хранение: {formatQuestionnaireRetention(field.retention_days)}
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
                <legend className="visually-hidden">{field.label}</legend>
                {heading}
                {transparency}
                <div className="questionnaire-choices questionnaire-choice-grid">
                  <label className="questionnaire-choice-card questionnaire-choice-card--radio">
                    <input className="visually-hidden" id={controlId} type="radio" name={controlId} checked={value === true} aria-invalid={Boolean(errors[field.id])} onChange={() => onChange(field.id, true)} />
                    <span className="questionnaire-choice-indicator" aria-hidden="true" />
                    <span>Да</span>
                  </label>
                  <label className="questionnaire-choice-card questionnaire-choice-card--radio">
                    <input className="visually-hidden" id={`${controlId}-false`} type="radio" name={controlId} checked={value === false} aria-invalid={Boolean(errors[field.id])} onChange={() => onChange(field.id, false)} />
                    <span className="questionnaire-choice-indicator" aria-hidden="true" />
                    <span>Нет</span>
                  </label>
                </div>
                {error}
              </fieldset>
            );
          }

          const selected = Array.isArray(value) ? value : [];
          return (
            <fieldset className="questionnaire-field choice-fieldset" key={field.id} aria-describedby={describedBy}>
              <legend className="visually-hidden">{field.label}</legend>
              {heading}
              {transparency}
              <div className="questionnaire-choices questionnaire-choice-grid">
                {field.options.map((option, index) => (
                  <label
                    className={`questionnaire-choice-card${field.field_type === "single_select" ? " questionnaire-choice-card--radio" : ""}`}
                    key={option.value}
                  >
                    <input
                      className="visually-hidden"
                      id={index === 0 ? controlId : `${controlId}-${index}`}
                      type={field.field_type === "single_select" ? "radio" : "checkbox"}
                      name={controlId}
                      checked={field.field_type === "single_select" ? value === option.value : selected.includes(option.value)}
                      aria-invalid={Boolean(errors[field.id])}
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
                    <span className="questionnaire-choice-indicator" aria-hidden="true" />
                    <span>{option.label}</span>
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
