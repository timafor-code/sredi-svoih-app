from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from html.parser import HTMLParser
import ipaddress
import re
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urljoin, urlparse, urlunparse
from urllib.request import HTTPRedirectHandler, Request, build_opener

from app.importer import dedupe

DEFAULT_SOURCE_URL = "https://www.sredisvoih.com/events/"
DEFAULT_SOURCE_KEY = "sredi_svoih_events"
DEFAULT_SOURCE_TITLE = "Sredi Svoih website events"
PARSER_NAME = "sredi_svoih_events"
PARSER_VERSION = "1.2.1-api"
TIMEZONE = "Europe/Moscow"
MOSCOW_TZ = timezone(timedelta(hours=3))
DEFAULT_LOCATION_NAME = "Sredi Svoih"
DEFAULT_ADDRESS = "Moscow, Lva Tolstogo, 14"
DEFAULT_HEADERS = {
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "ru-RU,ru;q=0.9,en;q=0.7",
    "User-Agent": "sredi-svoih-api-events-importer/1.0",
}
FETCH_TIMEOUT_SECONDS = 20
MAX_SAFE_ERROR_LENGTH = 500
ALLOWED_SOURCE_HOSTS = frozenset({"www.sredisvoih.com", "sredisvoih.com"})
EVENTS_PATH_PREFIX = "/events/"

_MONTH_NUMBERS = {
    "января": 1,
    "январь": 1,
    "февраля": 2,
    "февраль": 2,
    "марта": 3,
    "март": 3,
    "апреля": 4,
    "апрель": 4,
    "мая": 5,
    "май": 5,
    "июня": 6,
    "июнь": 6,
    "июля": 7,
    "июль": 7,
    "августа": 8,
    "август": 8,
    "сентября": 9,
    "сентябрь": 9,
    "октября": 10,
    "октябрь": 10,
    "ноября": 11,
    "ноябрь": 11,
    "декабря": 12,
    "декабрь": 12,
}
_MONTH_PATTERN = "|".join(re.escape(month) for month in _MONTH_NUMBERS)


@dataclass(slots=True)
class ParserOptions:
    source_url: str = DEFAULT_SOURCE_URL
    limit: int | None = None
    assume_year: int | None = None


@dataclass(slots=True)
class ParsedDate:
    starts_at: datetime | None
    raw_date_text: str | None
    warning: str | None


@dataclass(slots=True)
class DateSignals:
    has_full_date: bool = False
    has_partial_date: bool = False
    has_time: bool = False
    has_recurring_day_of_week: bool = False
    year: int | None = None
    month: int | None = None
    day: int | None = None
    hour: int | None = None
    minute: int | None = None


@dataclass(slots=True)
class EventCard:
    detail_url: str
    external_id: str
    title: str | None
    image_url: str | None
    short_description: str | None
    raw_category: str | None
    raw_time_text: str | None
    raw_card_payload: dict[str, Any]


@dataclass(slots=True)
class ParsedImportItem:
    external_id: str | None
    source_url: str | None
    title: str | None
    image_url: str | None
    description: str | None
    short_description: str | None
    starts_at: datetime | None
    parsed_location: str | None
    location_name: str | None
    address: str | None
    registration_mode: str
    registration_url: str | None
    category: str
    audience: str | None
    date_confidence: str
    import_review: dict[str, Any] | None
    raw_payload: dict[str, Any]


@dataclass(slots=True)
class ParsedImportItemResult:
    item: ParsedImportItem
    error: str | None = None


@dataclass(slots=True)
class ParsedWebsiteResult:
    found_on_list: int
    items: list[ParsedImportItemResult]


@dataclass(slots=True)
class _HtmlNode:
    tag: str
    attrs: dict[str, str]
    content: list[str | "_HtmlNode"] = field(default_factory=list)


