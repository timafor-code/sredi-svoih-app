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
          note: "Теилим 72–76",
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
    expect(result.remainder).toEqual(["Праздничная программа"]);
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

  it("accepts established heading, item, Tehillim, Markdown, and whitespace forms", () => {
    const result = parseEventScheduleDescription({
      description: [
        "**25 сентября, пятница**  ",
        "Теилим(72-76)",
        "Теилим (77-78)",
        "Теилим 79-80",
        "Теилим: 81–82",
        "**Теилим 83-84**",
        "9:18 — Первое событие",
        "10:00- Второе событие",
        "11:00 -Третье событие",
        "12:00 Четвертое событие",
        "13:00\u00a0—\u00a0Пятое событие  ",
        "9:7 — Неверное время",
        "24:00 — Неверное время",
        "26 сентября - суббота",
        "10:00 – Шахарит",
        "27 сентября – воскресенье",
      ].join("\n"),
      startDate: "2026-09-25",
      participationOptions: [],
    });

    expect(result.schedule).toEqual({
      version: 1,
      days: [
        {
          date: "2026-09-25",
          label: "пятница",
          note: "Теилим 72–76 · Теилим 77–78 · Теилим 79–80 · Теилим 81–82 · Теилим 83–84",
          items: [
            { time: "09:18", title: "Первое событие", optionId: null },
            { time: "10:00", title: "Второе событие", optionId: null },
            { time: "11:00", title: "Третье событие", optionId: null },
            { time: "12:00", title: "Четвертое событие", optionId: null },
            { time: "13:00", title: "Пятое событие", optionId: null },
          ],
        },
        {
          date: "2026-09-26",
          label: "суббота",
          note: null,
          items: [{ time: "10:00", title: "Шахарит", optionId: null }],
        },
        {
          date: "2026-09-27",
          label: "воскресенье",
          note: null,
          items: [],
        },
      ],
    });
    expect(result.remainder).toEqual(["9:7 — Неверное время", "24:00 — Неверное время"]);
  });

  it("parses the owner's full three-day programme fixture without a remainder", () => {
    const result = parseEventScheduleDescription({
      description: [
        "25 сентября, пятница", "", "Теилим(72-76)", "", "18:00- Минха", "",
        "18:03 — Зажигание праздничных свечей в сукке", "", "18:21 Заход солнца", "",
        "18:30 — Урок по идеям и законам праздника", "", "18:58 Выход звезд", "",
        "19:40 — Маарив.Кабалат Шабат", "", "20:30 — Праздничная трапеза в сукке", "",
        "26 сентября, суббота", "", "Теилим 77-78", "", "9:18 — Самое позднее время чтения Шма", "",
        "10:00- Шахарит", "", "11:00- Алель", "", "11:30- Чтение Торы", "",
        "12:51 — Самое раннее время Минхи", "", "12:30- Мусаф. Благословение коэнов", "",
        "13:30- Праздничная трапеза в сукке", "", "17:30 -Минха", "", "18:19 Заход солнца", "",
        "18:30 Урок раввина", "", "19:13 -Зажигание праздничных свечей (от горящего огня)", "",
        "19:30 — Маарив", "", "20:00 — Праздничная трапеза в сукке", "",
        "27 сентября, воскресенье", "", "Теилим 79-82", "", "10:00- Шахарит", "",
        "11:00 — Алель", "", "11:30 — Чтение Торы", "", "12:30- Мусаф. Благословение коэнов", "",
        "13:30 Праздничная трапеза в сукке", "", "14:30- Минха", "", "18:19 Заход солнца", "",
        "19:11- Маарив . Исход праздника", "", "19:15 — Авдала",
      ].join("\n"),
      startDate: "2026-09-25",
      participationOptions: [],
    });

    expect(result.schedule?.days.map((day) => ({
      date: day.date,
      label: day.label,
      note: day.note,
      items: day.items.map((item) => `${item.time} ${item.title}`),
    }))).toEqual([
      {
        date: "2026-09-25",
        label: "пятница",
        note: "Теилим 72–76",
        items: [
          "18:00 Минха", "18:03 Зажигание праздничных свечей в сукке", "18:21 Заход солнца",
          "18:30 Урок по идеям и законам праздника", "18:58 Выход звезд", "19:40 Маарив.Кабалат Шабат",
          "20:30 Праздничная трапеза в сукке",
        ],
      },
      {
        date: "2026-09-26",
        label: "суббота",
        note: "Теилим 77–78",
        items: [
          "09:18 Самое позднее время чтения Шма", "10:00 Шахарит", "11:00 Алель", "11:30 Чтение Торы",
          "12:51 Самое раннее время Минхи", "12:30 Мусаф. Благословение коэнов", "13:30 Праздничная трапеза в сукке",
          "17:30 Минха", "18:19 Заход солнца", "18:30 Урок раввина",
          "19:13 Зажигание праздничных свечей (от горящего огня)", "19:30 Маарив", "20:00 Праздничная трапеза в сукке",
        ],
      },
      {
        date: "2026-09-27",
        label: "воскресенье",
        note: "Теилим 79–82",
        items: [
          "10:00 Шахарит", "11:00 Алель", "11:30 Чтение Торы", "12:30 Мусаф. Благословение коэнов",
          "13:30 Праздничная трапеза в сукке", "14:30 Минха", "18:19 Заход солнца",
          "19:11 Маарив . Исход праздника", "19:15 Авдала",
        ],
      },
    ]);
    expect(result.remainder).toEqual([]);
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
