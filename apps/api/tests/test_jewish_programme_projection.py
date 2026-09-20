from __future__ import annotations

from copy import deepcopy

from app.services.jewish_programme_projection import project_jewish_programme_for_occurrence


OPTION_ID = "44444444-4444-4444-8444-444444444444"


def _shabbat_schedule() -> dict:
    return {
        "version": 1,
        "days": [
            {"date": "2026-07-10", "label": "Пятница", "note": "Ручная заметка пятницы", "items": [
                {"time": "18:30", "title": "Закат", "option_id": None},
                {"time": "19:00", "title": "Минха", "option_id": OPTION_ID},
                {"time": "00:01", "title": "Старое зажигание", "option_id": None, "system_key": "candle_lighting_moscow"},
                {"time": "00:02", "title": "Старый закат", "option_id": None, "system_key": "sunset_moscow"},
            ]},
            {"date": "2026-07-11", "label": "Шабат", "note": "Ручная заметка субботы", "items": [
                {"time": "11:30", "title": "Старое чтение", "option_id": OPTION_ID, "system_key": "torah_reading_parsha"},
                {"time": "12:00", "title": "Чтение Торы", "option_id": None},
                {"time": "13:00", "title": "Кидуш", "option_id": None},
                {"time": "00:03", "title": "Старый закат", "option_id": None, "system_key": "sunset_moscow"},
                {"time": "00:04", "title": "Старый исход", "option_id": None, "system_key": "havdalah_moscow"},
                {"time": "00:05", "title": "Старые звезды", "option_id": None, "system_key": "tzeit_moscow"},
            ]},
        ],
    }


def _holiday_schedule() -> dict:
    return {
        "version": 1,
        "days": [
            {"date": "2026-09-11", "label": "Канун Рош ха-Шана", "note": "Ручная заметка пятницы", "items": [
                {"time": "18:00", "title": "Минха", "option_id": OPTION_ID},
                {"time": "18:20", "title": "Зажигание свечей", "option_id": None},
                {"time": "00:01", "title": "Старые свечи", "option_id": None, "system_key": "candle_lighting_moscow"},
            ]},
            {"date": "2026-09-12", "label": "Первый день Рош ха-Шана", "note": "Ручная заметка субботы", "items": [
                {"time": "10:00", "title": "Шахарит", "option_id": None},
                {"time": "19:00", "title": "Выход звезд", "option_id": None},
                {"time": "00:02", "title": "Старый закат", "option_id": None, "system_key": "sunset_moscow"},
            ]},
            {"date": "2026-09-13", "label": "Второй день Рош ха-Шана", "note": "Ручная заметка воскресенья", "items": [
                {"time": "10:00", "title": "Шахарит второго дня", "option_id": None},
                {"time": "00:03", "title": "Старый исход", "option_id": None, "system_key": "havdalah_moscow"},
            ]},
        ],
    }


def _holiday_range_schedule(*day_dates: str) -> dict:
    return {
        "version": 1,
        "days": [
            {"date": day_date, "label": None, "note": None, "items": []}
            for day_date in day_dates
        ],
    }


def _system_rows(schedule: dict | None) -> list[dict]:
    return [
        {"date": day["date"], "time": item["time"], "title": item["title"], "system_key": item["system_key"]}
        for day in (schedule or {}).get("days", [])
        for item in day["items"]
        if item.get("system_key")
    ]


