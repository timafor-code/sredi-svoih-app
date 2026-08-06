from __future__ import annotations

from collections.abc import AsyncIterator, Sequence
from contextlib import asynccontextmanager
from datetime import UTC, datetime
from uuid import UUID

from fastapi import HTTPException, status as http_status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.core import (
    AppUser,
    CommunityMembership,
    Event,
    PrivacyRequest,
    WebRegistrationIdentityConflict,
    WebRegistrationIntent,
)
from app.schemas.privacy import TERMINAL_PRIVACY_REQUEST_STATUSES
from app.schemas.web_registration_operations import (
    AdminWebRegistrationConflictResponse,
    AdminWebRegistrationConflictUpdateRequest,
    AdminWebRegistrationOperationsSummaryResponse,
)
from app.services.authorization import ACTIVE_STATUS, ADMIN_ROLES

DEFAULT_PAGE_LIMIT = 50
MAX_PAGE_LIMIT = 200
OPEN_PRIVACY_REQUEST_STATUSES = frozenset({"open", "reviewed"})


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


def _forbidden() -> HTTPException:
    return _error(
        http_status.HTTP_403_FORBIDDEN,
        "forbidden",
        "Admin permission required",
    )


def _not_found() -> HTTPException:
    return _error(
        http_status.HTTP_404_NOT_FOUND,
        "not_found",
        "Identity conflict not found",
    )


