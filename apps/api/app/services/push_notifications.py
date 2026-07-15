from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import dataclass
from typing import Any
from uuid import UUID

from fastapi import HTTPException, status as http_status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.core import (
    AppUser,
    Community,
    CommunityMembership,
    DeviceToken,
    Event,
    EventOccurrence,
    EventRegistration,
    Profile,
    PushNotificationDelivery,
    PushNotificationJob,
)
from app.schemas.push_notifications import (
    PushNotificationEnqueueRequest,
    PushNotificationJobResponse,
)
from app.services.authorization import ACTIVE_STATUS, EVENT_MANAGER_ROLES

_ELIGIBLE_REGISTRATION_STATUSES = ("pending", "confirmed", "waitlisted")
_EXPO_PUSH_PROVIDER = "expo"


@dataclass(frozen=True)
class PushJobDeliveryCounts:
    delivery_count: int = 0
    queued_delivery_count: int = 0
    sent_delivery_count: int = 0
    failed_delivery_count: int = 0
    skipped_delivery_count: int = 0
    receipt_checked_delivery_count: int = 0


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


def _not_found(message: str) -> HTTPException:
    return HTTPException(
        status_code=http_status.HTTP_404_NOT_FOUND,
        detail={"code": "not_found", "message": message},
    )


async def enqueue_event_push_notification(
    session: AsyncSession,
    current_user: AppUser,
    event_id: UUID,
    payload: PushNotificationEnqueueRequest,
    *,
    token_environment: str,
) -> tuple[PushNotificationJob, PushJobDeliveryCounts]:
    async with _transaction_scope(session):
        event = await _get_scoped_event(session, current_user.id, event_id)
        if payload.occurrence_id is not None:
            occurrence = await session.scalar(
                select(EventOccurrence)
                .where(
                    EventOccurrence.id == payload.occurrence_id,
                    EventOccurrence.event_id == event.id,
                )
                .with_for_update(),
            )
            if occurrence is None:
                raise _not_found("Event occurrence not found")

        job = PushNotificationJob(
            community_id=event.community_id,
            created_by=current_user.id,
            notification_kind=payload.notification_kind,
            audience="event_registrants",
            event_id=event.id,
            occurrence_id=payload.occurrence_id,
            title=payload.title,
            body=payload.body,
            data=payload.data,
            status="queued",
        )
        session.add(job)
        await session.flush()

        tokens = await _eligible_device_tokens(
            session,
            event_id=event.id,
            occurrence_id=payload.occurrence_id,
            token_environment=token_environment,
        )
        session.add_all(
            [
                PushNotificationDelivery(
                    job_id=job.id,
                    user_id=token.user_id,
                    device_token_id=token.id,
                    expo_push_token=token.expo_push_token,
                    status="queued",
                )
                for token in tokens
            ],
        )
        await session.flush()
        await session.refresh(job)

        return job, PushJobDeliveryCounts(
            delivery_count=len(tokens),
            queued_delivery_count=len(tokens),
        )


async def list_push_notification_jobs(
    session: AsyncSession,
    current_user: AppUser,
    *,
    community_id: UUID | None,
    limit: int,
) -> list[tuple[PushNotificationJob, PushJobDeliveryCounts]]:
    if community_id is not None:
        await _require_scoped_community(session, current_user.id, community_id)

    statement = (
        select(PushNotificationJob)
        .join(
            CommunityMembership,
            CommunityMembership.community_id == PushNotificationJob.community_id,
        )
        .where(
            CommunityMembership.user_id == current_user.id,
            CommunityMembership.status == ACTIVE_STATUS,
            CommunityMembership.role.in_(EVENT_MANAGER_ROLES),
        )
        .order_by(PushNotificationJob.created_at.desc())
        .limit(limit)
    )
    if community_id is not None:
        statement = statement.where(PushNotificationJob.community_id == community_id)

    jobs = list((await session.scalars(statement)).unique().all())
    counts_by_job_id = await _delivery_counts_for_jobs(
        session,
        [job.id for job in jobs],
    )
    return [(job, counts_by_job_id.get(job.id, PushJobDeliveryCounts())) for job in jobs]