def test_projects_normal_shabbat_immutably_with_web_golden_vector() -> None:
    template = _shabbat_schedule()
    expected_template = deepcopy(template)
    result = project_jewish_programme_for_occurrence(event_kind="shabbat", occurrence_starts_at="2026-07-17T18:00:00Z", schedule=template)

    assert [day["date"] for day in result["days"]] == ["2026-07-17", "2026-07-18"]
    assert [{key: day[key] for key in ("label", "note")} for day in result["days"]] == [
        {"label": "Пятница", "note": "Ручная заметка пятницы"},
        {"label": "Шабат", "note": "Ручная заметка субботы"},
    ]
    assert [row for row in _system_rows(result) if row["system_key"] != "torah_reading_parsha"] == [
        {"date": "2026-07-17", "time": "20:43", "title": "Зажигание свечей · Москва", "system_key": "candle_lighting_moscow"},
        {"date": "2026-07-17", "time": "21:02", "title": "Закат", "system_key": "sunset_moscow"},
        {"date": "2026-07-18", "time": "21:00", "title": "Закат", "system_key": "sunset_moscow"},
        {"date": "2026-07-18", "time": "22:25", "title": "Выход звезд", "system_key": "tzeit_moscow"},
        {"date": "2026-07-18", "time": "22:25", "title": "Исход Шабата", "system_key": "havdalah_moscow"},
    ]
    assert {row["title"] for row in _system_rows(result)} >= {"Чтение Торы — Дварим"}
    assert result["days"][0]["items"][0:2] == expected_template["days"][0]["items"][0:2]
    saturday_calendar = [item for item in result["days"][1]["items"] if item.get("system_key") != "torah_reading_parsha" and item.get("system_key")]
    assert [(item["system_key"], item["time"]) for item in saturday_calendar] == [
        ("sunset_moscow", "21:00"),
        ("tzeit_moscow", "22:25"),
        ("havdalah_moscow", "22:25"),
    ]
    assert [item["title"] for item in result["days"][1]["items"] if not item.get("system_key")] == ["Чтение Торы", "Кидуш"]
    assert template == expected_template


def test_adjacent_and_special_shabbat_parsha_vectors() -> None:
    first = project_jewish_programme_for_occurrence(event_kind="shabbat", occurrence_starts_at="2026-07-10T18:00:00+03:00", schedule=_shabbat_schedule())
    special = project_jewish_programme_for_occurrence(event_kind="shabbat", occurrence_starts_at="2026-09-12T12:00:00+03:00", schedule=_shabbat_schedule())

    assert [day["date"] for day in first["days"]] == ["2026-07-10", "2026-07-11"]
    assert any(row["title"] == "Чтение Торы — Матот-Масей" for row in _system_rows(first))
    assert any(row["title"] == "Чтение Торы" for row in _system_rows(special))


def test_shabbat_yom_tov_transition_keeps_manual_avdala() -> None:
    template = _shabbat_schedule()
    template["days"][1]["items"].append({"time": "20:15", "title": "Авдала", "option_id": None})
    result = project_jewish_programme_for_occurrence(event_kind="shabbat", occurrence_starts_at="2026-09-12T12:00:00+03:00", schedule=template)

    assert [row for row in _system_rows(result) if row["date"] == "2026-09-12" and row["system_key"] != "torah_reading_parsha"] == [
        {"date": "2026-09-12", "time": "18:55", "title": "Закат", "system_key": "sunset_moscow"},
        {"date": "2026-09-12", "time": "19:52", "title": "Выход звезд", "system_key": "tzeit_moscow"},
        {"date": "2026-09-12", "time": "19:52", "title": "Исход Шабата", "system_key": "havdalah_moscow"},
        {"date": "2026-09-12", "time": "19:52", "title": "Зажигание свечей на праздник · Москва", "system_key": "candle_lighting_moscow"},
    ]
    assert {"time": "20:15", "title": "Авдала", "option_id": None} in next(day for day in result["days"] if day["date"] == "2026-09-12")["items"]


