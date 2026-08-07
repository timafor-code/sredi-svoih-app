import { describe, expect, it } from "vitest";
import {
  focusFirstQuestionnaireError,
  questionnaireControlId,
  validateQuestionnaire,
} from "./questionnaire";
import { QUESTION_IDS, responseWithQuestionnaire } from "./test/fixtures";

describe("questionnaire validation", () => {
  const fields = responseWithQuestionnaire().questions;
  const valid = {
    [QUESTION_IDS.short]: " ok ",
    [QUESTION_IDS.single]: "north",
    [QUESTION_IDS.multi]: ["one"],
    [QUESTION_IDS.boolean]: false,
  };

  it("normalizes supported answers and treats explicit false as answered", () => {
    const result = validateQuestionnaire(fields, valid);
    expect(result.errors).toEqual({});
    expect(result.answers).toEqual([
      { field_id: QUESTION_IDS.short, value: "ok" },
      { field_id: QUESTION_IDS.single, value: "north" },
      { field_id: QUESTION_IDS.multi, value: ["one"] },
      { field_id: QUESTION_IDS.boolean, value: false },
    ]);
  });

  it.each([
    ["required text", { ...valid, [QUESTION_IDS.short]: "" }, QUESTION_IDS.short],
    ["text minimum", { ...valid, [QUESTION_IDS.short]: "x" }, QUESTION_IDS.short],
    ["text maximum", { ...valid, [QUESTION_IDS.short]: "abcdef" }, QUESTION_IDS.short],
    ["single allowlist", { ...valid, [QUESTION_IDS.single]: "unknown" }, QUESTION_IDS.single],
    ["multi minimum", { ...valid, [QUESTION_IDS.multi]: [] }, QUESTION_IDS.multi],
    ["multi maximum", { ...valid, [QUESTION_IDS.multi]: ["one", "two", "three"] }, QUESTION_IDS.multi],
    ["boolean explicit", { ...valid, [QUESTION_IDS.boolean]: undefined }, QUESTION_IDS.boolean],
  ])("reports %s validation", (_name, values, fieldId) => {
    expect(validateQuestionnaire(fields, values).errors[fieldId]).toBeTruthy();
  });

  it("focuses the first invalid questionnaire control", () => {
    const first = fields[0];
    const second = fields[1];
    document.body.innerHTML = `<input id="${questionnaireControlId(first)}"><textarea id="${questionnaireControlId(second)}"></textarea>`;
    expect(focusFirstQuestionnaireError(fields, { [second.id]: "Invalid" })).toBe(true);
    expect(document.activeElement).toBe(document.getElementById(questionnaireControlId(second)));
  });
});