def serialize_push_job(
    job: PushNotificationJob,
    counts: PushJobDeliveryCounts,
) -> PushNotificationJobResponse:
    return PushNotificationJobResponse(
        id=job.id,
        community_id=job.community_id,
        event_id=job.event_id,
        occurrence_id=job.occurrence_id,
        notification_kind=job.notification_kind,
        audience=job.audience,
        status=job.status,
        queued_at=job.queued_at,
        processed_at=job.processed_at,
        created_at=job.created_at,
        delivery_count=counts.delivery_count,
        queued_delivery_count=counts.queued_delivery_count,
        sent_delivery_count=counts.sent_delivery_count,
        failed_delivery_count=counts.failed_delivery_count,
        skipped_delivery_count=counts.skipped_delivery_count,
        receipt_checked_delivery_count=counts.receipt_checked_delivery_count,
    )


async def _get_scoped_event(
    session: AsyncSession,
    user_id: UUID,
    event_id: UUID,
) -> Event:
    event = await session.scalar(
        select(Event)
        .join(
            CommunityMembership,
            CommunityMembership.community_id == Event.community_id,
        )
        .where(
            Event.id == event_id,
            CommunityMembership.user_id == user_id,
            CommunityMembership.status == ACTIVE_STATUS,
            CommunityMembership.role.in_(EVENT_MANAGER_ROLES),
        )
        .with_for_update(),
    )
    if event is None:
        raise _not_found("Event not found")
    return event


async def _require_scoped_community(
    session: AsyncSession,
    user_id: UUID,
    community_id: UUID,
) -> None:
    scoped_community_id = await session.scalar(
        select(Community.id)
        .join(
            CommunityMembership,
            CommunityMembership.community_id == Community.id,
        )
        .where(
            Community.id == community_id,
            CommunityMembership.user_id == user_id,
            CommunityMembership.status == ACTIVE_STATUS,
            CommunityMembership.role.in_(EVENT_MANAGER_ROLES),
        ),
    )
    if scoped_community_id is None:
        raise _not_found("Community not found")


async def _eligible_device_tokens(
    session: AsyncSession,
    *,
    event_id: UUID,
    occurrence_id: UUID | None,
    token_environment: str,
) -> list[DeviceToken]:
    statement = (
        select(DeviceToken, Profile.notification_preferences)
        .join(
            EventRegistration,
            EventRegistration.user_id == DeviceToken.user_id,
        )
        .outerjoin(Profile, Profile.user_id == EventRegistration.user_id)
        .where(
            EventRegistration.event_id == event_id,
            EventRegistration.status.in_(_ELIGIBLE_REGISTRATION_STATUSES),
            DeviceToken.is_active.is_(True),
            DeviceToken.push_provider == _EXPO_PUSH_PROVIDER,
            DeviceToken.environment == token_environment,
        )
    )
    if occurrence_id is not None:
        statement = statement.where(EventRegistration.occurrence_id == occurrence_id)

    tokens_by_id: dict[UUID, DeviceToken] = {}
    for token, preferences in (await session.execute(statement)).all():
        if isinstance(preferences, dict) and preferences.get("events") is False:
            continue
        tokens_by_id[token.id] = token
    return list(tokens_by_id.values())


async def _delivery_counts_for_jobs(
    session: AsyncSession,
    job_ids: list[UUID],
) -> dict[UUID, PushJobDeliveryCounts]:
    if not job_ids:
        return {}

    result = await session.execute(
        select(
            PushNotificationDelivery.job_id,
            func.count(PushNotificationDelivery.id),
            func.count(PushNotificationDelivery.id).filter(
                PushNotificationDelivery.status == "queued",
            ),
            func.count(PushNotificationDelivery.id).filter(
                PushNotificationDelivery.status == "sent",
            ),
            func.count(PushNotificationDelivery.id).filter(
                PushNotificationDelivery.status == "failed",
            ),
            func.count(PushNotificationDelivery.id).filter(
                PushNotificationDelivery.status == "skipped",
            ),
            func.count(PushNotificationDelivery.id).filter(
                PushNotificationDelivery.status == "receipt_checked",
            ),
        )
        .where(PushNotificationDelivery.job_id.in_(job_ids))
        .group_by(PushNotificationDelivery.job_id),
    )
    return {
        job_id: PushJobDeliveryCounts(
            delivery_count=int(delivery_count),
            queued_delivery_count=int(queued_count),
            sent_delivery_count=int(sent_count),
            failed_delivery_count=int(failed_count),
            skipped_delivery_count=int(skipped_count),
            receipt_checked_delivery_count=int(receipt_checked_count),
        )
        for (
            job_id,
            delivery_count,
            queued_count,
            sent_count,
            failed_count,
            skipped_count,
            receipt_checked_count,
        ) in result.all()
    }
