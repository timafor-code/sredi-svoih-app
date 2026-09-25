import { useState, type CSSProperties } from "react";

import type {
  AdminQuestionnaireAnswersSummary,
  AdminQuestionnaireFieldType,
  AdminRegistrationQuestionnaireAnswer,
} from "../../types/registrations";
import { RegistrationsState } from "./RegistrationsState";

export const QUESTIONNAIRE_SMALL_SAMPLE_THRESHOLD = 10;

export type QuestionnaireModalPresentationType = "single" | "multi" | "boolean" | "text";

export type QuestionnaireModalOption = {
  label: string;
  count: number;
  percentage: number;
  isLeader: boolean;
};

export type QuestionnaireModalQuestion = {
  id: string;
  title: string;
  type: QuestionnaireModalPresentationType;
  answered: number;
  options: QuestionnaireModalOption[];
  textAnswers: Array<{ participantName: string; value: string }>;
};

export type QuestionnaireModalViewModel = {
  updatedAt: string | null;
  respondents: number;
  questions: QuestionnaireModalQuestion[];
  isEmpty: boolean;
};

type QuestionnaireModalRegistration = {
  participantDisplayName: string;
  answers: readonly Pick<AdminRegistrationQuestionnaireAnswer, "fieldId" | "value">[];
};

export function pluralizeRussian(count: number, one: string, few: string, many: string): string {
  const remainder = Math.abs(count) % 100;
  const lastDigit = remainder % 10;

  if (remainder >= 11 && remainder <= 14) return many;
  if (lastDigit === 1) return one;
  if (lastDigit >= 2 && lastDigit <= 4) return few;
  return many;
}

export function formatQuestionCount(count: number): string {
  return `${count} ${pluralizeRussian(count, "вопрос", "вопроса", "вопросов")}`;
}

export function formatRespondentCount(count: number): string {
  return `${count} ${pluralizeRussian(count, "респондент", "респондента", "респондентов")}`;
}

export function formatAnswerCount(count: number): string {
  return `${count} ${pluralizeRussian(count, "ответ", "ответа", "ответов")}`;
}

export function getQuestionnairePresentationType(
  fieldType: AdminQuestionnaireFieldType,
): QuestionnaireModalPresentationType {
  if (fieldType === "single_select") return "single";
  if (fieldType === "multi_select") return "multi";
  if (fieldType === "boolean") return "boolean";
  return "text";
}

export function getQuestionnairePercentage(count: number, answered: number): number {
  if (answered === 0) return 0;
  return Math.round((count / answered) * 100);
}

export function isQuestionnaireSmallSample(answered: number): boolean {
  return answered < QUESTIONNAIRE_SMALL_SAMPLE_THRESHOLD;
}

export function buildQuestionnaireModalViewModel({
  registrations,
  summary,
  updatedAt,
}: {
  registrations: readonly QuestionnaireModalRegistration[];
  summary: AdminQuestionnaireAnswersSummary | null;
  updatedAt: string | null;
}): QuestionnaireModalViewModel | null {
  if (!summary) return null;

  const currentFieldIds = new Set(summary.fields.map((field) => field.fieldId));
  const respondents = registrations.filter((registration) =>
    registration.answers.some(
      (answer) => currentFieldIds.has(answer.fieldId) && answer.value !== null,
    ),
  ).length;

  return {
    updatedAt,
    respondents,
    isEmpty: respondents === 0,
    questions: summary.fields.map((field) => {
      const answered = field.answeredCount;
      const maxCount = Math.max(0, ...field.options.map((option) => option.count));
      const type = getQuestionnairePresentationType(field.fieldType);

      return {
        id: field.fieldId,
        title: field.label,
        type,
        answered,
        options: field.options.map((option) => ({
          label: option.label,
          count: option.count,
          percentage: getQuestionnairePercentage(option.count, answered),
          isLeader: maxCount > 0 && option.count === maxCount,
        })),
        textAnswers: type === "text"
          ? registrations.flatMap((registration) => {
            const answer = registration.answers.find((candidate) => candidate.fieldId === field.fieldId);
            return typeof answer?.value === "string"
              ? [{ participantName: registration.participantDisplayName, value: answer.value }]
              : [];
          })
          : [],
      };
    }),
  };
}

