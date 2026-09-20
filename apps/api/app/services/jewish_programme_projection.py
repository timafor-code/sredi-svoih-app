from __future__ import annotations

from collections.abc import Mapping
from copy import deepcopy
from datetime import UTC, date, datetime, timedelta
import math
import re
from typing import Any, Literal, TypedDict
from zoneinfo import ZoneInfo

from pyluach import dates, parshios


MOSCOW_TIME_ZONE = ZoneInfo("Europe/Moscow")
MOSCOW_LATITUDE = 55.75222
MOSCOW_LONGITUDE = 37.61556

CALENDAR_SYSTEM_KEYS = frozenset({
    "candle_lighting_moscow",
    "sunset_moscow",
    "tzeit_moscow",
    "havdalah_moscow",
})
TORAH_READING_SYSTEM_KEY = "torah_reading_parsha"
TORAH_READING_TITLE = "Чтение Торы"
_DATE_RE = re.compile(r"^(\d{4})-(\d{2})-(\d{2})$")


class _Marker(TypedDict):
    date: str
    system_key: Literal[
        "candle_lighting_moscow",
        "sunset_moscow",
        "tzeit_moscow",
        "havdalah_moscow",
    ]
    time: str
    title: str | None


_PARSHA_RU = {
    0: "Берешит", 1: "Ноах", 2: "Лех-Леха", 3: "Ваейра", 4: "Хаей Сара",
    5: "Толдот", 6: "Вайеце", 7: "Ваишлах", 8: "Вайешев", 9: "Микец",
    10: "Вайигаш", 11: "Ваехи", 12: "Шемот", 13: "Ваэра", 14: "Бо",
    15: "Бешалах", 16: "Итро", 17: "Мишпатим", 18: "Трума", 19: "Тецаве",
    20: "Ки Тиса", 21: "Ваякхел", 22: "Пкудей", 23: "Ваикра", 24: "Цав",
    25: "Шмини", 26: "Тазриа", 27: "Мецора", 28: "Ахарей Мот", 29: "Кдошим",
    30: "Эмор", 31: "Беар", 32: "Бехукотай", 33: "Бемидбар", 34: "Насо",
    35: "Беаалотха", 36: "Шлах", 37: "Корах", 38: "Хукат", 39: "Балак",
    40: "Пинхас", 41: "Матот", 42: "Масей", 43: "Дварим", 44: "Ваэтханан",
    45: "Экев", 46: "Реэ", 47: "Шофтим", 48: "Ки Теце", 49: "Ки Таво",
    50: "Ницавим", 51: "Вайелех", 52: "Аазину", 53: "Везот а-Браха",
}


def project_jewish_programme_for_occurrence(
    *,
    event_kind: str,
    event_starts_at: str | datetime | None = None,
    occurrence_starts_at: str | datetime | None = None,
    schedule: Mapping[str, Any] | None,
) -> dict[str, Any] | None:
    """Project a stored Programme for its authoritative Moscow occurrence.

    The helper has no persistence or rendering concerns.  It mirrors the public
    Web projection's clone-and-replace behavior: normal Programme content is
    retained, while generated Jewish-calendar rows are rebuilt deterministically.
    """
    if schedule is None:
        return None
    if event_kind not in {"shabbat", "holiday"}:
        return schedule  # type: ignore[return-value]

    fail_closed = (
        _remove_system_rows(schedule)
        if event_kind == "shabbat"
        else _remove_calendar_rows(schedule)
    )
    source = occurrence_starts_at if event_kind == "shabbat" else (
        occurrence_starts_at if occurrence_starts_at is not None else event_starts_at
    )
    reference = _moscow_civil_date(source)
    if reference is None:
        return fail_closed

    try:
        markers, parsha_ru = _calendar_markers(event_kind, reference)
    except (ArithmeticError, OverflowError, ValueError):
        return fail_closed
    if not markers:
        return fail_closed

    result = _remove_calendar_rows(schedule)
    days = result["days"]
    if event_kind == "shabbat" and not _retarget_shabbat_days(days, markers):
        return fail_closed

    for marker in markers:
        target = next((day for day in days if day.get("date") == marker["date"]), None)
        item = {
            "option_id": None,
            "system_key": marker["system_key"],
            "time": marker["time"],
            "title": marker["title"] or _marker_title(marker["system_key"]),
        }
        if target is None:
            days.append({"date": marker["date"], "label": None, "note": None, "items": [item]})
        else:
            _insert_calendar_item(target["items"], item)

    if event_kind == "holiday":
        return result

    parsha_title = f"{TORAH_READING_TITLE} — {parsha_ru}" if parsha_ru else TORAH_READING_TITLE
    for day in days:
        for item in day["items"]:
            if item.get("system_key") == TORAH_READING_SYSTEM_KEY:
                item["title"] = parsha_title
    return result