class _TreeBuilder(HTMLParser):
    _VOID_TAGS = {
        "area",
        "base",
        "br",
        "col",
        "embed",
        "hr",
        "img",
        "input",
        "link",
        "meta",
        "param",
        "source",
        "track",
        "wbr",
    }

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.root = _HtmlNode("document", {})
        self._stack = [self.root]

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        normalized_tag = tag.lower()
        if normalized_tag == "br":
            self._stack[-1].content.append("\n")
            return

        node = _HtmlNode(
            normalized_tag,
            {name.lower(): value or "" for name, value in attrs},
        )
        self._stack[-1].content.append(node)
        if normalized_tag not in self._VOID_TAGS:
            self._stack.append(node)

    def handle_startendtag(
        self,
        tag: str,
        attrs: list[tuple[str, str | None]],
    ) -> None:
        self.handle_starttag(tag, attrs)

    def handle_endtag(self, tag: str) -> None:
        normalized_tag = tag.lower()
        for index in range(len(self._stack) - 1, 0, -1):
            if self._stack[index].tag == normalized_tag:
                del self._stack[index:]
                return

    def handle_data(self, data: str) -> None:
        self._stack[-1].content.append(data)


def safe_error_message(error: BaseException | str) -> str:
    message = str(error)
    message = re.sub(r"(?i)(password|token|secret|jwt|key)=\S+", r"\1=<redacted>", message)
    message = re.sub(r"(?i)bearer\s+[a-z0-9._~+/-]+", "Bearer <redacted>", message)
    return compact_text(message)[:MAX_SAFE_ERROR_LENGTH] or "Import parser error"


def clean_text(value: object | None) -> str:
    return (
        str(value or "")
        .replace("\r", "\n")
        .replace("\xa0", " ")
        .replace("\t", " ")
        .strip()
    )


def compact_text(value: object | None) -> str:
    return " ".join(clean_text(value).split()).strip()


def short_text(value: object | None, max_length: int = 240) -> str | None:
    text = compact_text(value)
    if not text:
        return None
    if len(text) <= max_length:
        return text
    return f"{text[: max_length - 3].strip()}..."


def _parse_html(html: str) -> _HtmlNode:
    parser = _TreeBuilder()
    parser.feed(html)
    parser.close()
    return parser.root


def _iter_nodes(node: _HtmlNode):
    yield node
    for child in node.content:
        if isinstance(child, _HtmlNode):
            yield from _iter_nodes(child)


def _find_all(root: _HtmlNode, predicate) -> list[_HtmlNode]:
    return [node for node in _iter_nodes(root) if predicate(node)]


def _find_first(root: _HtmlNode, predicate) -> _HtmlNode | None:
    for node in _iter_nodes(root):
        if predicate(node):
            return node
    return None


def _node_text(node: _HtmlNode | None) -> str:
    if node is None or node.tag in {"script", "style", "svg"}:
        return ""

    parts: list[str] = []
    for child in node.content:
        if isinstance(child, _HtmlNode):
            parts.append(_node_text(child))
        else:
            parts.append(child)
    return clean_text("".join(parts))


def _classes(node: _HtmlNode) -> set[str]:
    return {value for value in node.attrs.get("class", "").split() if value}


def _has_class(node: _HtmlNode, class_name: str) -> bool:
    return class_name in _classes(node)


def _first_text(root: _HtmlNode, tag: str) -> str | None:
    node = _find_first(root, lambda item: item.tag == tag)
    return compact_text(_node_text(node)) or None


def _first_attr(root: _HtmlNode, tag: str, attr: str) -> str | None:
    node = _find_first(root, lambda item: item.tag == tag and item.attrs.get(attr))
    return node.attrs.get(attr) if node is not None else None


def _meta_content(root: _HtmlNode, property_name: str) -> str | None:
    node = _find_first(
        root,
        lambda item: item.tag == "meta"
        and item.attrs.get("property") == property_name
        and item.attrs.get("content"),
    )
    return node.attrs.get("content") if node is not None else None


def absolute_url(value: str | None, base_url: str) -> str | None:
    if not value:
        return None
    try:
        return urljoin(base_url, value)
    except ValueError:
        return None