async def _resolve_admin_community_ids(
    session: AsyncSession,
    current_user: AppUser,
    *,
    community_id: UUID | None = None,
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
    admin_community_ids = list(result)
    if not admin_community_ids:
        raise _forbidden()

    if community_id is None:
        return admin_community_ids
    if community_id not in set(admin_community_ids):
        raise _forbidden()
    return [community_id]


async def get_operations_summary(
    session: AsyncSession,
    current_user: AppUser,
    *,
    community_id: UUID | None = None,
) -> AdminWebRegistrationOperationsSummaryResponse:
    community_ids = await _resolve_admin_community_ids(
        session,
        current_user,
        community_id=community_id,
    )
    now = _now()

    active_email_verification_intents = await session.scalar(
        select(func.count())
        .select_from(WebRegistrationIntent)
        .join(Event, Event.id == WebRegistrationIntent.event_id)
        .where(
            Event.community_id.in_(community_ids),
            WebRegistrationIntent.status == "email_verification_required",
            WebRegistrationIntent.expires_at > now,
        ),
    )
    open_identity_conflicts = await session.scalar(
        select(func.count())
        .select_from(WebRegistrationIdentityConflict)
        .join(
            WebRegistrationIntent,
            WebRegistrationIntent.id
            == WebRegistrationIdentityConflict.registration_intent_id,
        )
        .join(Event, Event.id == WebRegistrationIntent.event_id)
        .where(
            Event.community_id.in_(community_ids),
            WebRegistrationIdentityConflict.status == "open",
        ),
    )
    open_privacy_requests = await session.scalar(
        select(func.count())
        .select_from(PrivacyRequest)
        .where(
            PrivacyRequest.community_id.in_(community_ids),
            PrivacyRequest.status.in_(OPEN_PRIVACY_REQUEST_STATUSES),
        ),
    )
    overdue_privacy_requests = await session.scalar(
        select(func.count())
        .select_from(PrivacyRequest)
        .where(
            PrivacyRequest.community_id.in_(community_ids),
            PrivacyRequest.status.not_in(TERMINAL_PRIVACY_REQUEST_STATUSES),
            PrivacyRequest.due_at.is_not(None),
            PrivacyRequest.due_at < now,
        ),
    )

    return AdminWebRegistrationOperationsSummaryResponse(
        active_email_verification_intents=int(active_email_verification_intents or 0),
        open_identity_conflicts=int(open_identity_conflicts or 0),
        open_privacy_requests=int(open_privacy_requests or 0),
        overdue_privacy_requests=int(overdue_privacy_requests or 0),
    )


def _conflict_response_from_values(
    *,
    conflict_id: UUID,
    registration_intent_id: UUID,
    category: str,
    status: str,
    email_user_id: UUID | None,
    phone_user_id: UUID | None,
    created_at: datetime,
    resolved_at: datetime | None,
    event_id: UUID,
    occurrence_id: UUID | None,
    intent_status: str,
) -> AdminWebRegistrationConflictResponse:
    return AdminWebRegistrationConflictResponse(
        id=conflict_id,
        registration_intent_id=registration_intent_id,
        category=category,
        status=status,
        email_user_id=email_user_id,
        phone_user_id=phone_user_id,
        created_at=created_at,
        resolved_at=resolved_at,
        event_id=event_id,
        occurrence_id=occurrence_id,
        intent_status=intent_status,
    )


def _conflict_columns():
    return (
        WebRegistrationIdentityConflict.id,
        WebRegistrationIdentityConflict.registration_intent_id,
        WebRegistrationIdentityConflict.category,
        WebRegistrationIdentityConflict.status,
        WebRegistrationIdentityConflict.email_user_id,
        WebRegistrationIdentityConflict.phone_user_id,
        WebRegistrationIdentityConflict.created_at,
        WebRegistrationIdentityConflict.resolved_at,
        WebRegistrationIntent.event_id,
        WebRegistrationIntent.occurrence_id,
        WebRegistrationIntent.status,
    )


def _scoped_conflict_query(community_ids: Sequence[UUID]):
    return (
        select(*_conflict_columns())
        .join(
            WebRegistrationIntent,
            WebRegistrationIntent.id
            == WebRegistrationIdentityConflict.registration_intent_id,
        )
        .join(Event, Event.id == WebRegistrationIntent.event_id)
        .where(Event.community_id.in_(community_ids))
    )


async def list_identity_conflicts(
    session: AsyncSession,
    current_user: AppUser,
    *,
    status: str | None,
    limit: int,
    offset: int,
) -> list[AdminWebRegistrationConflictResponse]:
    community_ids = await _resolve_admin_community_ids(session, current_user)
    query = _scoped_conflict_query(community_ids)
    if status is not None:
        query = query.where(WebRegistrationIdentityConflict.status == status)

    rows = (
        await session.execute(
            query.order_by(
                WebRegistrationIdentityConflict.created_at.desc(),
                WebRegistrationIdentityConflict.id.desc(),
            )
            .limit(limit)
            .offset(offset),
        )
    ).all()
    return [
        _conflict_response_from_values(
            conflict_id=row[0],
            registration_intent_id=row[1],
            category=row[2],
            status=row[3],
            email_user_id=row[4],
            phone_user_id=row[5],
            created_at=row[6],
            resolved_at=row[7],
            event_id=row[8],
            occurrence_id=row[9],
            intent_status=row[10],
        )
        for row in rows
    ]


async def update_identity_conflict(
    session: AsyncSession,
    current_user: AppUser,
    conflict_id: UUID,
    payload: AdminWebRegistrationConflictUpdateRequest,
) -> AdminWebRegistrationConflictResponse:
    community_ids = await _resolve_admin_community_ids(session, current_user)

    async with _transaction_scope(session):
        row = (
            await session.execute(
                select(
                    WebRegistrationIdentityConflict,
                    WebRegistrationIntent.event_id,
                    WebRegistrationIntent.occurrence_id,
                    WebRegistrationIntent.status,
                )
                .join(
                    WebRegistrationIntent,
                    WebRegistrationIntent.id
                    == WebRegistrationIdentityConflict.registration_intent_id,
                )
                .join(Event, Event.id == WebRegistrationIntent.event_id)
                .where(
                    Event.community_id.in_(community_ids),
                    WebRegistrationIdentityConflict.id == conflict_id,
                )
                .with_for_update(of=WebRegistrationIdentityConflict),
            )
        ).one_or_none()
        if row is None:
            raise _not_found()

        conflict = row[0]
        if payload.status == "resolved":
            if conflict.status != "resolved":
                conflict.status = "resolved"
                conflict.resolved_at = _now()
        else:
            conflict.status = "open"
            conflict.resolved_at = None

        await session.flush()
        return _conflict_response_from_values(
            conflict_id=conflict.id,
            registration_intent_id=conflict.registration_intent_id,
            category=conflict.category,
            status=conflict.status,
            email_user_id=conflict.email_user_id,
            phone_user_id=conflict.phone_user_id,
            created_at=conflict.created_at,
            resolved_at=conflict.resolved_at,
            event_id=row[1],
            occurrence_id=row[2],
            intent_status=row[3],
        )
