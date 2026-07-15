from __future__ import annotations

import asyncio
import logging
from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings, get_settings
from app.core.logging import configure_logging
from app.db.models.core import DeviceToken, PushNotificationDelivery, PushNotificationJob
from app.db.session import AsyncSessionLocal
from app.services.expo_push import (
    ExpoPushClient,
    ExpoPushMessage,
    ExpoPushPermanentError,
    ExpoPushProtocolError,
    ExpoPushReceipt,
    ExpoPushRetryableError,
    ExpoPushTicket,
)

logger = logging.getLogger(__name__)

_DELIVERY_BATCH_SIZE = 100
_RECEIPT_BATCH_SIZE = 1000
_DEVICE_NOT_REGISTERED = "DeviceNotRegistered"


def _now() -> datetime:
    return datetime.now(UTC)


def _failure_message(error_code: str | None, *, source: str) -> str:
    if error_code == _DEVICE_NOT_REGISTERED:
        return "expo_device_not_registered: Device is no longer registered"
    if error_code == "MessageTooBig":
        return "expo_message_too_big: Expo rejected the notification"
    if error_code == "InvalidCredentials":
        return "expo_invalid_credentials: Expo rejected the request"
    if source == "ticket":
        return "expo_ticket_error: Expo rejected the notification"
    if source == "receipt":
        return "expo_receipt_error: Expo reported a delivery failure"
    if source == "protocol":
        return "expo_protocol_error: Expo response could not be processed"
    return "expo_request_rejected: Expo rejected the request"