def _remove_system_rows(schedule: Mapping[str, Any]) -> dict[str, Any]:
    return _clone_filtered_schedule(schedule, remove_torah=True)


def _remove_calendar_rows(schedule: Mapping[str, Any]) -> dict[str, Any]:
    return _clone_filtered_schedule(schedule, remove_torah=False)


def _clone_filtered_schedule(schedule: Mapping[str, Any], *, remove_torah: bool) -> dict[str, Any]:
    cloned = deepcopy(dict(schedule))
    cloned["version"] = 1
    days = cloned.get("days")
    if not isinstance(days, list):
        cloned["days"] = []
        return cloned
    for day in days:
        if not isinstance(day, dict):
            continue
        items = day.get("items")
        if not isinstance(items, list):
            day["items"] = []
            continue
        day["items"] = [
            item for item in items
            if not (
                isinstance(item, dict)
                and (
                    item.get("system_key") in CALENDAR_SYSTEM_KEYS
                    or (remove_torah and item.get("system_key") == TORAH_READING_SYSTEM_KEY)
                )
            )
        ]
    return cloned


def _moscow_civil_date(value: str | datetime | None) -> date | None:
    if isinstance(value, datetime):
        instant = value
    elif isinstance(value, str):
        try:
            instant = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return None
    else:
        return None
    if instant.tzinfo is None or instant.utcoffset() is None:
        return None
    return instant.astimezone(MOSCOW_TIME_ZONE).date()


def _calendar_markers(event_kind: str, reference: date) -> tuple[list[_Marker], str | None]:
    if event_kind == "shabbat":
        shabbat = reference + timedelta(days=(5 - reference.weekday()) % 7)
        friday = shabbat - timedelta(days=1)
        markers = _shabbat_markers(friday, shabbat)
        return _sort_markers(markers), _parsha_ru(shabbat)

    holiday = _holiday_range(reference)
    if holiday is None:
        return [], None
    return _sort_markers(_holiday_markers(*holiday)), None


def _shabbat_markers(friday: date, shabbat: date) -> list[_Marker]:
    markers = [
        _daily_marker(friday, "sunset_moscow"),
        _daily_marker(shabbat, "sunset_moscow"),
        _daily_marker(shabbat, "tzeit_moscow"),
        _marker(shabbat, "havdalah_moscow", _solar_time(shabbat, 8.5)),
        _marker(friday, "candle_lighting_moscow", _candle_lighting_time(friday)),
    ]
    if _is_chag_day(shabbat + timedelta(days=1)):
        markers.append(_marker(
            shabbat,
            "candle_lighting_moscow",
            _solar_time(shabbat, 8.5),
            "Зажигание свечей на праздник · Москва",
        ))
    return markers


def _holiday_range(reference: date) -> tuple[date, date] | None:
    start = next((reference + timedelta(days=offset) for offset in (0, 1)
                  if _is_chag_day(reference + timedelta(days=offset))), None)
    if start is None:
        return None
    while _is_chag_day(start - timedelta(days=1)):
        start -= timedelta(days=1)
    end = start
    while _is_chag_day(end + timedelta(days=1)):
        end += timedelta(days=1)
    return start, end


def _holiday_markers(start: date, end: date) -> list[_Marker]:
    markers: list[_Marker] = []
    eve = start - timedelta(days=1)
    markers.extend((_daily_marker(eve, "sunset_moscow"),))
    if eve.weekday() == 5:
        markers.append(_marker(eve, "candle_lighting_moscow", _solar_time(eve, 8.5), "Зажигание свечей на праздник · Москва"))
    else:
        markers.append(_marker(eve, "candle_lighting_moscow", _candle_lighting_time(eve)))

    current = start
    while current <= end:
        markers.append(_daily_marker(current, "sunset_moscow"))
        if current.weekday() == 4:
            markers.append(_marker(current, "candle_lighting_moscow", _candle_lighting_time(current)))
        elif current < end:
            markers.append(_marker(current, "candle_lighting_moscow", _solar_time(current, 8.5), "Зажигание свечей на праздник · Москва"))
        else:
            markers.extend((
                _daily_marker(current, "tzeit_moscow"),
                _marker(current, "havdalah_moscow", _solar_time(current, 8.5), "Исход праздника"),
            ))
        current += timedelta(days=1)
    return markers


def _is_chag_day(civil_date: date) -> bool:
    hebrew_date = dates.GregorianDate(civil_date.year, civil_date.month, civil_date.day).to_heb()
    return hebrew_date.festival(israel=False, include_working_days=False) is not None


