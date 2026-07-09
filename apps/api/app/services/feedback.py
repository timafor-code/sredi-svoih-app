from __future__ import annotations

from collections.abc import AsyncIterator, Sequence
from contextlib import asynccontextmanager
from uuid import UUID

from fastapi import HTTPException, status as http_status
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.core import AdminFeedback, AppUser
from app.schemas.feedback import AdminFeedbackCreateRequest
from app.services.admin_events import resolve_manageable_community_ids


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


def _error(status_code: int, code: str, message: str) -> HTTPException:
    return HTTPException(
        status_code=status_code,
        detail={"code": code, "message": message},
    )


def _forbidden(message: str = "Admin feedback permission required") -> HTTPException:
    return _error(http_status.HTTP_403_FORBIDDEN, "forbidden", message)


def _validation_error(message: str) -> HTTPException:
    return _error(http_status.HTTP_422_UNPROCESSABLE_ENTITY, "validation_error", message)


def _resolve_feedback_community_id(
    payload: AdminFeedbackCreateRequest,
    manageable_community_ids: Sequence[UUID],
) -> UUID:
    if not manageable_community_ids:
        raise _forbidden()

    if payload.community_id is not None:
        if payload.community_id not in set(manageable_community_ids):
            raise _forbidden()
        return payload.community_id

    if len(manageable_community_ids) == 1:
        return manageable_community_ids[0]

    raise _validation_error("community_id is required")


async def create_admin_feedback(
    session: AsyncSession,
    current_user: AppUser,
    payload: AdminFeedbackCreateRequest,
) -> AdminFeedback:
    manageable_community_ids = await resolve_manageable_community_ids(
        session,
        current_user,
    )
    community_id = _resolve_feedback_community_id(payload, manageable_community_ids)

    async with _transaction_scope(session):
        feedback = AdminFeedback(
            community_id=community_id,
            user_id=current_user.id,
            section=payload.section,
            entity_type=payload.entity_type,
            entity_id=payload.entity_id,
            severity=payload.severity,
            message=payload.message,
            status="open",
            user_agent=payload.user_agent,
            url=payload.url,
        )
        session.add(feedback)
        await session.flush()
        await session.refresh(feedback)
        return feedback
