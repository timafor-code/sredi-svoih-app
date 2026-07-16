from __future__ import annotations

from datetime import UTC, datetime
from hashlib import sha256
from typing import Any
from urllib.parse import urlsplit, urlunsplit

DEDUPE_CONTRACT_VERSION = 1


def checked_at() -> str:
    return (
        datetime.now(UTC)
        .isoformat(timespec="milliseconds")
        .replace("+00:00", "Z")
    )


def compact_text(value: object | None) -> str:
    return " ".join(str(value or "").replace("\r", "\n").split()).strip()


def normalize_title(value: object | None) -> str:
    return compact_text(value).lower()


def canonicalize_source_url(value: str | None) -> str | None:
    if not value:
        return None

    try:
        parts = urlsplit(value)
    except ValueError:
        return value

    if not parts.scheme or not parts.netloc:
        return value

    return urlunsplit((parts.scheme, parts.netloc, parts.path, "", ""))


def compute_content_hash(
    *,
    title: str | None,
    starts_at: datetime | str | None,
    description: str | None,
) -> str:
    starts_at_text = starts_at.isoformat() if isinstance(starts_at, datetime) else starts_at
    normalized = "\n".join(
        [
            "v1",
            normalize_title(title),
            starts_at_text or "",
            compact_text(description),
        ],
    )
    return f"sha256:{sha256(normalized.encode('utf-8')).hexdigest()}"


def build_dedupe(
    *,
    title: str | None,
    starts_at: datetime | str | None,
    description: str | None,
    source_url: str | None,
    external_id: str | None,
    overrides: dict[str, Any] | None = None,
) -> dict[str, Any]:
    values = overrides or {}
    return {
        "version": DEDUPE_CONTRACT_VERSION,
        "status": values.get("status", "new"),
        "reason": values.get(
            "reason",
            "Parsed item; not yet checked against existing events.",
        ),
        "matchedBy": values.get("matchedBy", []),
        "matchedEventId": values.get("matchedEventId"),
        "matchedImportItemId": values.get("matchedImportItemId"),
        "manualOverride": values.get("manualOverride", False),
        "contentHash": values.get(
            "contentHash",
            compute_content_hash(
                title=title,
                starts_at=starts_at,
                description=description,
            ),
        ),
        "canonicalSourceUrl": values.get(
            "canonicalSourceUrl",
            canonicalize_source_url(source_url),
        ),
        "sourceExternalId": values.get("sourceExternalId", external_id),
        "checkedAt": checked_at(),
    }

def finalize_dedupe(
    base_dedupe: dict[str, Any] | None,
    outcome: dict[str, Any],
) -> dict[str, Any]:
    base = base_dedupe or {}
    return {
        "version": DEDUPE_CONTRACT_VERSION,
        "status": outcome["status"],
        "reason": outcome["reason"],
        "matchedBy": outcome.get("matchedBy", []),
        "matchedEventId": outcome.get("matchedEventId"),
        "matchedImportItemId": outcome.get(
            "matchedImportItemId",
            base.get("matchedImportItemId"),
        ),
        "manualOverride": outcome.get("manualOverride", False),
        "contentHash": base.get("contentHash"),
        "canonicalSourceUrl": base.get("canonicalSourceUrl"),
        "sourceExternalId": base.get("sourceExternalId"),
        "checkedAt": checked_at(),
    }


def no_match_outcome() -> dict[str, Any]:
    return {
        "status": "new",
        "reason": "No existing import item or event matched.",
        "matchedBy": [],
        "matchedEventId": None,
        "matchedImportItemId": None,
        "manualOverride": False,
    }


def duplicate_import_item_outcome(
    import_item_id: object,
    *,
    matched_by: str,
) -> dict[str, Any]:
    return {
        "status": "duplicate",
        "reason": "An existing review item matched this source item.",
        "matchedBy": [matched_by],
        "matchedEventId": None,
        "matchedImportItemId": str(import_item_id),
        "manualOverride": False,
    }


def linked_event_outcome(
    *,
    event_id: object,
    manual_override: bool,
    matched_by: str,
) -> dict[str, Any]:
    if manual_override:
        return {
            "status": "manual_override_skipped",
            "reason": (
                "Matched existing event with manual_override=true; "
                "left event unchanged for review."
            ),
            "matchedBy": [matched_by],
            "matchedEventId": str(event_id),
            "matchedImportItemId": None,
            "manualOverride": True,
        }

    return {
        "status": "linked_existing",
        "reason": f"Matched existing event by {matched_by}.",
        "matchedBy": [matched_by],
        "matchedEventId": str(event_id),
        "matchedImportItemId": None,
        "manualOverride": False,
    }


def possible_duplicate_event_outcome(event_id: object) -> dict[str, Any]:
    return {
        "status": "possible_duplicate",
        "reason": "Matched an existing event by title and starts_at.",
        "matchedBy": ["title_starts_at"],
        "matchedEventId": str(event_id),
        "matchedImportItemId": None,
        "manualOverride": False,
    }


def publish_outcome(
    *,
    event_id: object,
    created: bool,
) -> dict[str, Any]:
    if created:
        return {
            "status": "new",
            "reason": "Created a linked event by explicit publish action.",
            "matchedBy": [],
            "matchedEventId": str(event_id),
            "matchedImportItemId": None,
            "manualOverride": True,
        }

    return {
        "status": "linked_existing",
        "reason": "Linked or updated an existing event by explicit publish action.",
        "matchedBy": ["linked_event_id"],
        "matchedEventId": str(event_id),
        "matchedImportItemId": None,
        "manualOverride": True,
    }