class PushNotificationWorker:
    def __init__(
        self,
        *,
        settings: Settings | None = None,
        expo_client: ExpoPushClient | object | None = None,
        session_factory: Callable[[], AsyncSession] = AsyncSessionLocal,
    ) -> None:
        self._settings = settings or get_settings()
        self._expo_client = expo_client
        self._session_factory = session_factory

    async def run_once(self) -> int:
        if not self._settings.push_sending_allowed:
            if not self._settings.api_push_enabled:
                logger.info("Push worker disabled")
            else:
                logger.warning("Push worker refused production send without owner sign-off")
            return 0

        owns_client = self._expo_client is None
        expo_client = self._expo_client or ExpoPushClient(self._settings)
        try:
            attempted = 0
            job_id = await self._claim_next_job()
            if job_id is not None:
                attempted += await self._process_job(job_id, expo_client)
            attempted += await self._process_receipts(expo_client)
            return attempted
        finally:
            if owns_client:
                await expo_client.aclose()  # type: ignore[union-attr]

    async def _claim_next_job(self) -> UUID | None:
        async with self._session_factory() as session:
            async with session.begin():
                job = await session.scalar(
                    select(PushNotificationJob)
                    .where(PushNotificationJob.status == "queued")
                    .order_by(PushNotificationJob.queued_at, PushNotificationJob.id)
                    .limit(1)
                    .with_for_update(skip_locked=True),
                )
                if job is None:
                    return None
                job.status = "processing"
                job.error_message = None
                job.updated_at = _now()
                return job.id

    async def _process_job(self, job_id: UUID, expo_client: object) -> int:
        attempted = 0
        while True:
            job, deliveries = await self._load_next_delivery_batch(job_id)
            if job is None:
                return attempted
            if not deliveries:
                await self._finalize_job(job_id)
                return attempted

            messages = [
                ExpoPushMessage(
                    expo_push_token=delivery.expo_push_token,
                    title=job.title,
                    body=job.body,
                    data=job.data,
                )
                for delivery in deliveries
            ]
            delivery_ids = [delivery.id for delivery in deliveries]
            try:
                tickets = await expo_client.send(messages)  # type: ignore[attr-defined]
                if len(tickets) != len(deliveries):
                    raise ExpoPushProtocolError("Expo send response had an invalid shape")
            except ExpoPushRetryableError:
                await self._return_job_to_queue(job_id)
                logger.info("Push send deferred job_id=%s delivery_count=%s", job_id, len(deliveries))
                return attempted
            except ExpoPushPermanentError:
                await self._mark_delivery_batch_failed(
                    job_id,
                    delivery_ids,
                    source="request",
                )
                attempted += len(deliveries)
                continue
            except ExpoPushProtocolError:
                await self._mark_delivery_batch_failed(
                    job_id,
                    delivery_ids,
                    source="protocol",
                )
                attempted += len(deliveries)
                continue

            await self._apply_tickets(job_id, delivery_ids, tickets)
            attempted += len(deliveries)

    async def _load_next_delivery_batch(
        self,
        job_id: UUID,
    ) -> tuple[PushNotificationJob | None, list[PushNotificationDelivery]]:
        async with self._session_factory() as session:
            async with session.begin():
                job = await session.scalar(
                    select(PushNotificationJob)
                    .where(
                        PushNotificationJob.id == job_id,
                        PushNotificationJob.status == "processing",
                    )
                    .with_for_update(),
                )
                if job is None:
                    return None, []
                deliveries = list(
                    (
                        await session.scalars(
                            select(PushNotificationDelivery)
                            .where(
                                PushNotificationDelivery.job_id == job_id,
                                PushNotificationDelivery.status == "queued",
                            )
                            .order_by(PushNotificationDelivery.created_at, PushNotificationDelivery.id)
                            .limit(_DELIVERY_BATCH_SIZE)
                            .with_for_update(skip_locked=True),
                        )
                    ).all(),
                )
                return job, deliveries

    async def _apply_tickets(
        self,
        job_id: UUID,
        delivery_ids: list[UUID],
        tickets: list[ExpoPushTicket],
    ) -> None:
        async with self._session_factory() as session:
            async with session.begin():
                deliveries = list(
                    (
                        await session.scalars(
                            select(PushNotificationDelivery)
                            .where(
                                PushNotificationDelivery.job_id == job_id,
                                PushNotificationDelivery.id.in_(delivery_ids),
                            )
                            .with_for_update(),
                        )
                    ).all(),
                )
                delivery_by_id = {delivery.id: delivery for delivery in deliveries}
                now = _now()
                for delivery_id, ticket in zip(delivery_ids, tickets, strict=True):
                    delivery = delivery_by_id.get(delivery_id)
                    if delivery is None or delivery.status != "queued":
                        continue
                    if ticket.status == "ok" and ticket.ticket_id is not None:
                        delivery.status = "sent"
                        delivery.expo_ticket_id = ticket.ticket_id
                        delivery.error_message = None
                    else:
                        await self._fail_delivery(
                            session,
                            delivery,
                            error_code=ticket.error_code,
                            source="ticket",
                        )
                    delivery.updated_at = now

    async def _mark_delivery_batch_failed(
        self,
        job_id: UUID,
        delivery_ids: list[UUID],
        *,
        source: str,
    ) -> None:
        async with self._session_factory() as session:
            async with session.begin():
                deliveries = list(
                    (
                        await session.scalars(
                            select(PushNotificationDelivery)
                            .where(
                                PushNotificationDelivery.job_id == job_id,
                                PushNotificationDelivery.id.in_(delivery_ids),
                            )
                            .with_for_update(),
                        )
                    ).all(),
                )
                now = _now()
                for delivery in deliveries:
                    if delivery.status == "queued":
                        await self._fail_delivery(session, delivery, source=source)
                        delivery.updated_at = now

    async def _return_job_to_queue(self, job_id: UUID) -> None:
        async with self._session_factory() as session:
            async with session.begin():
                job = await session.scalar(
                    select(PushNotificationJob)
                    .where(PushNotificationJob.id == job_id)
                    .with_for_update(),
                )
                if job is not None and job.status == "processing":
                    job.status = "queued"
                    job.error_message = "expo_transport_retryable: Delivery will be retried"
                    job.updated_at = _now()

    async def _finalize_job(self, job_id: UUID) -> None:
        async with self._session_factory() as session:
            async with session.begin():
                job = await session.scalar(
                    select(PushNotificationJob)
                    .where(PushNotificationJob.id == job_id)
                    .with_for_update(),
                )
                if job is None:
                    return
                delivery_statuses = list(
                    (
                        await session.scalars(
                            select(PushNotificationDelivery.status).where(
                                PushNotificationDelivery.job_id == job_id,
                            ),
                        )
                    ).all(),
                )
                if not delivery_statuses:
                    job.status = "sent"
                elif "queued" in delivery_statuses:
                    job.status = "queued"
                    return
                else:
                    successful_statuses = {"sent", "receipt_checked"}
                    success_count = sum(
                        status in successful_statuses for status in delivery_statuses
                    )
                    if success_count == len(delivery_statuses):
                        job.status = "sent"
                    elif success_count:
                        job.status = "partially_sent"
                    else:
                        job.status = "failed"
                job.processed_at = _now()
                job.updated_at = _now()

    async def _process_receipts(self, expo_client: object) -> int:
        cutoff = _now() - timedelta(
            minutes=self._settings.api_push_receipt_delay_minutes,
        )
        affected_job_ids: set[UUID] = set()
        async with self._session_factory() as session:
            async with session.begin():
                deliveries = list(
                    (
                        await session.scalars(
                            select(PushNotificationDelivery)
                            .where(
                                PushNotificationDelivery.status == "sent",
                                PushNotificationDelivery.expo_ticket_id.is_not(None),
                                PushNotificationDelivery.updated_at <= cutoff,
                            )
                            .order_by(
                                PushNotificationDelivery.updated_at,
                                PushNotificationDelivery.id,
                            )
                            .limit(_RECEIPT_BATCH_SIZE)
                            .with_for_update(skip_locked=True),
                        )
                    ).all(),
                )
                if not deliveries:
                    return 0

                ticket_ids = [delivery.expo_ticket_id for delivery in deliveries]
                if any(ticket_id is None for ticket_id in ticket_ids):
                    return 0
                receipt_ids = [ticket_id for ticket_id in ticket_ids if ticket_id is not None]
                try:
                    receipts = await expo_client.get_receipts(receipt_ids)  # type: ignore[attr-defined]
                except ExpoPushRetryableError:
                    logger.info("Push receipt check deferred delivery_count=%s", len(deliveries))
                    return len(deliveries)
                except ExpoPushPermanentError:
                    for delivery in deliveries:
                        await self._fail_delivery(session, delivery, source="request")
                        delivery.updated_at = _now()
                        affected_job_ids.add(delivery.job_id)
                except ExpoPushProtocolError:
                    for delivery in deliveries:
                        await self._fail_delivery(session, delivery, source="protocol")
                        delivery.updated_at = _now()
                        affected_job_ids.add(delivery.job_id)
                else:
                    now = _now()
                    for delivery in deliveries:
                        ticket_id = delivery.expo_ticket_id
                        if ticket_id is None:
                            continue
                        receipt = receipts.get(ticket_id)
                        if receipt is None:
                            continue
                        await self._apply_receipt(session, delivery, receipt, now)
                        affected_job_ids.add(delivery.job_id)

        for job_id in affected_job_ids:
            await self._finalize_job(job_id)
        return len(affected_job_ids) or 0

    async def _apply_receipt(
        self,
        session: AsyncSession,
        delivery: PushNotificationDelivery,
        receipt: ExpoPushReceipt,
        now: datetime,
    ) -> None:
        if receipt.status == "ok":
            delivery.status = "receipt_checked"
            delivery.expo_receipt_id = delivery.expo_ticket_id
            delivery.error_message = None
        else:
            delivery.expo_receipt_id = delivery.expo_ticket_id
            await self._fail_delivery(
                session,
                delivery,
                error_code=receipt.error_code,
                source="receipt",
            )
        delivery.updated_at = now

    async def _fail_delivery(
        self,
        session: AsyncSession,
        delivery: PushNotificationDelivery,
        *,
        error_code: str | None = None,
        source: str,
    ) -> None:
        delivery.status = "failed"
        delivery.error_message = _failure_message(error_code, source=source)
        if error_code == _DEVICE_NOT_REGISTERED and delivery.device_token_id is not None:
            device_token = await session.get(DeviceToken, delivery.device_token_id)
            if device_token is not None:
                device_token.is_active = False
                device_token.updated_at = _now()


async def run_worker() -> None:
    settings = get_settings()
    configure_logging(settings.log_level)
    async with ExpoPushClient(settings) as expo_client:
        worker = PushNotificationWorker(settings=settings, expo_client=expo_client)
        while True:
            await worker.run_once()
            await asyncio.sleep(settings.api_push_poll_interval_seconds)


def main() -> None:
    asyncio.run(run_worker())


if __name__ == "__main__":
    main()
