from __future__ import annotations

from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.audit import AdminEventAuditEntry

EVENT_WEB_VISIBILITY_CHANGED = "event_web_visibility_changed"
WEB_VISIBILITY_VALUES = frozenset({"disabled", "unlisted", "listed"})


async def record_event_web_visibility_change(
    session: AsyncSession,
    *,
    actor_user_id: UUID,
    event_id: UUID,
    old_visibility: str,
    new_visibility: str,
) -> AdminEventAuditEntry | None:
    if old_visibility not in WEB_VISIBILITY_VALUES:
        raise ValueError("Invalid old web visibility")
    if new_visibility not in WEB_VISIBILITY_VALUES:
        raise ValueError("Invalid new web visibility")
    if old_visibility == new_visibility:
        return None

    entry = AdminEventAuditEntry(
        actor_user_id=actor_user_id,
        event_id=event_id,
        action=EVENT_WEB_VISIBILITY_CHANGED,
        old_state=old_visibility,
        new_state=new_visibility,
    )
    session.add(entry)
    await session.flush()
    return entry
