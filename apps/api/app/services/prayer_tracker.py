from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import UTC, date, datetime
from uuid import UUID
from zoneinfo import ZoneInfo

from fastapi import HTTPException, status as http_status
from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.core import AppUser, PrayerActivityLog
from app.schemas.prayer_tracker import (
    PRAYER_ACTIVITY_TYPES,
    PrayerLogCreateRequest,
    PrayerSummaryResponse,
)


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


def _validation_error(message: str) -> HTTPException:
    return _error(http_status.HTTP_422_UNPROCESSABLE_CONTENT, "validation_error", message)


def _not_found() -> HTTPException:
    return _error(http_status.HTTP_404_NOT_FOUND, "not_found", "Prayer log not found")


def _resolve_activity_date(payload: PrayerLogCreateRequest) -> date:
    if payload.activity_date is not None:
        return payload.activity_date

    timestamp = payload.started_at or payload.completed_at
    if timestamp is None:
        raise _validation_error(
            "started_at or completed_at is required when activity_date is omitted",
        )

    return timestamp.astimezone(ZoneInfo(payload.timezone)).date()


def _apply_date_range(query: object, from_date: date | None, to_date: date | None) -> object:
    if from_date is not None:
        query = query.where(PrayerActivityLog.activity_date >= from_date)
    if to_date is not None:
        query = query.where(PrayerActivityLog.activity_date <= to_date)
    return query


async def list_current_user_prayer_logs(
    session: AsyncSession,
    current_user: AppUser,
    *,
    from_date: date | None,
    to_date: date | None,
    limit: int,
) -> list[PrayerActivityLog]:
    query = select(PrayerActivityLog).where(PrayerActivityLog.user_id == current_user.id)
    query = _apply_date_range(query, from_date, to_date)
    query = query.order_by(
        PrayerActivityLog.activity_date.desc(),
        PrayerActivityLog.created_at.desc(),
    ).limit(limit)
    return list(await session.scalars(query))


async def upsert_current_user_prayer_log(
    session: AsyncSession,
    current_user: AppUser,
    payload: PrayerLogCreateRequest,
) -> PrayerActivityLog:
    activity_date = _resolve_activity_date(payload)

    async with _transaction_scope(session):
        existing_log = await session.scalar(
            select(PrayerActivityLog)
            .where(
                PrayerActivityLog.user_id == current_user.id,
                PrayerActivityLog.activity_date == activity_date,
                PrayerActivityLog.activity_type == payload.activity_type,
            )
            .with_for_update(),
        )
        if (
            existing_log is None
            and payload.started_at is None
            and payload.completed_at is None
        ):
            raise _validation_error(
                "started_at or completed_at is required for a new prayer log",
            )

        insert_started_at = (
            payload.started_at
            if payload.started_at is not None
            else existing_log.started_at if existing_log is not None else None
        )
        insert_completed_at = (
            payload.completed_at
            if payload.completed_at is not None
            else existing_log.completed_at if existing_log is not None else None
        )

        insert_statement = insert(PrayerActivityLog).values(
            user_id=current_user.id,
            activity_type=payload.activity_type,
            activity_date=activity_date,
            started_at=insert_started_at,
            completed_at=insert_completed_at,
            timezone=payload.timezone,
            city=payload.city,
            hebrew_date=payload.hebrew_date,
            metadata_json=payload.metadata,
        )
        upsert_statement = insert_statement.on_conflict_do_update(
            constraint="prayer_activity_logs_user_date_type_key",
            set_={
                "started_at": func.coalesce(
                    insert_statement.excluded.started_at,
                    PrayerActivityLog.started_at,
                ),
                "completed_at": func.coalesce(
                    insert_statement.excluded.completed_at,
                    PrayerActivityLog.completed_at,
                ),
                "timezone": insert_statement.excluded.timezone,
                "city": func.coalesce(
                    insert_statement.excluded.city,
                    PrayerActivityLog.city,
                ),
                "hebrew_date": PrayerActivityLog.hebrew_date.op("||")(
                    insert_statement.excluded.hebrew_date,
                ),
                "metadata": PrayerActivityLog.metadata_json.op("||")(
                    insert_statement.excluded.metadata,
                ),
                "updated_at": _now(),
            },
        )
        await session.execute(upsert_statement)

        prayer_log = await session.scalar(
            select(PrayerActivityLog)
            .where(
                PrayerActivityLog.user_id == current_user.id,
                PrayerActivityLog.activity_date == activity_date,
                PrayerActivityLog.activity_type == payload.activity_type,
            )
            .execution_options(populate_existing=True),
        )
        if prayer_log is None:
            raise RuntimeError("Prayer log upsert did not return a row")
        return prayer_log


async def delete_current_user_prayer_log(
    session: AsyncSession,
    current_user: AppUser,
    log_id: UUID,
) -> UUID:
    async with _transaction_scope(session):
        prayer_log = await session.scalar(
            select(PrayerActivityLog)
            .where(
                PrayerActivityLog.id == log_id,
                PrayerActivityLog.user_id == current_user.id,
            )
            .with_for_update(),
        )
        if prayer_log is None:
            raise _not_found()

        await session.delete(prayer_log)
        return log_id


async def get_current_user_prayer_summary(
    session: AsyncSession,
    current_user: AppUser,
    *,
    from_date: date | None,
    to_date: date | None,
) -> PrayerSummaryResponse:
    summary_query = select(
        func.count(PrayerActivityLog.id),
        func.count(func.distinct(PrayerActivityLog.activity_date)),
        func.min(PrayerActivityLog.activity_date),
        func.max(PrayerActivityLog.activity_date),
    ).where(PrayerActivityLog.user_id == current_user.id)
    summary_query = _apply_date_range(summary_query, from_date, to_date)
    total_logs, active_days, first_activity_date, last_activity_date = (
        await session.execute(summary_query)
    ).one()

    counts_query = select(
        PrayerActivityLog.activity_type,
        func.count(PrayerActivityLog.id),
    ).where(PrayerActivityLog.user_id == current_user.id)
    counts_query = _apply_date_range(counts_query, from_date, to_date)
    counts_query = counts_query.group_by(PrayerActivityLog.activity_type)

    counts_by_activity_type = {activity_type: 0 for activity_type in PRAYER_ACTIVITY_TYPES}
    for activity_type, count in (await session.execute(counts_query)).all():
        if activity_type in counts_by_activity_type:
            counts_by_activity_type[activity_type] = count

    return PrayerSummaryResponse(
        from_date=from_date,
        to_date=to_date,
        total_logs=total_logs,
        active_days=active_days,
        counts_by_activity_type=counts_by_activity_type,
        first_activity_date=first_activity_date,
        last_activity_date=last_activity_date,
    )