def _validated_common_url(value: str) -> tuple[Any, str]:
    candidate = clean_text(value)
    if not candidate:
        raise ValueError("Import URL is not allowed")
    try:
        parsed = urlparse(candidate)
    except ValueError as exc:
        raise ValueError("Import URL is not allowed") from exc

    if parsed.scheme.lower() != "https":
        raise ValueError("Import URL must use https")
    if parsed.username or parsed.password:
        raise ValueError("Import URL credentials are not allowed")

    host = (parsed.hostname or "").rstrip(".").lower()
    if not host:
        raise ValueError("Import URL host is not allowed")
    if host == "localhost" or host.endswith((".localhost", ".local", ".internal")):
        raise ValueError("Import URL host is not allowed")

    try:
        ipaddress.ip_address(host)
    except ValueError:
        pass
    else:
        raise ValueError("Import URL host is not allowed")

    if host not in ALLOWED_SOURCE_HOSTS:
        raise ValueError("Import URL host is not allowed")

    try:
        port = parsed.port
    except ValueError as exc:
        raise ValueError("Import URL port is not allowed") from exc
    if port not in (None, 443):
        raise ValueError("Import URL port is not allowed")

    return parsed, host


def validate_import_source_url(value: str) -> str:
    parsed, host = _validated_common_url(value)
    if parsed.path.rstrip("/") != "/events" or parsed.query or parsed.fragment:
        raise ValueError("Import source URL is not allowed")
    return urlunparse(("https", host, EVENTS_PATH_PREFIX, "", "", ""))


def validate_import_detail_url(value: str, source_url: str | None = None) -> str:
    if source_url is not None:
        validate_import_source_url(source_url)

    parsed, host = _validated_common_url(value)
    path = parsed.path or ""
    if (
        not path.startswith(EVENTS_PATH_PREFIX)
        or path.rstrip("/") == "/events"
        or parsed.query
    ):
        raise ValueError("Import detail URL is not allowed")
    return urlunparse(("https", host, path, "", "", ""))


def safe_detail_url(value: str | None, source_url: str) -> str | None:
    absolute = absolute_url(value, source_url)
    if absolute is None:
        return None
    try:
        return validate_import_detail_url(absolute, source_url=source_url)
    except ValueError:
        return None


def _same_host(url: str, source_url: str) -> bool:
    return urlparse(url).netloc == urlparse(source_url).netloc


def _is_events_index_url(url: str) -> bool:
    return urlparse(url).path.rstrip("/") in {"", "/events"}


def _source_external_id_from_url(source_url: str) -> str:
    parsed = urlparse(source_url)
    parts = [part for part in parsed.path.split("/") if part]
    slug = parts[-1] if parts else ""
    if slug and slug.lower() != "events":
        return slug.lower()
    return dedupe.compute_content_hash(
        title=source_url,
        starts_at=None,
        description=None,
    ).removeprefix("sha256:")[:16]


def normalize_title(title: object | None) -> str:
    text = compact_text(title)
    text = re.sub(r"\s+[|—-]\s+Среди\s+Своих$", "", text, flags=re.IGNORECASE)
    text = re.sub(
        r"\s+[|—-]\s+Еврейская\s+община.*$",
        "",
        text,
        flags=re.IGNORECASE,
    )
    return text.strip()


def _validated_fetch_url(
    url: str,
    *,
    source_url: str | None,
    allow_index: bool,
) -> str:
    if allow_index:
        return validate_import_source_url(url)
    return validate_import_detail_url(url, source_url=source_url)


class _SafeRedirectHandler(HTTPRedirectHandler):
    def __init__(self, *, source_url: str | None, allow_index: bool) -> None:
        self.source_url = source_url
        self.allow_index = allow_index
        super().__init__()

    def redirect_request(self, req, fp, code, msg, headers, newurl):  # type: ignore[no-untyped-def]
        _validated_fetch_url(
            newurl,
            source_url=self.source_url,
            allow_index=self.allow_index,
        )
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def fetch_html(
    url: str,
    *,
    source_url: str | None = None,
    allow_index: bool = False,
) -> str:
    try:
        canonical_url = _validated_fetch_url(
            url,
            source_url=source_url,
            allow_index=allow_index,
        )
    except ValueError as exc:
        raise RuntimeError("Import URL is not allowed") from exc

    request = Request(canonical_url, headers=DEFAULT_HEADERS)
    opener = build_opener(
        _SafeRedirectHandler(source_url=source_url, allow_index=allow_index),
    )
    try:
        with opener.open(request, timeout=FETCH_TIMEOUT_SECONDS) as response:
            _validated_fetch_url(
                response.geturl(),
                source_url=source_url,
                allow_index=allow_index,
            )
            charset = response.headers.get_content_charset() or "utf-8"
            return response.read().decode(charset, errors="replace")
    except HTTPError as exc:
        raise RuntimeError(f"HTTP {exc.code} while fetching source page") from exc
    except URLError as exc:
        raise RuntimeError(f"Could not fetch source page: {exc.reason}") from exc
    except ValueError as exc:
        raise RuntimeError("Import URL is not allowed") from exc


