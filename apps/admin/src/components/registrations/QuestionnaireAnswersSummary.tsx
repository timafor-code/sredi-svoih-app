import { useState } from "react";

import type {
  AdminEventRegistrationRow,
  AdminQuestionnaireAnswersSummary,
} from "../../types/registrations";
import { RegistrationsState } from "./RegistrationsState";

export function QuestionnaireAnswersSummary({
  error,
  loading,
  registrations,
  summary,
}: {
  error: string | null;
  loading: boolean;
  registrations: readonly AdminEventRegistrationRow[];
  summary: AdminQuestionnaireAnswersSummary | null;
}) {
  const [showAllText, setShowAllText] = useState(false);
  if (loading) return <RegistrationsState title="Сводка по анкете" description="Загружаем ответы." />;
  if (error) return <RegistrationsState title="Сводка по анкете" description="Не удалось загрузить сводку. Таблица регистраций продолжает работать." />;
  if (!summary || summary.fields.length === 0) return null;

  return (
    <section className="questionnaire-summary" aria-labelledby="questionnaire-summary-title">
      <h3 id="questionnaire-summary-title">Сводка по анкете</h3>
      {summary.fields.map((field) => {
        const textAnswers = registrations.flatMap((registration) => {
          const answer = registration.answers.find((candidate) => candidate.fieldKey === field.fieldKey);
          return typeof answer?.value === "string"
            ? [{ name: registration.participantDisplayName, value: answer.value }]
            : [];
        });
        const visibleTextAnswers = showAllText ? textAnswers : textAnswers.slice(0, 3);
        return (
          <article className="questionnaire-summary__field" key={field.fieldId}>
            <strong>{field.label}</strong>
            <span>{field.answeredCount} заполн.</span>
            {field.fieldType === "short_text" || field.fieldType === "long_text" ? (
              <div className="questionnaire-summary__text">
                {visibleTextAnswers.map((answer) => <p key={`${answer.name}-${answer.value}`}><b>{answer.name}</b>: {answer.value}</p>)}
                {textAnswers.length > 3 ? <button onClick={() => setShowAllText((current) => !current)} type="button">{showAllText ? "Свернуть" : `Показать все ${textAnswers.length}`}</button> : null}
              </div>
            ) : (
              <div className="questionnaire-summary__bars">
                {field.options.map((option) => (
                  <div key={String(option.value)}>
                    <span>{option.label}</span><b>{option.count}</b>
                    <i style={{ width: `${field.answeredCount ? (option.count / field.answeredCount) * 100 : 0}%` }} />
                  </div>
                ))}
              </div>
            )}
          </article>
        );
      })}
    </section>
  );
}
