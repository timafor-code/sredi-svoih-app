from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import UTC, datetime
from uuid import UUID

from fastapi import HTTPException, status as http_status
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.core import AppUser, Community, CommunityEventLocation
from app.schemas.admin_community import (
    AdminCommunityLocationCreateRequest,
    AdminCommunityLocationUpdateRequest,
)
from app.services.authorization import require_admin, require_admin_or_event_manager


@asynccontextmanager
async def _transaction_scope(session: AsyncSession) -> AsyncIterator[None]:
    if session.in_transaction():
        try:
            yield
            await session.commit()
        except Exception:
            await session.rollback()
            raise
        return

    async with session.begin():
        yield


def _now() -> datetime:
    return datetime.now(UTC)


def _error(status_code: int, code: str, message: str) -> HTTPException:
    return HTTPException(
        status_code=status_code,
        detail={"code": code, "message": message},
    )


def _not_found(message: str) -> HTTPException:
    return _error(http_status.HTTP_404_NOT_FOUND, "not_found", message)


def _validation_error(message: str) -> HTTPException:
    return _error(http_status.HTTP_422_UNPROCESSABLE_ENTITY, "validation_error", message)


async def get_admin_community(
    session: AsyncSession,
    current_user: AppUser,
    community_id: UUID,
) -> Community:
    await require_admin_or_event_manager(session, current_user.id, community_id)

    community = await session.get(Community, community_id)
    if community is None:
        raise _not_found("Community not found")

    return community


async def list_admin_community_locations(
    session: AsyncSession,
    current_user: AppUser,
    community_id: UUID,
) -> list[CommunityEventLocation]:
    membership = await require_admin_or_event_manager(
        session,
        current_user.id,
        community_id,
    )

    query = select(CommunityEventLocation).where(
        CommunityEventLocation.community_id == community_id,
    )
    if membership.role != "admin":
        query = query.where(CommunityEventLocation.is_active.is_(True))

    result = await session.scalars(
        query.order_by(
            CommunityEventLocation.is_default.desc(),
            CommunityEventLocation.sort_order.asc(),
            CommunityEventLocation.title.asc(),
            CommunityEventLocation.id.asc(),
        ),
    )
    return list(result)


def _reject_null_patch_values(
    payload: AdminCommunityLocationUpdateRequest,
    updates: dict[str, object],
) -> None:
    for field_name in ("title", "address", "is_default", "is_active", "sort_order"):
        if field_name in payload.model_fields_set and updates.get(field_name) is None:
            raise _validation_error(f"{field_name} must not be null")


async def _unset_other_default_locations(
    session: AsyncSession,
    *,
    community_id: UUID,
    excluding_location_id: UUID | None = None,
) -> None:
    statement = (
        update(CommunityEventLocation)
        .where(
            CommunityEventLocation.community_id == community_id,
            CommunityEventLocation.is_default.is_(True),
        )
        .values(is_default=False, updated_at=_now())
    )
    if excluding_location_id is not None:
        statement = statement.where(CommunityEventLocation.id != excluding_location_id)

    await session.execute(statement)


async def create_admin_community_location(
    session: AsyncSession,
    current_user: AppUser,
    payload: AdminCommunityLocationCreateRequest,
) -> CommunityEventLocation:
    await require_admin(session, current_user.id, payload.community_id)

    async with _transaction_scope(session):
        is_default = payload.is_default
        if not payload.is_active:
            is_default = False

        if is_default:
            await _unset_other_default_locations(
                session,
                community_id=payload.community_id,
            )

        location = CommunityEventLocation(
            community_id=payload.community_id,
            title=payload.title,
            address=payload.address,
            is_default=is_default,
            is_active=payload.is_active,
            sort_order=payload.sort_order,
        )
        session.add(location)
        await session.flush()
        await session.refresh(location)
        return location


async def _lock_admin_community_location(
    session: AsyncSession,
    location_id: UUID,
) -> CommunityEventLocation:
    location = await session.scalar(
        select(CommunityEventLocation)
        .where(CommunityEventLocation.id == location_id)
        .with_for_update(),
    )
    if location is None:
        raise _not_found("Community location not found")

    return location


async def update_admin_community_location(
    session: AsyncSession,
    current_user: AppUser,
    location_id: UUID,
    payload: AdminCommunityLocationUpdateRequest,
) -> CommunityEventLocation:
    updates = payload.model_dump(exclude_unset=True)
    _reject_null_patch_values(payload, updates)

    async with _transaction_scope(session):
        location = await _lock_admin_community_location(session, location_id)
        await require_admin(session, current_user.id, location.community_id)

        next_is_active = bool(updates.get("is_active", location.is_active))
        next_is_default = bool(updates.get("is_default", location.is_default))
        if not next_is_active:
            next_is_default = False

        if next_is_default and not location.is_default:
            await _unset_other_default_locations(
                session,
                community_id=location.community_id,
                excluding_location_id=location.id,
            )

        for field_name, value in updates.items():
            setattr(location, field_name, value)

        location.is_default = next_is_default
        location.is_active = next_is_active
        location.updated_at = _now()

        await session.flush()
        await session.refresh(location)
        return location


async def archive_admin_community_location(
    session: AsyncSession,
    current_user: AppUser,
    location_id: UUID,
) -> CommunityEventLocation:
    async with _transaction_scope(session):
        location = await _lock_admin_community_location(session, location_id)
        await require_admin(session, current_user.id, location.community_id)

        location.is_active = False
        location.is_default = False
        location.updated_at = _now()

        await session.flush()
        await session.refresh(location)
        return location