def parse_list_page(html: str, source_url: str) -> list[EventCard]:
    root = _parse_html(html)
    cards: list[EventCard] = []
    card_nodes = _find_all(root, lambda node: _has_class(node, "events__event"))

    for card_node in card_nodes:
        link = _find_first(
            card_node,
            lambda node: node.tag == "a"
            and (
                _has_class(node, "events__event__link")
                or "/events/" in node.attrs.get("href", "")
            ),
        )
        detail_href = link.attrs.get("href") if link is not None else None
        detail_url = safe_detail_url(detail_href, source_url)
        if not detail_url or _is_events_index_url(detail_url):
            continue

        image_src = _first_attr(card_node, "img", "src")
        h5_title = _first_text(card_node, "h5")
        image_alt = _first_attr(card_node, "img", "alt")
        link_text = compact_text(_node_text(link)) if link is not None else ""
        hidden = _find_first(card_node, lambda node: _has_class(node, "events__event__hidden"))
        raw_short_text = _node_text(hidden)
        data_tab_content = card_node.attrs.get("data-tab-content")
        raw_category = " ".join(
            part
            for part in compact_text(data_tab_content).split()
            if part.lower() != "all"
        ) or None
        time_node = _find_first(card_node, lambda node: _has_class(node, "time"))
        time_text = compact_text(_node_text(time_node)) or None
        title = normalize_title(h5_title or image_alt or link_text)

        cards.append(
            EventCard(
                detail_url=detail_url,
                external_id=_source_external_id_from_url(detail_url),
                title=title or None,
                image_url=absolute_url(image_src, source_url),
                short_description=short_text(raw_short_text),
                raw_category=raw_category,
                raw_time_text=time_text,
                raw_card_payload={
                    "element_id": card_node.attrs.get("id"),
                    "data_tab_content": data_tab_content,
                    "detail_href": detail_href,
                    "detail_url": detail_url,
                    "image_src": image_src,
                    "image_url": absolute_url(image_src, source_url),
                    "title": title or None,
                    "time_text": time_text,
                    "short_text": clean_text(raw_short_text) or None,
                },
            ),
        )

    if not cards:
        for link in _find_all(
            root,
            lambda node: node.tag == "a" and "/events/" in node.attrs.get("href", ""),
        ):
            detail_url = safe_detail_url(link.attrs.get("href"), source_url)
            if not detail_url or _is_events_index_url(detail_url):
                continue

            title = normalize_title(_node_text(link))
            cards.append(
                EventCard(
                    detail_url=detail_url,
                    external_id=_source_external_id_from_url(detail_url),
                    title=title or None,
                    image_url=None,
                    short_description=None,
                    raw_category=None,
                    raw_time_text=None,
                    raw_card_payload={
                        "detail_url": detail_url,
                        "link_text": title or None,
                    },
                ),
            )

    seen: set[str] = set()
    unique_cards: list[EventCard] = []
    for card in cards:
        key = card.external_id or card.detail_url
        if key in seen:
            continue
        seen.add(key)
        unique_cards.append(card)
    return unique_cards


