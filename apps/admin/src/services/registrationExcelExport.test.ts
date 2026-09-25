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
      ["questionnaire:food", "Еда"], ["questionnaire:notice", "Уведомления"],
    ]);
    expect(columns[0]?.header).toBe("Событие");
  });

  it("maps values by stable field key and formats supported shapes", () => {
    const values = buildQuestionnaireRowValues([
      { fieldKey: "notice", fieldType: "boolean", options: [], value: true },
      {
        fieldKey: "food",
        fieldType: "multi_select",
        options: [{ value: "vegetarian", label: "Вегетарианское" }, { value: "kosher", label: "Кошерное" }],
        value: ["vegetarian", "kosher"],
      },
      { fieldKey: "optional", fieldType: "short_text", options: [], value: null },
    ]);
    expect(values).toEqual({ notice: "Да", food: "Вегетарианское, Кошерное", optional: "" });
    expect(formatQuestionnaireExportValue(false)).toBe("Нет");
  });

  it("keeps the old fixed schema when there are no questions", () => {
    expect(buildExportColumns([]).map((column) => column.header)).toHaveLength(21);
  });

  it("namespaces a colliding questionnaire field key", () => {
    const columns = buildExportColumns([{ fieldKey: "status", label: "Статус анкеты" }]);
    expect(columns.find((column) => column.header === "Статус")?.key).toBe("status");
    expect(columns.at(-1)).toMatchObject({
      header: "Статус анкеты",
      key: "questionnaire:status",
      questionnaireFieldKey: "status",
    });
  });
});
