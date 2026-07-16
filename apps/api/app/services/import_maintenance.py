from __future__ import annotations

from collections import defaultdict
from copy import deepcopy
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Iterable
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.imports import EventImportItem, EventImportSource
from app.importer.dedupe import canonicalize_source_url

OPEN_IMPORT_ITEM_STATUSES = ("new", "error")


@dataclass(frozen=True, slots=True)
class ImportDuplicateMaintenanceSummary:
    reviewed_rows: int
    duplicate_groups: int
    would_change: int
    changed: int


def _now() -> datetime:
    return datetime.now(UTC)


def _safe_keys(item: EventImportItem) -> Iterable[tuple[str, str, str]]:
    if item.external_id:
        yield (str(item.source_id), "external_id", item.external_id)
    canonical_url = canonicalize_source_url(item.source_url)
    if canonical_url:
        yield (str(item.source_id), "canonical_source_url", canonical_url)


def _duplicate_groups(items: list[EventImportItem]) -> list[list[EventImportItem]]:
    parent = list(range(len(items)))

    def find(index: int) -> int:
        while parent[index] != index:
            parent[index] = parent[parent[index]]
            index = parent[index]
        return index

    def union(left: int, right: int) -> None:
        left_root = find(left)
        right_root = find(right)
        if left_root != right_root:
            parent[right_root] = left_root

    first_by_key: dict[tuple[str, str, str], int] = {}
    for index, item in enumerate(items):
        for key in _safe_keys(item):
            previous = first_by_key.setdefault(key, index)
            union(previous, index)

    grouped: dict[int, list[EventImportItem]] = defaultdict(list)
    for index, item in enumerate(items):
        grouped[find(index)].append(item)

    return [
        sorted(group, key=lambda item: (item.created_at, item.id))
        for group in grouped.values()
        if len(group) > 1
    ]


def _mark_ignored(item: EventImportItem) -> None:
    raw_payload = deepcopy(dict(item.raw_payload or {}))
    raw_payload["import_status"] = "ignored"
    raw_payload["import_status_reason"] = "maintenance_exact_duplicate"
    admin_review = raw_payload.get("adminReview")
    raw_payload["adminReview"] = {
        **(admin_review if isinstance(admin_review, dict) else {}),
        "ignoredAt": _now().isoformat().replace("+00:00", "Z"),
        "ignoreReason": "maintenance_exact_duplicate",
    }
    item.status = "ignored"
    item.raw_payload = raw_payload
    item.updated_at = _now()


async def ignore_exact_open_import_duplicates(
    session: AsyncSession,
    *,
    apply: bool,
    community_id: UUID | None = None,
    source_id: UUID | None = None,
) -> ImportDuplicateMaintenanceSummary:
    query = (
        select(EventImportItem)
        .join(EventImportSource, EventImportSource.id == EventImportItem.source_id)
        .where(
            EventImportItem.status.in_(OPEN_IMPORT_ITEM_STATUSES),
            EventImportItem.linked_event_id.is_(None),
        )
        .order_by(EventImportItem.created_at, EventImportItem.id)
    )
    if community_id is not None:
        query = query.where(EventImportSource.community_id == community_id)
    if source_id is not None:
        query = query.where(EventImportItem.source_id == source_id)

    items = list(await session.scalars(query))
    groups = _duplicate_groups(items)
    duplicates = [item for group in groups for item in group[1:]]

    if apply and duplicates:
        for item in duplicates:
            _mark_ignored(item)
        await session.commit()

    return ImportDuplicateMaintenanceSummary(
        reviewed_rows=len(items),
        duplicate_groups=len(groups),
        would_change=len(duplicates),
        changed=len(duplicates) if apply else 0,
    )