def extract_relevant_date_text(
    description: str | None,
    date_block: str | None,
    list_time_text: str | None,
) -> str:
    candidates = []
    text = compact_text(description)
    if date_block:
        candidates.append(date_block)
    if list_time_text:
        candidates.append(list_time_text)

    label_regex = re.compile(
        r"(?:когда|дата|дата и время|начало(?: занятий)?|расписание|время)\s*:\s*([^.;]+(?:[.;]|$))",
        re.IGNORECASE,
    )
    candidates.extend(match.group(0) for match in label_regex.finditer(text))

    month_regex = re.compile(
        rf".{{0,36}}\b\d{{1,2}}\s+(?:{_MONTH_PATTERN})\b.{{0,56}}",
        re.IGNORECASE,
    )
    candidates.extend(match.group(0) for match in month_regex.finditer(text))

    numeric_date_regex = re.compile(r".{0,36}\b\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\b.{0,56}")
    candidates.extend(match.group(0) for match in numeric_date_regex.finditer(text))

    return " | ".join(compact_text(candidate) for candidate in candidates if compact_text(candidate))


def _find_time_near(text: str, index: int) -> tuple[int, int] | None:
    match = re.search(r"(?:^|\D)([01]?\d|2[0-3])[:.](\d{2})(?:\D|$)", text[index : index + 100])
    if match is None:
        return None
    return int(match.group(1)), int(match.group(2))


def _build_moscow_datetime(
    year: int,
    month: int | None,
    day: int,
    hour: int,
    minute: int,
) -> datetime | None:
    if month is None:
        return None
    try:
        return datetime(year, month, day, hour, minute, tzinfo=MOSCOW_TZ)
    except ValueError:
        return None


def parse_confident_starts_at(raw_date_text: str | None) -> ParsedDate:
    text = compact_text(raw_date_text)
    if not text:
        return ParsedDate(
            starts_at=None,
            raw_date_text=None,
            warning="No date text found on the card or detail page.",
        )

    ru_date_regex = re.compile(
        rf"\b(\d{{1,2}})\s+({_MONTH_PATTERN})\s+(\d{{4}})(?:\s*(?:г\.?|года)?)?",
        re.IGNORECASE,
    )
    ru_match = ru_date_regex.search(text)
    if ru_match is not None:
        time_value = _find_time_near(text, ru_match.start())
        if time_value is None:
            return ParsedDate(
                starts_at=None,
                raw_date_text=text,
                warning="Full date has a year, but no reliable time was found.",
            )
        hour, minute = time_value
        starts_at = _build_moscow_datetime(
            int(ru_match.group(3)),
            _MONTH_NUMBERS.get(ru_match.group(2).lower()),
            int(ru_match.group(1)),
            hour,
            minute,
        )
        return ParsedDate(
            starts_at=starts_at,
            raw_date_text=text,
            warning=None if starts_at else "Parsed date is invalid.",
        )

    numeric_regex = re.compile(r"\b(\d{1,2})[./-](\d{1,2})[./-](\d{4})\b")
    numeric_match = numeric_regex.search(text)
    if numeric_match is not None:
        time_value = _find_time_near(text, numeric_match.start())
        if time_value is None:
            return ParsedDate(
                starts_at=None,
                raw_date_text=text,
                warning="Numeric date has a year, but no reliable time was found.",
            )
        hour, minute = time_value
        starts_at = _build_moscow_datetime(
            int(numeric_match.group(3)),
            int(numeric_match.group(2)),
            int(numeric_match.group(1)),
            hour,
            minute,
        )
        return ParsedDate(
            starts_at=starts_at,
            raw_date_text=text,
            warning=None if starts_at else "Parsed numeric date is invalid.",
        )

    partial_regex = re.compile(rf"\b\d{{1,2}}\s+(?:{_MONTH_PATTERN})\b", re.IGNORECASE)
    has_partial_date = partial_regex.search(text) is not None
    has_time = re.search(r"(?:^|\D)([01]?\d|2[0-3])[:.]\d{2}(?:\D|$)", text) is not None
    return ParsedDate(
        starts_at=None,
        raw_date_text=text,
        warning=(
            "Only partial or recurring date/time text was found."
            if has_partial_date or has_time
            else "No full date with year and time was found."
        ),
    )


