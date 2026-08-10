from __future__ import annotations

import re
import unicodedata
from collections.abc import Iterator
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as postgresql_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.core import EventPublicSlug

PUBLIC_SLUG_MIN_LENGTH = 2
PUBLIC_SLUG_MAX_LENGTH = 80
PUBLIC_SLUG_ALLOCATION_ATTEMPTS = 1_000
RESERVED_PUBLIC_SLUGS = frozenset(
    {
        "new",
        "admin",
        "api",
        "auth",
        "privacy",
        "support",
        "assets",
        "static",
        "null",
        "undefined",
    },
)

_PUBLIC_SLUG_PATTERN = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
_UUID_PATTERN = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
)
_ABSOLUTE_URL_PATTERN = re.compile(r"^[a-z][a-z0-9+.-]*://", re.IGNORECASE)
_SEPARATORS_PATTERN = re.compile(r"[^a-z0-9]+")
_SHABBAT_WORD_PATTERN = re.compile(r"(?<![а-яё])шабат(?![а-яё])")

_RUSSIAN_TRANSLITERATION = str.maketrans(
    {
        "а": "a",
        "б": "b",
        "в": "v",
        "г": "g",
        "д": "d",
        "е": "e",
        "ё": "yo",
        "ж": "zh",
        "з": "z",
        "и": "i",
        "й": "y",
        "к": "k",
        "л": "l",
        "м": "m",
        "н": "n",
        "о": "o",
        "п": "p",
        "р": "r",
        "с": "s",
        "т": "t",
        "у": "u",
        "ф": "f",
        "х": "kh",
        "ц": "ts",
        "ч": "ch",
        "ш": "sh",
        "щ": "shch",
        "ъ": "",
        "ы": "y",
        "ь": "",
        "э": "e",
        "ю": "yu",
        "я": "ya",
    },
)


class InvalidPublicSlugError(ValueError):
    def __init__(self, reason: str, normalized_slug: str | None) -> None:
        super().__init__(reason)
        self.reason = reason
        self.normalized_slug = normalized_slug


class PublicSlugTakenError(RuntimeError):
    pass


class PublicSlugAllocationError(RuntimeError):
    pass


def normalize_public_slug(value: str) -> str:
    normalized = unicodedata.normalize("NFKC", value).strip().lower()
    normalized = _SHABBAT_WORD_PATTERN.sub("shabbat", normalized)
    transliterated = normalized.translate(_RUSSIAN_TRANSLITERATION)
    return _SEPARATORS_PATTERN.sub("-", transliterated).strip("-")


def _validate_normalized_public_slug(value: str) -> None:
    preview = value or None
    if not value:
        raise InvalidPublicSlugError("empty", preview)
    if len(value) < PUBLIC_SLUG_MIN_LENGTH or len(value) > PUBLIC_SLUG_MAX_LENGTH:
        raise InvalidPublicSlugError("length", preview)
    if not _PUBLIC_SLUG_PATTERN.fullmatch(value):
        raise InvalidPublicSlugError("format", preview)
    if _UUID_PATTERN.fullmatch(value):
        raise InvalidPublicSlugError("uuid", preview)
    if value in RESERVED_PUBLIC_SLUGS:
        raise InvalidPublicSlugError("reserved", preview)


def validate_public_slug(value: str) -> str:
    raw_value = unicodedata.normalize("NFKC", value).strip()
    normalized_slug = normalize_public_slug(raw_value)
    if _ABSOLUTE_URL_PATTERN.match(raw_value) or raw_value.startswith("//"):
        raise InvalidPublicSlugError("absolute_url", normalized_slug or None)
    _validate_normalized_public_slug(normalized_slug)
    return normalized_slug


def fallback_public_slug(event_id: UUID) -> str:
    return f"event-{str(event_id)[:8]}"


def _automatic_slug_base(title: str, event_id: UUID) -> str:
    base = normalize_public_slug(title)
    if not base:
        return fallback_public_slug(event_id)
    return base[:PUBLIC_SLUG_MAX_LENGTH].rstrip("-") or fallback_public_slug(event_id)