def _parsha_ru(shabbat: date) -> str | None:
    hebrew_date = dates.GregorianDate(shabbat.year, shabbat.month, shabbat.day).to_heb()
    reading = parshios.getparsha(hebrew_date, israel=False)
    if not reading:
        return None
    try:
        return "-".join(_PARSHA_RU[index] for index in reading)
    except KeyError:
        return None


def _daily_marker(civil_date: date, system_key: Literal["sunset_moscow", "tzeit_moscow"]) -> _Marker:
    return _marker(civil_date, system_key, _solar_time(civil_date, 0 if system_key == "sunset_moscow" else 8.5))


def _marker(
    civil_date: date,
    system_key: Literal["candle_lighting_moscow", "sunset_moscow", "tzeit_moscow", "havdalah_moscow"],
    time: str,
    title: str | None = None,
) -> _Marker:
    return {"date": civil_date.isoformat(), "system_key": system_key, "time": time, "title": title}


def _solar_time(civil_date: date, depression: float) -> str:
    """Use the same NOAA two-pass sunset calculation and rounding as @hebcal/core."""
    instant = _solar_instant(civil_date, depression) + timedelta(seconds=30)
    local = instant.astimezone(MOSCOW_TIME_ZONE)
    return f"{local.hour:02d}:{local.minute:02d}"


def _candle_lighting_time(civil_date: date) -> str:
    """Match Hebcal's candle rule: truncate sunset, then subtract 18 minutes."""
    instant = _solar_instant(civil_date, 0).replace(second=0, microsecond=0) - timedelta(minutes=18)
    local = instant.astimezone(MOSCOW_TIME_ZONE)
    return f"{local.hour:02d}:{local.minute:02d}"


def _solar_instant(civil_date: date, depression: float) -> datetime:
    zenith = 90.83333333333333 if depression == 0 else 90 + depression
    minutes = _sunset_utc_minutes(civil_date, MOSCOW_LATITUDE, -MOSCOW_LONGITUDE, zenith)
    if not math.isfinite(minutes):
        raise ValueError("Moscow sunset is unavailable")
    return datetime.combine(civil_date, datetime.min.time(), UTC) + timedelta(minutes=minutes)


def _sunset_utc_minutes(civil_date: date, latitude: float, longitude: float, zenith: float) -> float:
    julian_day = _julian_day(civil_date)
    centuries = _julian_centuries(julian_day)
    noon = _solar_noon_utc(centuries, longitude)
    at_noon = _julian_centuries(julian_day + noon / 1440)
    equation = _equation_of_time(at_noon)
    declination = _sun_declination(at_noon)
    angle = _sun_hour_angle_at_sunset(latitude, declination, zenith)
    result = 720 + 4 * (longitude - math.degrees(angle)) - equation
    at_result = _julian_centuries(julian_day + result / 1440)
    equation = _equation_of_time(at_result)
    declination = _sun_declination(at_result)
    angle = _sun_hour_angle_at_sunset(latitude, declination, zenith)
    return 720 + 4 * (longitude - math.degrees(angle)) - equation


def _julian_day(value: date) -> float:
    year, month, day = value.year, value.month, value.day
    if month <= 2:
        year -= 1
        month += 12
    a = math.trunc(year / 100)
    b = math.trunc(2 - a + a / 4)
    return math.floor(365.25 * (year + 4716)) + math.floor(30.6001 * (month + 1)) + day + b - 1524.5


def _julian_centuries(julian_day: float) -> float:
    return (julian_day - 2451545) / 36525


def _solar_noon_utc(centuries: float, longitude: float) -> float:
    noon = _julian_centuries(centuries * 36525 + 2451545 + longitude / 360)
    result = 720 + longitude * 4 - _equation_of_time(noon)
    refined = _julian_centuries(centuries * 36525 + 2451545 - 0.5 + result / 1440)
    return 720 + longitude * 4 - _equation_of_time(refined)


def _sun_hour_angle_at_sunset(latitude: float, declination: float, zenith: float) -> float:
    latitude_rad = math.radians(latitude)
    declination_rad = math.radians(declination)
    value = math.cos(math.radians(zenith)) / (math.cos(latitude_rad) * math.cos(declination_rad)) - math.tan(latitude_rad) * math.tan(declination_rad)
    return -math.acos(value)


def _equation_of_time(centuries: float) -> float:
    epsilon = _obliquity_correction(centuries)
    longitude = _sun_geometric_mean_longitude(centuries)
    eccentricity = 0.016708634 - centuries * (0.000042037 + 0.0000001267 * centuries)
    anomaly = _sun_geometric_mean_anomaly(centuries)
    y = math.tan(math.radians(epsilon) / 2) ** 2
    value = y * math.sin(2 * math.radians(longitude)) - 2 * eccentricity * math.sin(math.radians(anomaly)) + 4 * eccentricity * y * math.sin(math.radians(anomaly)) * math.cos(2 * math.radians(longitude)) - 0.5 * y * y * math.sin(4 * math.radians(longitude)) - 1.25 * eccentricity * eccentricity * math.sin(2 * math.radians(anomaly))
    return math.degrees(value) * 4