export function formatQuestionnaireModalUpdatedAt(updatedAt: string | null): string {
  if (!updatedAt) return "Обновлено —";
  const date = new Date(updatedAt);
  if (Number.isNaN(date.getTime())) return "Обновлено —";

  const formatted = new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
  return `Обновлено ${formatted.replace(" в ", ", ")}`;
}

function getQuestionnaireTypeLabel(type: QuestionnaireModalPresentationType): string {
  const labels: Record<QuestionnaireModalPresentationType, string> = {
    single: "Один вариант",
    multi: "Несколько вариантов",
    boolean: "Да / нет",
    text: "Текст",
  };
  return labels[type];
}

export function QuestionnaireAnswersSummary({
  error,
  loading,
  viewModel,
}: {
  error: string | null;
  loading: boolean;
  viewModel: QuestionnaireModalViewModel | null;
}) {
  const [expandedTextQuestionIds, setExpandedTextQuestionIds] = useState<Set<string>>(() => new Set());
  if (loading) return <RegistrationsState title="Загрузка" description="Загружаем ответы." />;
  if (error) return <RegistrationsState title="Не удалось загрузить" description="Попробуйте открыть ответы снова." />;
  if (!viewModel) return null;
  if (viewModel.isEmpty) {
    return <div className="questionnaire-summary__empty">Пока нет ни одного ответа</div>;
  }

  return (
    <section className="questionnaire-summary">
      {viewModel.questions.map((question, index) => {
        const showAllText = expandedTextQuestionIds.has(question.id);
        const visibleTextAnswers = showAllText ? question.textAnswers : question.textAnswers.slice(0, 3);
        const hasSmallSample = isQuestionnaireSmallSample(question.answered);

        return (
          <article className="questionnaire-summary__field" key={question.id}>
            <header className="questionnaire-summary__question-head">
              <span className="questionnaire-summary__number">{String(index + 1).padStart(2, "0")}</span>
              <div>
                <h3>{question.title}</h3>
                <div className="questionnaire-summary__chips">
                  <span>{getQuestionnaireTypeLabel(question.type)}</span>
                  <span>{formatAnswerCount(question.answered)}</span>
                </div>
              </div>
            </header>

            {question.type === "text" ? (
              <div className="questionnaire-summary__text">
                {visibleTextAnswers.map((answer) => (
                  <p key={`${answer.participantName}-${answer.value}`}>
                    <b>{answer.participantName}</b>: {answer.value}
                  </p>
                ))}
                {question.textAnswers.length > 3 ? (
                  <button
                    className="questionnaire-summary__show-all"
                    onClick={() => setExpandedTextQuestionIds((current) => {
                      const next = new Set(current);
                      if (next.has(question.id)) next.delete(question.id);
                      else next.add(question.id);
                      return next;
                    })}
                    type="button"
                  >
                    {showAllText ? "Свернуть" : `Показать все ${question.textAnswers.length}`}
                  </button>
                ) : null}
              </div>
            ) : (
              <div className="questionnaire-summary__options">
                {question.options.map((option) => (
                  <div className="questionnaire-summary__option" key={option.label}>
                    <div className="questionnaire-summary__option-meta">
                      <span className={option.count === 0 ? "questionnaire-summary__option-label--zero" : undefined}>
                        {option.label}
                      </span>
                      <div>
                        <b>{option.count}</b>
                        <strong className={option.isLeader ? "questionnaire-summary__percentage--leader" : undefined}>
                          {option.percentage}%
                        </strong>
                        {option.isLeader ? <em>лидер</em> : null}
                      </div>
                    </div>
                    <div
                      aria-label={`${question.title}: ${option.label}, ${option.percentage}%`}
                      aria-valuemax={100}
                      aria-valuemin={0}
                      aria-valuenow={option.percentage}
                      className="questionnaire-summary__progress"
                      role="progressbar"
                    >
                      <span
                        className={option.isLeader ? "questionnaire-summary__progress-fill questionnaire-summary__progress-fill--leader" : "questionnaire-summary__progress-fill"}
                        style={{ "--questionnaire-progress": `${option.percentage}%` } as CSSProperties}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}

            {hasSmallSample ? (
              <p className="questionnaire-summary__small-sample">
                Мало ответов ({question.answered}) — проценты пока не показательны
              </p>
            ) : null}
          </article>
        );
      })}
    </section>
  );
}
