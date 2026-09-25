import { describe, expect, it } from "vitest";

import {
  buildExportColumns,
  buildQuestionnaireRowValues,
  formatQuestionnaireExportValue,
} from "./registrationExcelExport";

describe("registration questionnaire export", () => {
  it("appends published questions after fixed columns in field order", () => {
    const columns = buildExportColumns([
      { fieldKey: "food", label: "Еда" },
      { fieldKey: "notice", label: "Уведомления" },
    ]);
    expect(columns.slice(-2).map((column) => [column.key, column.header])).toEqual([
      ["food", "Еда"], ["notice", "Уведомления"],
    ]);
    expect(columns[0]?.header).toBe("Событие");
  });

  it("maps values by stable field key and formats supported shapes", () => {
    const values = buildQuestionnaireRowValues([
      { fieldKey: "notice", value: true },
      { fieldKey: "food", value: ["vegetarian", "kosher"] },
      { fieldKey: "optional", value: null },
    ]);
    expect(values).toEqual({ notice: "Да", food: "vegetarian, kosher", optional: "" });
    expect(formatQuestionnaireExportValue(false)).toBe("Нет");
  });

  it("keeps the old fixed schema when there are no questions", () => {
    expect(buildExportColumns([]).map((column) => column.header)).toHaveLength(21);
  });
});
