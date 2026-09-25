import { describe, expect, it } from "vitest";

import {
  buildQuestionnaireModalViewModel,
  formatAnswerCount,
  formatQuestionCount,
  formatRespondentCount,
  getQuestionnairePercentage,
  getQuestionnairePresentationType,
  isQuestionnaireSmallSample,
  QUESTIONNAIRE_SMALL_SAMPLE_THRESHOLD,
} from "./QuestionnaireAnswersSummary";

const summary = {
  eventId: "event",
  fields: [
    {
      fieldId: "current-multi",
      fieldKey: "roots",
      label: "Корни",
      fieldType: "multi_select" as const,
      formVersion: 2,
      answeredCount: 2,
      options: [
        { value: "mother", label: "Мама", count: 2 },
        { value: "conversion", label: "Гиюр", count: 2 },
        { value: "father", label: "Папа", count: 0 },
      ],
    },
  ],
};

describe("questionnaire answers modal view model", () => {
  it("uses Russian pluralization for 1, 2, 5, 11, 21, 22, and 25", () => {
    expect([1, 2, 5, 11, 21, 22, 25].map(formatQuestionCount)).toEqual([
      "1 вопрос", "2 вопроса", "5 вопросов", "11 вопросов", "21 вопрос", "22 вопроса", "25 вопросов",
    ]);
    expect(formatRespondentCount(2)).toBe("2 респондента");
    expect(formatAnswerCount(5)).toBe("5 ответов");
  });

  it("maps multi-select to multi and preserves server-computed answered counts", () => {
    const viewModel = buildQuestionnaireModalViewModel({ summary, updatedAt: "2026-09-25T12:40:00.000Z", registrations: [] });
    expect(getQuestionnairePresentationType("multi_select")).toBe("multi");
    expect(viewModel?.questions[0]).toMatchObject({ type: "multi", answered: 2 });
  });

  it("calculates independent percentages, including zero totals and multi-select totals above 100", () => {
    expect(getQuestionnairePercentage(1, 1)).toBe(100);
    expect(getQuestionnairePercentage(1, 2)).toBe(50);
    expect(getQuestionnairePercentage(1, 0)).toBe(0);
    const viewModel = buildQuestionnaireModalViewModel({ summary, updatedAt: null, registrations: [] });
    expect(viewModel?.questions[0]?.options.reduce((total, option) => total + option.percentage, 0)).toBe(200);
  });

  it("marks tied leaders and never selects a leader when every option is zero", () => {
    const tied = buildQuestionnaireModalViewModel({ summary, updatedAt: null, registrations: [] });
    expect(tied?.questions[0]?.options.map((option) => option.isLeader)).toEqual([true, true, false]);
    const zero = buildQuestionnaireModalViewModel({
      summary: { ...summary, fields: [{ ...summary.fields[0], answeredCount: 0, options: summary.fields[0].options.map((option) => ({ ...option, count: 0 })) }] },
      updatedAt: null,
      registrations: [],
    });
    expect(zero?.questions[0]?.options.every((option) => !option.isLeader)).toBe(true);
  });

  it("deduplicates respondents and ignores retired-form answers with a reused field key", () => {
    const viewModel = buildQuestionnaireModalViewModel({
      summary,
      updatedAt: null,
      registrations: [
        { participantDisplayName: "А", answers: [{ fieldId: "retired-roots", value: "old" }, { fieldId: "current-multi", value: ["mother"] }] },
        { participantDisplayName: "Б", answers: [{ fieldId: "current-multi", value: false }] },
        { participantDisplayName: "В", answers: [{ fieldId: "retired-roots", value: "old" }] },
      ],
    });
    expect(viewModel?.respondents).toBe(2);
    expect(viewModel?.isEmpty).toBe(false);
  });

  it("uses the named small-sample threshold and recognizes the global empty state", () => {
    expect(QUESTIONNAIRE_SMALL_SAMPLE_THRESHOLD).toBe(10);
    expect(isQuestionnaireSmallSample(9)).toBe(true);
    expect(isQuestionnaireSmallSample(10)).toBe(false);
    const empty = buildQuestionnaireModalViewModel({ summary, updatedAt: null, registrations: [] });
    expect(empty?.isEmpty).toBe(true);
  });
});