def extract_date_signals(
    raw_date_text: str | None,
    raw_time_text: str | None,
) -> DateSignals:
    text = compact_text(raw_date_text)
    time_text = compact_text(raw_time_text)
    all_text = " ".join(part for part in [text, time_text] if part)
    signals = DateSignals()

    ru_full = re.search(
        rf"\b(\d{{1,2}})\s+({_MONTH_PATTERN})\s+(\d{{4}})(?:\s*(?:г\.?|года)?)?",
        text,
        flags=re.IGNORECASE,
    )
    if ru_full:
        signals.has_full_date = True
        signals.day = int(ru_full.group(1))
        signals.month = _MONTH_NUMBERS.get(ru_full.group(2).lower())
        signals.year = int(ru_full.group(3))

    if not signals.has_full_date:
        numeric = re.search(r"\b(\d{1,2})[./-](\d{1,2})[./-](\d{4})\b", text)
        if numeric:
            signals.has_full_date = True
            signals.day = int(numeric.group(1))
            signals.month = int(numeric.group(2))
            signals.year = int(numeric.group(3))

    if not signals.has_full_date:
        partial = re.search(
            rf"\b(\d{{1,2}})\s+({_MONTH_PATTERN})",
            text,
            flags=re.IGNORECASE,
        )
        if partial:
            signals.has_partial_date = True
            signals.day = int(partial.group(1))
            signals.month = _MONTH_NUMBERS.get(partial.group(2).lower())

    time_match = re.search(r"(?:^|\D)([01]?\d|2[0-3])[:.](\d{2})(?:\D|$)", all_text)
    if time_match:
        signals.has_time = True
        signals.hour = int(time_match.group(1))
        signals.minute = int(time_match.group(2))

    recurring_dativ = re.search(
        r"(?:^|[\s:,])по\s+(?:понедельникам|вторникам|средам|четвергам|пятницам|субботам|воскресеньям)",
        all_text,
        flags=re.IGNORECASE,
    )
    recurring_every = re.search(
        r"кажд(?:ый|ое|ую)\s+(?:воскресенье|понедельник|вторник|среду|четверг|пятницу|субботу)",
        all_text,
        flags=re.IGNORECASE,
    )
    if recurring_dativ or recurring_every or re.search("шабб?ат", all_text, flags=re.IGNORECASE):
        signals.has_recurring_day_of_week = True

    return signals


def classify_date_confidence(signals: DateSignals) -> str:
    if signals.has_full_date and signals.has_time:
        return "confident"
    if signals.has_full_date or signals.has_partial_date:
        return "partial"
    if signals.has_recurring_day_of_week:
        return "recurring_rule"
    return "none"


def build_import_review(
    signals: DateSignals,
    date_confidence: str,
    parsed_date: ParsedDate,
    options: ParserOptions,
) -> dict[str, Any]:
    suggested_starts_at: str | None = None
    assumed_year: int | None = None
    date_status = "needs_review"

    if date_confidence == "confident":
        date_status = "ready"
        reason = "Full date with year and time found."
    elif date_confidence == "partial":
        if signals.has_partial_date and options.assume_year:
            assumed_year = options.assume_year
            if signals.has_time and signals.month and signals.day:
                suggested = _build_moscow_datetime(
                    options.assume_year,
                    signals.month,
                    signals.day,
                    signals.hour or 0,
                    signals.minute or 0,
                )
                suggested_starts_at = suggested.isoformat() if suggested else None
                reason = (
                    f"Partial date with assumed year {options.assume_year}. "
                    "Not published automatically."
                    if suggested
                    else (
                        f"Partial date with assumed year {options.assume_year}, "
                        "but constructed date is invalid."
                    )
                )
            else:
                reason = (
                    f"Partial date with assumed year {options.assume_year}, "
                    "but no time found. Cannot build starts_at."
                )
        elif signals.has_full_date:
            reason = parsed_date.warning or "Full date found but no reliable time."
        else:
            reason = parsed_date.warning or "Day and month found, but no year."
    elif date_confidence == "recurring_rule":
        reason = "Recurring schedule. No specific start date can be determined automatically."
    else:
        reason = parsed_date.warning or "No usable date or time information found."

    return {
        "dateConfidence": date_confidence,
        "dateStatus": date_status,
        "reason": reason,
        "rawDateText": parsed_date.raw_date_text,
        "rawTimeText": (
            f"{signals.hour}:{str(signals.minute).zfill(2)}"
            if signals.has_time and signals.hour is not None and signals.minute is not None
            else None
        ),
        "inferred": False,
        "assumedYear": assumed_year,
        "suggestedStartsAt": suggested_starts_at,
        "parserVersion": PARSER_VERSION,
        "needsReview": date_status != "ready",
    }


