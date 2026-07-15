from __future__ import annotations

from collections.abc import AsyncIterator, Sequence
from contextlib import asynccontextmanager
from datetime import UTC, datetime
from uuid import UUID

from fastapi import HTTPException, status as http_status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.core import AdminFeedback, AppUser, CommunityMembership
from app.schemas.feedback import (
    AdminFeedbackCreateRequest,
    AdminFeedbackStatusUpdateRequest,
)
from app.services.admin_events import resolve_manageable_community_ids
from app.services.authorization import ACTIVE_STATUS, ADMIN_ROLES

DEFAULT_PAGE_LIMIT = 50
MAX_PAGE_LIMIT = 100

_FEEDBACK_STATUSES = frozenset({"open", "reviewed", "resolved", "closed"})
_FEEDBACK_SEVERITIES = frozenset({"note", "issue", "blocker", "idea"})


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


def _not_found(message: str = "Feedback not found") -> HTTPException:
    return _error(http_status.HTTP_404_NOT_FOUND, "not_found", message)


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


def _normalize_filter(
    value: str | None,
    *,
    allowed_values: frozenset[str],
    field_name: str,
) -> str | None:
    if value is None:
        return None

    normalized = value.strip().lower()
    if not normalized or normalized == "all":
        return None
    if normalized not in allowed_values:
        raise _validation_error(f"Invalid feedback {field_name}")
    return normalized


def _normalize_section_filter(section: str | None) -> str | None:
    if section is None:
        return None

    normalized = section.strip()
    return normalized or None


def _normalize_pagination(*, limit: int, offset: int) -> tuple[int, int]:
    if limit < 1:
        raise _validation_error("limit must be at least 1")
    if offset < 0:
        raise _validation_error("offset must not be negative")
    return min(limit, MAX_PAGE_LIMIT), offset


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


def _require_admin_communities(community_ids: Sequence[UUID]) -> None:
    if not community_ids:
        raise _forbidden()


def _now() -> datetime:
    return datetime.now(UTC)


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


async def list_admin_feedback(
    session: AsyncSession,
    current_user: AppUser,
    *,
    status: str | None = None,
    severity: str | None = None,
    section: str | None = None,
    limit: int = DEFAULT_PAGE_LIMIT,
    offset: int = 0,
) -> tuple[list[AdminFeedback], int, int, int]:
    admin_community_ids = await _resolve_admin_community_ids(session, current_user)
    _require_admin_communities(admin_community_ids)

    normalized_status = _normalize_filter(
        status,
        allowed_values=_FEEDBACK_STATUSES,
        field_name="status",
    )
    normalized_severity = _normalize_filter(
        severity,
        allowed_values=_FEEDBACK_SEVERITIES,
        field_name="severity",
    )
    normalized_section = _normalize_section_filter(section)
    normalized_limit, normalized_offset = _normalize_pagination(
        limit=limit,
        offset=offset,
    )

    conditions = [AdminFeedback.community_id.in_(admin_community_ids)]
    if normalized_status is not None:
        conditions.append(AdminFeedback.status == normalized_status)
    if normalized_severity is not None:
        conditions.append(AdminFeedback.severity == normalized_severity)
    if normalized_section is not None:
        conditions.append(AdminFeedback.section == normalized_section)

    total_count = int(
        await session.scalar(
            select(func.count(AdminFeedback.id)).where(*conditions),
        )
        or 0
    )
    items = list(
        (
            await session.scalars(
                select(AdminFeedback)
                .where(*conditions)
                .order_by(AdminFeedback.created_at.desc(), AdminFeedback.id.desc())
                .limit(normalized_limit)
                .offset(normalized_offset),
            )
        ).all(),
    )
    return items, total_count, normalized_limit, normalized_offset


async def update_admin_feedback_status(
    session: AsyncSession,
    current_user: AppUser,
    feedback_id: UUID,
    payload: AdminFeedbackStatusUpdateRequest,
) -> AdminFeedback:
    async with _transaction_scope(session):
        admin_community_ids = await _resolve_admin_community_ids(session, current_user)
        _require_admin_communities(admin_community_ids)

        feedback = await session.scalar(
            select(AdminFeedback)
            .where(
                AdminFeedback.id == feedback_id,
                AdminFeedback.community_id.in_(admin_community_ids),
            )
            .with_for_update(),
        )
        if feedback is None:
            raise _not_found()

        now = _now()
        feedback.status = payload.status
        feedback.updated_at = now
        if payload.status in {"resolved", "closed"}:
            feedback.resolved_at = now
            feedback.resolved_by = current_user.id
        else:
            feedback.resolved_at = None
            feedback.resolved_by = None

        await session.flush()
        await session.refresh(feedback)
        return feedback