def _automatic_slug_candidate(base: str, attempt: int) -> str:
    suffix = "" if attempt == 1 else f"-{attempt}"
    prefix = base[: PUBLIC_SLUG_MAX_LENGTH - len(suffix)].rstrip("-")
    return f"{prefix}{suffix}"


def iter_automatic_public_slug_candidates(
    title: str,
    event_id: UUID,
    *,
    max_attempts: int = PUBLIC_SLUG_ALLOCATION_ATTEMPTS,
) -> Iterator[str]:
    if max_attempts < 1:
        raise ValueError("max_attempts must be positive")

    base = _automatic_slug_base(title, event_id)
    for attempt in range(1, max_attempts + 1):
        candidate = _automatic_slug_candidate(base, attempt)
        try:
            _validate_normalized_public_slug(candidate)
        except InvalidPublicSlugError:
            continue
        yield candidate


async def get_canonical_public_slug(
    session: AsyncSession,
    event_id: UUID,
    *,
    for_update: bool = False,
) -> EventPublicSlug | None:
    query = select(EventPublicSlug).where(
        EventPublicSlug.event_id == event_id,
        EventPublicSlug.is_canonical.is_(True),
    )
    if for_update:
        query = query.with_for_update()
    return await session.scalar(query)


async def assign_automatic_public_slug(
    session: AsyncSession,
    *,
    event_id: UUID,
    title: str,
    created_by: UUID | None,
    max_attempts: int = PUBLIC_SLUG_ALLOCATION_ATTEMPTS,
) -> EventPublicSlug:
    current = await get_canonical_public_slug(session, event_id)
    if current is not None:
        return current

    for candidate in iter_automatic_public_slug_candidates(
        title,
        event_id,
        max_attempts=max_attempts,
    ):
        statement = (
            postgresql_insert(EventPublicSlug)
            .values(
                event_id=event_id,
                slug=candidate,
                is_canonical=True,
                created_by=created_by,
            )
            .on_conflict_do_nothing()
            .returning(EventPublicSlug.id)
        )
        inserted_id = await session.scalar(statement)
        if inserted_id is not None:
            inserted = await session.get(EventPublicSlug, inserted_id)
            assert inserted is not None
            return inserted

    raise PublicSlugAllocationError("Could not allocate a unique public slug")


async def check_public_slug_availability(
    session: AsyncSession,
    *,
    event_id: UUID,
    value: str,
) -> tuple[str, bool]:
    normalized_slug = validate_public_slug(value)
    existing_event_id = await session.scalar(
        select(EventPublicSlug.event_id)
        .where(EventPublicSlug.slug == normalized_slug)
        .limit(1),
    )
    return normalized_slug, existing_event_id is None or existing_event_id == event_id


async def change_canonical_public_slug(
    session: AsyncSession,
    *,
    event_id: UUID,
    value: str,
    created_by: UUID | None,
) -> tuple[EventPublicSlug, str, bool]:
    normalized_slug = validate_public_slug(value)
    current = await get_canonical_public_slug(session, event_id, for_update=True)
    if current is None:
        raise RuntimeError("Event has no canonical public slug")
    if current.slug == normalized_slug:
        return current, current.slug, False

    matching = await session.scalar(
        select(EventPublicSlug)
        .where(EventPublicSlug.slug == normalized_slug)
        .with_for_update(),
    )
    if matching is not None and matching.event_id != event_id:
        raise PublicSlugTakenError("Public slug is already taken")

    old_slug = current.slug
    current.is_canonical = False
    await session.flush()

    if matching is not None:
        matching.is_canonical = True
        await session.flush()
        return matching, old_slug, True

    statement = (
        postgresql_insert(EventPublicSlug)
        .values(
            event_id=event_id,
            slug=normalized_slug,
            is_canonical=True,
            created_by=created_by,
        )
        .on_conflict_do_nothing()
        .returning(EventPublicSlug.id)
    )
    inserted_id = await session.scalar(statement)
    if inserted_id is None:
        raise PublicSlugTakenError("Public slug is already taken")

    inserted = await session.get(EventPublicSlug, inserted_id)
    assert inserted is not None
    return inserted, old_slug, True
