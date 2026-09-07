import { describe, expect, it } from "vitest";

import { parseEventScheduleDescription } from "./eventScheduleParser";

const MEAL_ID = "11111111-1111-4111-8111-111111111111";

describe("parseEventScheduleDescription", () => {
  it("parses ordered Sukkot-style days, dash variants, and one exact option match", () => {
    const result = parseEventScheduleDescription({
      description: [
        "Праздничная программа",
        "25 сентября — Канун Суккота и Шаббата",
        "18:00 — Минха",
        "20:30 - Праздничная трапеза",
        "Теилим: 72–76",
        "",
        "26 сентября — Первый день Суккота",
        "10:00 – Шахарит",
        "13:30 — Праздничная трапеза",
        "27 сентября",
        "19:15 — Авдала",
      ].join("\n"),
      startDate: "2026-09-25",
      participationOptions: [{ id: MEAL_ID, title: "Праздничная трапеза" }],
    });

    expect(result.schedule).toEqual({
      version: 1,
      days: [
        {
          date: "2026-09-25",
          label: "Канун Суккота и Шаббата",
          note: null,
          items: [
            { time: "18:00", title: "Минха", optionId: null },
            { time: "20:30", title: "Праздничная трапеза", optionId: MEAL_ID },
          ],
        },
        {
          date: "2026-09-26",
          label: "Первый день Суккота",
          note: null,
          items: [
            { time: "10:00", title: "Шахарит", optionId: null },
            { time: "13:30", title: "Праздничная трапеза", optionId: MEAL_ID },
          ],
        },
        {
          date: "2026-09-27",
          label: null,
          note: null,
          items: [{ time: "19:15", title: "Авдала", optionId: null }],
        },
      ],
    });
    expect(result.remainder).toEqual(["Праздничная программа", "Теилим: 72–76"]);
  });

  it("leaves malformed times, text before a day, and unknown day lines in the remainder", () => {
    const result = parseEventScheduleDescription({
      description: "Встречаемся у входа\n25 сентября\n24:00 — Не время\nКомментарий организатора\n18:00 — Минха\n\n",
      startDate: "2026-09-25",
      participationOptions: [],
    });

    expect(result.schedule?.days[0].items).toEqual([{ time: "18:00", title: "Минха", optionId: null }]);
    expect(result.remainder).toEqual(["Встречаемся у входа", "24:00 — Не время", "Комментарий организатора"]);
  });

  it("does not guess zero or ambiguous participation-option matches", () => {
    const zeroMatch = parseEventScheduleDescription({
      description: "25 сентября\n20:30 — Праздничная трапеза",
      startDate: "2026-09-25",
      participationOptions: [],
    });
    const ambiguousMatch = parseEventScheduleDescription({
      description: "25 сентября\n20:30 — Праздничная трапеза",
      startDate: "2026-09-25",
      participationOptions: [
        { id: "first", title: "Праздничная трапеза" },
        { id: "second", title: "праздничная, трапеза" },
      ],
    });

    expect(zeroMatch.schedule?.days[0].items[0].optionId).toBeNull();
    expect(ambiguousMatch.schedule?.days[0].items[0].optionId).toBeNull();
  });

  it("does not persist or mutate its input", () => {
    const participationOptions = [{ id: MEAL_ID, title: "Праздничная трапеза" }];
    const result = parseEventScheduleDescription({
      description: "25 сентября\n20:30 — Праздничная трапеза",
      startDate: "2026-09-25",
      participationOptions,
    });

    expect(participationOptions).toEqual([{ id: MEAL_ID, title: "Праздничная трапеза" }]);
    expect(result.schedule?.days).toHaveLength(1);
  });
});