def _extract_labeled_value(text: str | None, labels: tuple[str, ...]) -> str | None:
    compact = compact_text(text)
    for label in labels:
        match = re.search(rf"{label}\s*:\s*([^.;]+)", compact, flags=re.IGNORECASE)
        if match:
            return compact_text(match.group(1)) or None
    return None


def _normalize_address(value: str | None) -> str:
    address = compact_text(value)
    if not address:
        return DEFAULT_ADDRESS
    lower = address.lower()
    if "льва толстого" in lower and "14" in lower:
        return DEFAULT_ADDRESS
    if "москва" in lower:
        return address
    return f"Moscow, {address}"


def infer_location(description: str | None) -> dict[str, str | None]:
    parsed = _extract_labeled_value(description, ("Место", "Где", "Адрес"))
    return {
        "locationName": DEFAULT_LOCATION_NAME,
        "address": _normalize_address(parsed),
        "parsedLocation": parsed,
    }


def infer_category(title: str | None, raw_category: str | None) -> str:
    text = f"{title or ''} {raw_category or ''}".lower()
    if re.search("шабб?ат", text, flags=re.IGNORECASE):
        return "shabbat"
    if re.search(r"детск|воскресн(?:ая|ой)\s+школ", text, flags=re.IGNORECASE):
        return "children"
    if re.search(
        r"песах|ханук|пурим|шавуот|суккот|симхат|рош\s+а?шана|йом\s+кипур|праздник",
        text,
        flags=re.IGNORECASE,
    ):
        return "holiday"
    if "лекци" in text:
        return "lecture"
    if re.search(r"курс|изучени|иудаизм|истори|тора|философ", text, flags=re.IGNORECASE):
        return "class"
    return "community"


def infer_audience(category: str, title: str | None) -> str:
    text = (title or "").lower()
    if category == "children" or re.search(
        r"детск|воскресн(?:ая|ой)\s+школ",
        text,
        flags=re.IGNORECASE,
    ):
        return "children"
    return "all"


def find_registration_url(root: _HtmlNode, source_url: str, detail_url: str) -> str | None:
    for link in _find_all(root, lambda node: node.tag == "a" and node.attrs.get("href")):
        href = link.attrs.get("href")
        absolute = absolute_url(href, detail_url)
        if not absolute:
            continue
        text = compact_text(_node_text(link)).lower()
        is_registration_text = "запис" in text or "регистрац" in text
        is_external = href is not None and href.startswith(("http://", "https://")) and not _same_host(absolute, source_url)
        is_timepad = "timepad.ru" in absolute.lower()
        if (is_registration_text or is_timepad) and (is_external or is_timepad):
            return absolute
    return None


