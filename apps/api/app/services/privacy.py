from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import UTC, datetime
from uuid import UUID

from fastapi import HTTPException, status as http_status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.core import AppUser, CommunityMembership, PrivacyRequest
from app.schemas.privacy import (
    AdminPrivacyRequestUpdateRequest,
    PrivacyRequestCreateRequest,
)
from app.services.authorization import ACTIVE_STATUS, ADMIN_ROLES

RESOLVED_STATUSES = frozenset({"resolved", "rejected", "closed"})


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


def _forbidden(message: str = "Privacy request permission required") -> HTTPException:
    return _error(http_status.HTTP_403_FORBIDDEN, "forbidden", message)


def _not_found(message: str = "Privacy request not found") -> HTTPException:
    return _error(http_status.HTTP_404_NOT_FOUND, "not_found", message)


def _validation_error(message: str) -> HTTPException:
    return _error(http_status.HTTP_422_UNPROCESSABLE_ENTITY, "validation_error", message)


async def _resolve_active_membership_community_ids(
    session: AsyncSession,
    current_user: AppUser,
) -> list[UUID]:
    result = await session.scalars(
        select(CommunityMembership.community_id)
        .where(
            CommunityMembership.user_id == current_user.id,
            CommunityMembership.status == ACTIVE_STATUS,
        )
        .order_by(CommunityMembership.community_id),
    )
    return list(result)


async def _resolve_admin_community_ids(
    session: AsyncSession,
    current_user: AppUser,
) -> list[UUID]:
    result = await session.scalars(
        select(CommunityMembership.community_id)
        .where(
            CommunityMembership.user_id == current_user.id,
            CommunityMembership.status == ACTIVE_STATUS,
            CommunityMembership.role.in_(ADMIN_ROLES),
        )
        .order_by(CommunityMembership.community_id),
    )
    return list(result)


async def _resolve_request_community_id(
    session: AsyncSession,
    current_user: AppUser,
    payload: PrivacyRequestCreateRequest,
) -> UUID | None:
    membership_community_ids = await _resolve_active_membership_community_ids(
        session,
        current_user,
    )

    if payload.community_id is not None:
        if payload.community_id not in set(membership_community_ids):
            raise _forbidden()
        return payload.community_id

    if len(membership_community_ids) == 1:
        return membership_community_ids[0]

    return None


async def create_privacy_request(
    session: AsyncSession,
    current_user: AppUser,
    payload: PrivacyRequestCreateRequest,
) -> PrivacyRequest:
    community_id = await _resolve_request_community_id(session, current_user, payload)

    async with _transaction_scope(session):
        privacy_request = PrivacyRequest(
            user_id=current_user.id,
            community_id=community_id,
            request_type=payload.request_type,
            message=payload.message,
            status="open",
        )
        session.add(privacy_request)
        await session.flush()
        await session.refresh(privacy_request)
        return privacy_request


async def list_current_user_privacy_requests(
    session: AsyncSession,
    current_user: AppUser,
) -> list[PrivacyRequest]:
    result = await session.scalars(
        select(PrivacyRequest)
        .where(PrivacyRequest.user_id == current_user.id)
        .order_by(PrivacyRequest.created_at.desc(), PrivacyRequest.id.asc()),
    )
    return list(result)


async def list_admin_privacy_requests(
    session: AsyncSession,
    current_user: AppUser,
    *,
    status: str | None = None,
    community_id: UUID | None = None,
) -> list[PrivacyRequest]:
    admin_community_ids = await _resolve_admin_community_ids(session, current_user)
    if not admin_community_ids:
        raise _forbidden()

    if community_id is not None:
        if community_id not in set(admin_community_ids):
            raise _forbidden()
        scoped_community_ids = [community_id]
    else:
        scoped_community_ids = admin_community_ids

    query = select(PrivacyRequest).where(
        PrivacyRequest.community_id.in_(scoped_community_ids),
    )
    if status is not None:
        query = query.where(PrivacyRequest.status == status)

    result = await session.scalars(
        query.order_by(PrivacyRequest.created_at.desc(), PrivacyRequest.id.asc()),
    )
    return list(result)


async def update_admin_privacy_request(
    session: AsyncSession,
    current_user: AppUser,
    request_id: UUID,
    payload: AdminPrivacyRequestUpdateRequest,
) -> PrivacyRequest:
    updates = payload.model_dump(exclude_unset=True)
    if not updates:
        raise _validation_error("at least one field is required")

    if "status" in payload.model_fields_set and updates.get("status") is None:
        raise _validation_error("status must not be null")

    admin_community_ids = await _resolve_admin_community_ids(session, current_user)
    if not admin_community_ids:
        raise _forbidden()

    async with _transaction_scope(session):
        privacy_request = await session.scalar(
            select(PrivacyRequest)
            .where(
                PrivacyRequest.id == request_id,
                PrivacyRequest.community_id.in_(admin_community_ids),
            )
            .with_for_update(),
        )
        if privacy_request is None:
            raise _not_found()

        if "resolution_note" in updates:
            privacy_request.resolution_note = updates["resolution_note"]

        if "status" in updates:
            privacy_request.status = updates["status"]
            if updates["status"] in RESOLVED_STATUSES:
                privacy_request.resolved_at = _now()
                privacy_request.resolved_by = current_user.id
            else:
                privacy_request.resolved_at = None
                privacy_request.resolved_by = None

        privacy_request.updated_at = _now()

        await session.flush()
        await session.refresh(privacy_request)
        return privacy_request
