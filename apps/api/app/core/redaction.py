from __future__ import annotations

import re
from typing import Any

_EMAIL_RE = re.compile(r"\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b", re.IGNORECASE)
_URL_RE = re.compile(r"https?://[^\s<>)\]]+", re.IGNORECASE)
_SENSITIVE_LINK_HINT_RE = re.compile(
    r"(code|token|verify|verification|reset|set[-_]?password)",
    re.IGNORECASE,
)
_SECRET_FIELD_RE = re.compile(
    r"\b(?P<label>"
    r"(?:email[-_\s]?verification|verification|verify|password[-_\s]?reset|reset|"
    r"set[-_\s]?password)?[-_\s]?(?:code|token|link)|"
    r"refresh[-_\s]?token|jwt|code|token"
    r")\b(?P<separator>\s*[:=]?\s*)(?P<secret>[^\s,;)\]]+)",
    re.IGNORECASE,
)


def redact_email_address(value: str | None) -> str:
    return "[REDACTED_EMAIL]"


def _redact_sensitive_url(match: re.Match[str]) -> str:
    url = match.group(0)
    if _SENSITIVE_LINK_HINT_RE.search(url):
        return "[REDACTED_LINK]"

    return url


def _redact_secret_field(match: re.Match[str]) -> str:
    return f"{match.group('label')}{match.group('separator')}[REDACTED]"


def redact_for_log(value: Any) -> str:
    text = str(value)
    text = _URL_RE.sub(_redact_sensitive_url, text)
    text = _EMAIL_RE.sub("[REDACTED_EMAIL]", text)
    return _SECRET_FIELD_RE.sub(_redact_secret_field, text)