def parse_detail_page(
    html: str,
    card: EventCard,
    source_url: str,
    options: ParserOptions,
) -> ParsedImportItem:
    root = _parse_html(html)
    title = normalize_title(
        _first_text(root, "h1")
        or _meta_content(root, "og:title")
        or _first_text(root, "title")
        or card.title
    )
    head = _find_first(root, lambda node: _has_class(node, "event-page__head"))
    detail_h4 = _find_first(head, lambda node: node.tag == "h4") if head else None
    description = _node_text(detail_h4) or card.short_description or None
    image_url = absolute_url(
        (_first_attr(head, "img", "src") if head else None)
        or _meta_content(root, "og:image")
        or card.image_url,
        source_url,
    )
    date_node = _find_first(root, lambda node: _has_class(node, "event-page__head__date"))
    date_block = compact_text(_node_text(date_node)) or None
    raw_date_text = extract_relevant_date_text(description, date_block, card.raw_time_text)
    parsed_date = parse_confident_starts_at(raw_date_text)
    signals = extract_date_signals(parsed_date.raw_date_text, card.raw_time_text)
    date_confidence = classify_date_confidence(signals)
    if parsed_date.starts_at is not None:
        date_confidence = "confident"

    category = infer_category(title, card.raw_category)
    audience = infer_audience(category, title)
    location = infer_location(description)
    registration_url = find_registration_url(root, source_url, card.detail_url)
    import_review = build_import_review(signals, date_confidence, parsed_date, options)
    import_review["dedupe"] = dedupe.build_dedupe(
        title=title,
        starts_at=parsed_date.starts_at,
        description=description,
        source_url=card.detail_url,
        external_id=card.external_id,
    )

    raw_payload = {
        "parser_name": PARSER_NAME,
        "parser_version": PARSER_VERSION,
        "card": card.raw_card_payload,
        "detail": {
            "source_url": card.detail_url,
            "title": title,
            "image_url": image_url,
            "date_text": date_block,
            "description": description,
            "registration_url": registration_url,
        },
        "parsed": {
            "external_id": card.external_id,
            "title": title,
            "starts_at": parsed_date.starts_at.isoformat() if parsed_date.starts_at else None,
            "raw_date_text": parsed_date.raw_date_text,
            "date_warning": parsed_date.warning,
            "location_name": location["locationName"],
            "address": location["address"],
            "parsed_location": location["parsedLocation"],
            "category": category,
            "audience": audience,
            "registration_mode": "external_link" if registration_url else "none",
            "registration_url": registration_url,
            "image_url": image_url,
        },
        "importReview": import_review,
    }

    return ParsedImportItem(
        external_id=card.external_id,
        source_url=card.detail_url,
        title=title,
        image_url=image_url,
        description=description,
        short_description=short_text(description or card.short_description or title),
        starts_at=parsed_date.starts_at,
        parsed_location=location["parsedLocation"],
        location_name=location["locationName"],
        address=location["address"],
        registration_mode="external_link" if registration_url else "none",
        registration_url=registration_url,
        category=category,
        audience=audience,
        date_confidence=date_confidence,
        import_review=import_review,
        raw_payload=raw_payload,
    )


def _error_item(card: EventCard, error: BaseException | str) -> ParsedImportItem:
    message = safe_error_message(error)
    baseline_dedupe = dedupe.build_dedupe(
        title=card.title,
        starts_at=None,
        description=None,
        source_url=card.detail_url,
        external_id=card.external_id,
        overrides={"status": "error", "reason": message},
    )
    import_review = {
        "dateConfidence": "none",
        "dateStatus": "needs_review",
        "reason": message,
        "rawDateText": None,
        "rawTimeText": card.raw_time_text,
        "inferred": False,
        "assumedYear": None,
        "suggestedStartsAt": None,
        "parserVersion": PARSER_VERSION,
        "needsReview": True,
        "dedupe": baseline_dedupe,
    }
    return ParsedImportItem(
        external_id=card.external_id,
        source_url=card.detail_url,
        title=card.title or card.detail_url,
        image_url=card.image_url,
        description=None,
        short_description=card.short_description,
        starts_at=None,
        parsed_location=None,
        location_name=None,
        address=None,
        registration_mode="none",
        registration_url=None,
        category="community",
        audience="all",
        date_confidence="none",
        import_review=import_review,
        raw_payload={
            "parser_name": PARSER_NAME,
            "parser_version": PARSER_VERSION,
            "card": card.raw_card_payload,
            "parse_error": message,
            "importReview": import_review,
        },
    )


def parse_website_events(options: ParserOptions) -> ParsedWebsiteResult:
    source_url = validate_import_source_url(options.source_url)
    list_html = fetch_html(source_url, source_url=source_url, allow_index=True)
    cards = parse_list_page(list_html, source_url)
    limited_cards = cards[: options.limit] if options.limit else cards
    parsed_items: list[ParsedImportItemResult] = []

    for card in limited_cards:
        try:
            detail_html = fetch_html(card.detail_url, source_url=source_url)
            parsed_items.append(
                ParsedImportItemResult(
                    item=parse_detail_page(detail_html, card, source_url, options),
                ),
            )
        except Exception as exc:
            message = safe_error_message(exc)
            parsed_items.append(
                ParsedImportItemResult(item=_error_item(card, message), error=message),
            )

    return ParsedWebsiteResult(found_on_list=len(cards), items=parsed_items)