def test_projects_fixed_holiday_idempotently_with_web_golden_vector() -> None:
    template = _holiday_schedule()
    original = deepcopy(template)
    input = {"event_kind": "holiday", "event_starts_at": "2026-09-11T18:00:00+03:00", "schedule": template}
    first = project_jewish_programme_for_occurrence(**input)
    second = project_jewish_programme_for_occurrence(**{**input, "schedule": first})

    assert [day["date"] for day in first["days"]] == ["2026-09-11", "2026-09-12", "2026-09-13"]
    assert [row for row in _system_rows(first) if row["system_key"] != "torah_reading_parsha"] == [
        {"date": "2026-09-11", "time": "18:39", "title": "Зажигание свечей · Москва", "system_key": "candle_lighting_moscow"},
        {"date": "2026-09-11", "time": "18:58", "title": "Закат", "system_key": "sunset_moscow"},
        {"date": "2026-09-12", "time": "18:55", "title": "Закат", "system_key": "sunset_moscow"},
        {"date": "2026-09-12", "time": "19:52", "title": "Зажигание свечей на праздник · Москва", "system_key": "candle_lighting_moscow"},
        {"date": "2026-09-13", "time": "18:53", "title": "Закат", "system_key": "sunset_moscow"},
        {"date": "2026-09-13", "time": "19:49", "title": "Выход звезд", "system_key": "tzeit_moscow"},
        {"date": "2026-09-13", "time": "19:49", "title": "Исход праздника", "system_key": "havdalah_moscow"},
    ]
    assert first == second
    assert template == original


def test_holiday_occurrence_overrides_event_start_and_preserves_manual_content() -> None:
    result = project_jewish_programme_for_occurrence(
        event_kind="holiday",
        event_starts_at="2026-08-01T18:00:00+03:00",
        occurrence_starts_at="2026-09-11T18:00:00+03:00",
        schedule=_holiday_schedule(),
    )
    assert any(row["date"] == "2026-09-12" and row["system_key"] == "candle_lighting_moscow" for row in _system_rows(result))
    assert {"time": "19:00", "title": "Выход звезд", "option_id": None} in result["days"][1]["items"]


def test_shavuot_intermediate_friday_uses_ordinary_shabbat_candle_boundary() -> None:
    result = project_jewish_programme_for_occurrence(
        event_kind="holiday",
        event_starts_at="2026-05-22T18:00:00+03:00",
        schedule=_holiday_range_schedule("2026-05-21", "2026-05-22", "2026-05-23"),
    )

    friday_rows = [row for row in _system_rows(result) if row["date"] == "2026-05-22"]
    assert friday_rows == [
        {"date": "2026-05-22", "time": "20:29", "title": "Зажигание свечей · Москва", "system_key": "candle_lighting_moscow"},
        {"date": "2026-05-22", "time": "20:47", "title": "Закат", "system_key": "sunset_moscow"},
    ]
    assert all(row["system_key"] not in {"tzeit_moscow", "havdalah_moscow"} for row in friday_rows)


def test_pesach_final_friday_uses_ordinary_shabbat_candle_boundary() -> None:
    result = project_jewish_programme_for_occurrence(
        event_kind="holiday",
        event_starts_at="2026-04-02T18:00:00+03:00",
        schedule=_holiday_range_schedule("2026-04-01", "2026-04-02", "2026-04-03"),
    )

    friday_rows = [row for row in _system_rows(result) if row["date"] == "2026-04-03"]
    assert friday_rows == [
        {"date": "2026-04-03", "time": "18:53", "title": "Зажигание свечей · Москва", "system_key": "candle_lighting_moscow"},
        {"date": "2026-04-03", "time": "19:11", "title": "Закат", "system_key": "sunset_moscow"},
    ]
    assert all(row["system_key"] not in {"tzeit_moscow", "havdalah_moscow"} for row in friday_rows)


def test_absent_and_unavailable_references_preserve_or_fail_closed_as_required() -> None:
    template = _shabbat_schedule()
    assert project_jewish_programme_for_occurrence(event_kind="course", schedule=template) is template
    assert project_jewish_programme_for_occurrence(event_kind="other", schedule=None) is None
    unavailable = project_jewish_programme_for_occurrence(event_kind="shabbat", occurrence_starts_at=None, schedule=template)
    assert _system_rows(unavailable) == []
    assert {"time": "12:00", "title": "Чтение Торы", "option_id": None} in unavailable["days"][1]["items"]

    holiday_unavailable = project_jewish_programme_for_occurrence(event_kind="holiday", schedule=_holiday_schedule())
    assert _system_rows(holiday_unavailable) == []
    assert {"time": "18:00", "title": "Минха", "option_id": OPTION_ID} in holiday_unavailable["days"][0]["items"]