def _sun_declination(centuries: float) -> float:
    obliquity = _obliquity_correction(centuries)
    longitude = _sun_apparent_longitude(centuries)
    return math.degrees(math.asin(math.sin(math.radians(obliquity)) * math.sin(math.radians(longitude))))


def _sun_geometric_mean_longitude(centuries: float) -> float:
    return (280.46646 + centuries * (36000.76983 + 0.0003032 * centuries)) % 360


def _sun_geometric_mean_anomaly(centuries: float) -> float:
    return 357.52911 + centuries * (35999.05029 - 0.0001537 * centuries)


def _sun_apparent_longitude(centuries: float) -> float:
    true_longitude = _sun_geometric_mean_longitude(centuries) + _sun_equation_of_center(centuries)
    omega = 125.04 - 1934.136 * centuries
    return true_longitude - 0.00569 - 0.00478 * math.sin(math.radians(omega))


def _sun_equation_of_center(centuries: float) -> float:
    anomaly = math.radians(_sun_geometric_mean_anomaly(centuries))
    return math.sin(anomaly) * (1.914602 - centuries * (0.004817 + 0.000014 * centuries)) + math.sin(2 * anomaly) * (0.019993 - 0.000101 * centuries) + math.sin(3 * anomaly) * 0.000289


def _obliquity_correction(centuries: float) -> float:
    seconds = 21.448 - centuries * (46.815 + centuries * (0.00059 - centuries * 0.001813))
    mean = 23 + (26 + seconds / 60) / 60
    return mean + 0.00256 * math.cos(math.radians(125.04 - 1934.136 * centuries))


def _sort_markers(markers: list[_Marker]) -> list[_Marker]:
    order = {"sunset_moscow": 0, "tzeit_moscow": 1, "havdalah_moscow": 2, "candle_lighting_moscow": 3}
    return sorted(markers, key=lambda marker: (marker["date"], marker["time"], order[marker["system_key"]]))


def _marker_title(system_key: str) -> str:
    return {
        "candle_lighting_moscow": "Зажигание свечей · Москва",
        "sunset_moscow": "Закат",
        "tzeit_moscow": "Выход звезд",
        "havdalah_moscow": "Исход Шабата",
    }[system_key]


def _retarget_shabbat_days(days: list[dict[str, Any]], markers: list[_Marker]) -> bool:
    target_dates = list(dict.fromkeys(marker["date"] for marker in markers))
    if len(target_dates) != 2 or any(_weekday(value) is None for value in target_dates):
        return False
    resolved: dict[str, int] = {}
    used: set[int] = set()
    for target in target_dates:
        matches = [index for index, day in enumerate(days) if day.get("date") == target]
        if len(matches) > 1:
            return False
        if matches:
            resolved[target] = matches[0]
            used.add(matches[0])
    for target in target_dates:
        if target in resolved:
            continue
        weekday = _weekday(target)
        matches = [index for index, day in enumerate(days) if index not in used and _weekday(day.get("date")) == weekday]
        if len(matches) > 1:
            return False
        if matches:
            resolved[target] = matches[0]
            used.add(matches[0])
    friday = next((value for value in target_dates if _weekday(value) == 4), None)
    saturday = next((value for value in target_dates if _weekday(value) == 5), None)
    if friday is None or saturday is None:
        return False
    friday_index, saturday_index = resolved.get(friday), resolved.get(saturday)
    if friday_index is not None and saturday_index is not None:
        old_friday, old_saturday = days[friday_index].get("date"), days[saturday_index].get("date")
        if (old_friday != friday or old_saturday != saturday) and (saturday_index != friday_index + 1 or not _are_consecutive_dates(old_friday, old_saturday)):
            return False
    for target, index in resolved.items():
        days[index]["date"] = target
    return True


def _weekday(value: object) -> int | None:
    if not isinstance(value, str) or _DATE_RE.fullmatch(value) is None:
        return None
    try:
        return date.fromisoformat(value).weekday()
    except ValueError:
        return None


def _are_consecutive_dates(first: object, second: object) -> bool:
    if _weekday(first) is None or _weekday(second) is None:
        return False
    return date.fromisoformat(first) + timedelta(days=1) == date.fromisoformat(second)


def _insert_calendar_item(items: list[dict[str, Any]], item: dict[str, Any]) -> None:
    index = next((index for index, existing in enumerate(items) if existing.get("time", "") > item["time"]), None)
    if index is None:
        items.append(item)
    else:
        items.insert(index, item)
