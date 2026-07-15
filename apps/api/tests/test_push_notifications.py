from __future__ import annotations

import unittest
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

import httpx
from fastapi import HTTPException
from sqlalchemy import delete, select

from app.core.config import Settings
from app.db.models.core import (
    AppUser,
    Community,
    CommunityMembership,
    DeviceToken,
    Event,
    EventCategory,
    EventOccurrence,
    EventRegistration,
    Profile,
    PushNotificationDelivery,
    PushNotificationJob,
)
from app.db.session import AsyncSessionLocal, engine
from app.schemas.push_notifications import (
    PushNotificationEnqueueRequest,
    PushNotificationJobResponse,
)
from app.services import push_notifications as push_service
from app.services.expo_push import (
    ExpoPushClient,
    ExpoPushMessage,
    ExpoPushReceipt,
    ExpoPushRetryableError,
    ExpoPushTicket,
)
from app.workers.push_notifications import PushNotificationWorker


def _now() -> datetime:
    return datetime.now(UTC)


@dataclass(frozen=True)
class TestContext:
    community_id: UUID
    actor_id: UUID
    event_id: UUID


class FakeExpoClient:
    def __init__(
        self,
        *,
        retry_send: bool = False,
        ticket_error: str | None = None,
        receipts: dict[str, ExpoPushReceipt] | None = None,
    ) -> None:
        self.retry_send = retry_send
        self.ticket_error = ticket_error
        self.receipts = receipts or {}
        self.sent_batches: list[list[ExpoPushMessage]] = []
        self.receipt_requests: list[list[str]] = []

    async def send(self, messages: list[ExpoPushMessage]) -> list[ExpoPushTicket]:
        self.sent_batches.append(messages)
        if self.retry_send:
            raise ExpoPushRetryableError("retryable test failure")
        batch_number = len(self.sent_batches)
        if self.ticket_error is not None:
            return [
                ExpoPushTicket(status="error", error_code=self.ticket_error)
                for _ in messages
            ]
        return [
            ExpoPushTicket(status="ok", ticket_id=f"ticket-{batch_number}-{index}")
            for index, _ in enumerate(messages, start=1)
        ]

    async def get_receipts(self, ticket_ids: list[str]) -> dict[str, ExpoPushReceipt]:
        self.receipt_requests.append(ticket_ids)
        return {
            ticket_id: receipt
            for ticket_id, receipt in self.receipts.items()
            if ticket_id in ticket_ids
        }


class NoNetworkExpoClient:
    def __init__(self) -> None:
        self.calls = 0

    async def send(self, messages: list[ExpoPushMessage]) -> list[ExpoPushTicket]:
        self.calls += 1
        raise AssertionError("worker must not send when push is disabled")

    async def get_receipts(self, ticket_ids: list[str]) -> dict[str, ExpoPushReceipt]:
        self.calls += 1
        raise AssertionError("worker must not request receipts when push is disabled")


class PushNotificationPipelineTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        self.community_ids: list[UUID] = []
        self.user_ids: list[UUID] = []

    async def asyncTearDown(self) -> None:
        try:
            if self.community_ids or self.user_ids:
                async with AsyncSessionLocal() as session:
                    async with session.begin():
                        if self.community_ids:
                            await session.execute(
                                delete(Event).where(
                                    Event.community_id.in_(self.community_ids),
                                ),
                            )
                            await session.execute(
                                delete(Community).where(
                                    Community.id.in_(self.community_ids),
                                ),
                            )
                        if self.user_ids:
                            await session.execute(
                                delete(AppUser).where(AppUser.id.in_(self.user_ids)),
                            )
        finally:
            await engine.dispose()

    async def test_enqueue_scoping_occurrence_and_recipient_rules(self) -> None:
        context = await self._create_context(role="admin")
        await self._add_recipient(
            context,
            registration_status="pending",
            preference={},
            token_environment="development",
        )
        duplicate_user_id = await self._add_recipient(
            context,
            registration_status="confirmed",
            preference={},
            token_environment="development",
        )
        await self._add_registration(
            context.event_id,
            duplicate_user_id,
            status="waitlisted",
        )
        await self._add_device_token(duplicate_user_id, environment="preview")
        await self._add_recipient(
            context,
            registration_status="confirmed",
            preference={"events": False},
            token_environment="development",
        )
        await self._add_recipient(
            context,
            registration_status="cancelled",
            preference={},
            token_environment="development",
        )

        payload = PushNotificationEnqueueRequest(
            notification_kind="event_updated",
            title="Update",
            body="Event details changed",
        )
        async with AsyncSessionLocal() as session:
            actor = await session.get(AppUser, context.actor_id)
            assert actor is not None
            job, counts = await push_service.enqueue_event_push_notification(
                session,
                actor,
                context.event_id,
                payload,
                token_environment="development",
            )
            deliveries = list(
                (
                    await session.scalars(
                        select(PushNotificationDelivery).where(
                            PushNotificationDelivery.job_id == job.id,
                        ),
                    )
                ).all(),
            )
        self.assertEqual(counts.delivery_count, 2)
        self.assertEqual(len(deliveries), 2)
        self.assertTrue(all(delivery.status == "queued" for delivery in deliveries))

        async with AsyncSessionLocal() as session:
            actor = await session.get(AppUser, context.actor_id)
            assert actor is not None
            listed_jobs = await push_service.list_push_notification_jobs(
                session,
                actor,
                community_id=context.community_id,
                limit=50,
            )
        listed_response = push_service.serialize_push_job(*listed_jobs[0])
        self.assertEqual(listed_response.delivery_count, 2)
        self.assertNotIn("token", listed_response.model_dump_json())

        occurrence = await self._add_occurrence(context.event_id)
        occurrence_user_id = await self._add_recipient(
            context,
            registration_status="confirmed",
            preference={},
            token_environment="development",
            occurrence_id=occurrence.id,
        )
        occurrence_payload = PushNotificationEnqueueRequest(
            occurrence_id=occurrence.id,
            notification_kind="event_created",
            title="Occurrence",
            body="Only occurrence registrants",
        )
        async with AsyncSessionLocal() as session:
            actor = await session.get(AppUser, context.actor_id)
            assert actor is not None
            occurrence_job, occurrence_counts = (
                await push_service.enqueue_event_push_notification(
                    session,
                    actor,
                    context.event_id,
                    occurrence_payload,
                    token_environment="development",
                )
            )
            occurrence_deliveries = list(
                (
                    await session.scalars(
                        select(PushNotificationDelivery.user_id).where(
                            PushNotificationDelivery.job_id == occurrence_job.id,
                        ),
                    )
                ).all(),
            )
        self.assertEqual(occurrence_counts.delivery_count, 1)
        self.assertEqual(occurrence_deliveries, [occurrence_user_id])

        other_context = await self._create_context(role="admin")
        other_occurrence = await self._add_occurrence(other_context.event_id)
        async with AsyncSessionLocal() as session:
            actor = await session.get(AppUser, context.actor_id)
            assert actor is not None
            with self.assertRaises(HTTPException) as invalid_occurrence:
                await push_service.enqueue_event_push_notification(
                    session,
                    actor,
                    context.event_id,
                    PushNotificationEnqueueRequest(
                        occurrence_id=other_occurrence.id,
                        notification_kind="event_cancelled",
                        title="Cancelled",
                        body="Cancelled occurrence",
                    ),
                    token_environment="development",
                )
            self.assertEqual(invalid_occurrence.exception.status_code, 404)

        async with AsyncSessionLocal() as session:
            actor = await session.get(AppUser, context.actor_id)
            assert actor is not None
            with self.assertRaises(HTTPException) as out_of_community:
                await push_service.enqueue_event_push_notification(
                    session,
                    actor,
                    other_context.event_id,
                    payload,
                    token_environment="development",
                )
            self.assertEqual(out_of_community.exception.status_code, 404)

    async def test_event_manager_is_allowed_and_member_is_nonleaking(self) -> None:
        manager_context = await self._create_context(role="event_manager")
        payload = PushNotificationEnqueueRequest(
            notification_kind="event_created",
            title="Created",
            body="New event",
        )
        async with AsyncSessionLocal() as session:
            manager = await session.get(AppUser, manager_context.actor_id)
            assert manager is not None
            job, _ = await push_service.enqueue_event_push_notification(
                session,
                manager,
                manager_context.event_id,
                payload,
                token_environment="development",
            )
        self.assertEqual(job.audience, "event_registrants")
        self.assertEqual(job.status, "queued")
        zero_recipient_expo = FakeExpoClient()
        await PushNotificationWorker(
            settings=Settings(api_push_enabled=True),
            expo_client=zero_recipient_expo,
        ).run_once()
        async with AsyncSessionLocal() as session:
            zero_recipient_job = await session.get(PushNotificationJob, job.id)
        assert zero_recipient_job is not None
        self.assertEqual(zero_recipient_job.status, "sent")
        self.assertEqual(zero_recipient_expo.sent_batches, [])

        member_context = await self._create_context(role="member")
        async with AsyncSessionLocal() as session:
            member = await session.get(AppUser, member_context.actor_id)
            assert member is not None
            with self.assertRaises(HTTPException) as denied:
                await push_service.enqueue_event_push_notification(
                    session,
                    member,
                    member_context.event_id,
                    payload,
                    token_environment="development",
                )
            self.assertEqual(denied.exception.status_code, 404)

    async def test_worker_batches_tickets_and_leaves_retryable_work_queued(self) -> None:
        context = await self._create_context(role="admin")
        job_id, _ = await self._create_direct_job(context, delivery_count=205)
        expo = FakeExpoClient()
        worker = PushNotificationWorker(
            settings=Settings(api_push_enabled=True),
            expo_client=expo,
        )
        await worker.run_once()
        self.assertEqual([len(batch) for batch in expo.sent_batches], [100, 100, 5])

        async with AsyncSessionLocal() as session:
            job = await session.get(PushNotificationJob, job_id)
            assert job is not None
            deliveries = list(
                (
                    await session.scalars(
                        select(PushNotificationDelivery)
                        .where(PushNotificationDelivery.job_id == job_id)
                        .order_by(
                            PushNotificationDelivery.created_at,
                            PushNotificationDelivery.id,
                        ),
                    )
                ).all(),
            )
        self.assertEqual(job.status, "sent")
        expected_ticket_ids = [
            f"ticket-{index // 100 + 1}-{index % 100 + 1}"
            for index in range(205)
        ]
        self.assertEqual(
            [delivery.expo_ticket_id for delivery in deliveries],
            expected_ticket_ids,
        )

        retry_job_id, _ = await self._create_direct_job(context, delivery_count=1)
        retry_expo = FakeExpoClient(retry_send=True)
        retry_worker = PushNotificationWorker(
            settings=Settings(api_push_enabled=True),
            expo_client=retry_expo,
        )
        await retry_worker.run_once()
        async with AsyncSessionLocal() as session:
            retry_job = await session.get(PushNotificationJob, retry_job_id)
            retry_delivery = await session.scalar(
                select(PushNotificationDelivery).where(
                    PushNotificationDelivery.job_id == retry_job_id,
                ),
            )
        assert retry_job is not None
        assert retry_delivery is not None
        self.assertEqual(retry_job.status, "queued")
        self.assertEqual(retry_delivery.status, "queued")
        self.assertIsNone(retry_delivery.expo_ticket_id)

    async def test_ticket_and_receipt_failures_deactivate_only_invalid_tokens(self) -> None:
        context = await self._create_context(role="admin")
        failed_job_id, failed_token_id = await self._create_direct_job(
            context,
            delivery_count=1,
        )
        failed_expo = FakeExpoClient(ticket_error="DeviceNotRegistered")
        await PushNotificationWorker(
            settings=Settings(api_push_enabled=True),
            expo_client=failed_expo,
        ).run_once()
        async with AsyncSessionLocal() as session:
            failed_delivery = await session.scalar(
                select(PushNotificationDelivery).where(
                    PushNotificationDelivery.job_id == failed_job_id,
                ),
            )
            failed_token = await session.get(DeviceToken, failed_token_id)
        assert failed_delivery is not None
        assert failed_token is not None
        self.assertEqual(failed_delivery.status, "failed")
        self.assertIn("expo_device_not_registered", failed_delivery.error_message or "")
        self.assertFalse(failed_token.is_active)

        ok_job_id, _ = await self._create_direct_job(
            context,
            delivery_count=1,
            job_status="sent",
            delivery_status="sent",
            ticket_id="receipt-ok",
            aged_for_receipt=True,
        )
        missing_job_id, _ = await self._create_direct_job(
            context,
            delivery_count=1,
            job_status="sent",
            delivery_status="sent",
            ticket_id="receipt-missing",
            aged_for_receipt=True,
        )
        invalid_job_id, invalid_token_id = await self._create_direct_job(
            context,
            delivery_count=1,
            job_status="sent",
            delivery_status="sent",
            ticket_id="receipt-invalid",
            aged_for_receipt=True,
        )
        receipt_expo = FakeExpoClient(
            receipts={
                "receipt-ok": ExpoPushReceipt(status="ok"),
                "receipt-invalid": ExpoPushReceipt(
                    status="error",
                    error_code="DeviceNotRegistered",
                ),
            },
        )
        await PushNotificationWorker(
            settings=Settings(
                api_push_enabled=True,
                api_push_receipt_delay_minutes=15,
            ),
            expo_client=receipt_expo,
        ).run_once()
        async with AsyncSessionLocal() as session:
            ok_delivery = await session.scalar(
                select(PushNotificationDelivery).where(
                    PushNotificationDelivery.job_id == ok_job_id,
                ),
            )
            missing_delivery = await session.scalar(
                select(PushNotificationDelivery).where(
                    PushNotificationDelivery.job_id == missing_job_id,
                ),
            )
            invalid_delivery = await session.scalar(
                select(PushNotificationDelivery).where(
                    PushNotificationDelivery.job_id == invalid_job_id,
                ),
            )
            invalid_token = await session.get(DeviceToken, invalid_token_id)
        assert ok_delivery is not None
        assert missing_delivery is not None
        assert invalid_delivery is not None
        assert invalid_token is not None
        self.assertEqual(ok_delivery.status, "receipt_checked")
        self.assertEqual(ok_delivery.expo_receipt_id, "receipt-ok")
        self.assertEqual(missing_delivery.status, "sent")
        self.assertEqual(invalid_delivery.status, "failed")
        self.assertFalse(invalid_token.is_active)

    async def test_expo_adapter_is_mocked_and_retries_transient_http_failures(self) -> None:
        settings = Settings(api_push_enabled=True)
        send_client = ExpoPushClient(
            settings,
            transport=httpx.MockTransport(
                lambda request: httpx.Response(
                    200,
                    json={
                        "data": [
                            {"status": "ok", "id": "first"},
                            {
                                "status": "error",
                                "details": {"error": "DeviceNotRegistered"},
                            },
                        ],
                    },
                ),
            ),
        )
        try:
            tickets = await send_client.send(
                [
                    ExpoPushMessage("test-token-a", "one", "one", {}),
                    ExpoPushMessage("test-token-b", "two", "two", {}),
                ],
            )
        finally:
            await send_client.aclose()
        self.assertEqual(tickets[0].ticket_id, "first")
        self.assertEqual(tickets[1].error_code, "DeviceNotRegistered")

        requests = 0

        def rate_limited(_: httpx.Request) -> httpx.Response:
            nonlocal requests
            requests += 1
            return httpx.Response(429, json={"errors": [{"message": "ignored"}]})

        retry_client = ExpoPushClient(
            settings,
            transport=httpx.MockTransport(rate_limited),
        )
        try:
            with self.assertRaises(ExpoPushRetryableError):
                await retry_client.send(
                    [ExpoPushMessage("test-token", "title", "body", {})],
                )
        finally:
            await retry_client.aclose()
        self.assertEqual(requests, 3)

    async def test_disabled_and_unsigned_production_workers_make_no_requests(self) -> None:
        disabled_client = NoNetworkExpoClient()
        disabled_worker = PushNotificationWorker(
            settings=Settings(api_push_enabled=False),
            expo_client=disabled_client,
        )
        self.assertEqual(await disabled_worker.run_once(), 0)
        self.assertEqual(disabled_client.calls, 0)

        production_client = NoNetworkExpoClient()
        production_worker = PushNotificationWorker(
            settings=Settings(
                app_env="production",
                api_push_enabled=True,
                api_push_production_signoff=False,
            ),
            expo_client=production_client,
        )
        self.assertEqual(await production_worker.run_once(), 0)
        self.assertEqual(production_client.calls, 0)

    async def test_openapi_and_public_models_do_not_expose_tokens(self) -> None:
        from app.main import app

        push_paths = {path for path in app.openapi()["paths"] if "push" in path}
        self.assertEqual(
            push_paths,
            {
                "/admin/events/{event_id}/push-notifications",
                "/admin/push-jobs",
            },
        )
        public_fields = set(PushNotificationJobResponse.model_fields)
        self.assertNotIn("expo_push_token", public_fields)
        self.assertNotIn("device_token_id", public_fields)
        self.assertFalse(any("token" in field for field in public_fields))

    async def _create_context(self, *, role: str) -> TestContext:
        community_id = uuid4()
        actor_id = uuid4()
        event_id = uuid4()
        self.community_ids.append(community_id)
        self.user_ids.append(actor_id)
        async with AsyncSessionLocal() as session:
            async with session.begin():
                session.add_all(
                    [
                        Community(
                            id=community_id,
                            name="Push test community",
                            city="Moscow",
                            slug=f"push-{community_id.hex[:20]}",
                        ),
                        AppUser(id=actor_id, status="active"),
                        CommunityMembership(
                            id=uuid4(),
                            community_id=community_id,
                            user_id=actor_id,
                            role=role,
                            status="active",
                        ),
                        EventCategory(
                            id=uuid4(),
                            community_id=community_id,
                            slug="community",
                            title="Community",
                            color="#000000",
                            icon="*",
                            created_by=actor_id,
                        ),
                    ],
                )
                await session.flush()
                session.add(
                    Event(
                        id=event_id,
                        community_id=community_id,
                        title="Push test event",
                        starts_at=_now() + timedelta(days=1),
                        category="community",
                        created_by=actor_id,
                    ),
                )
        return TestContext(community_id, actor_id, event_id)

    async def _add_recipient(
        self,
        context: TestContext,
        *,
        registration_status: str,
        preference: dict[str, object],
        token_environment: str,
        occurrence_id: UUID | None = None,
    ) -> UUID:
        user_id = uuid4()
        self.user_ids.append(user_id)
        async with AsyncSessionLocal() as session:
            async with session.begin():
                session.add_all(
                    [
                        AppUser(id=user_id, status="active"),
                        Profile(
                            id=uuid4(),
                            user_id=user_id,
                            community_id=context.community_id,
                            notification_preferences=preference,
                        ),
                    ],
                )
                await session.flush()
                session.add(
                    DeviceToken(
                        id=uuid4(),
                        user_id=user_id,
                        platform="ios",
                        push_provider="expo",
                        expo_push_token=f"ExponentPushToken[{uuid4()}]",
                        environment=token_environment,
                        is_active=True,
                    ),
                )
                session.add(
                    EventRegistration(
                        id=uuid4(),
                        event_id=context.event_id,
                        user_id=user_id,
                        occurrence_id=occurrence_id,
                        status=registration_status,
                    ),
                )
        return user_id

    async def _add_registration(
        self,
        event_id: UUID,
        user_id: UUID,
        *,
        status: str,
    ) -> None:
        async with AsyncSessionLocal() as session:
            async with session.begin():
                session.add(
                    EventRegistration(
                        id=uuid4(),
                        event_id=event_id,
                        user_id=user_id,
                        status=status,
                    ),
                )

    async def _add_device_token(self, user_id: UUID, *, environment: str) -> None:
        async with AsyncSessionLocal() as session:
            async with session.begin():
                session.add(
                    DeviceToken(
                        id=uuid4(),
                        user_id=user_id,
                        platform="ios",
                        push_provider="expo",
                        expo_push_token=f"ExponentPushToken[{uuid4()}]",
                        environment=environment,
                        is_active=True,
                    ),
                )

    async def _add_occurrence(self, event_id: UUID) -> EventOccurrence:
        occurrence = EventOccurrence(
            id=uuid4(),
            event_id=event_id,
            starts_at=_now() + timedelta(days=1),
        )
        async with AsyncSessionLocal() as session:
            async with session.begin():
                session.add(occurrence)
        return occurrence

    async def _create_direct_job(
        self,
        context: TestContext,
        *,
        delivery_count: int,
        job_status: str = "queued",
        delivery_status: str = "queued",
        ticket_id: str | None = None,
        aged_for_receipt: bool = False,
    ) -> tuple[UUID, UUID]:
        job_id = uuid4()
        token_ids: list[UUID] = []
        updated_at = _now() - timedelta(minutes=20) if aged_for_receipt else _now()
        async with AsyncSessionLocal() as session:
            async with session.begin():
                job = PushNotificationJob(
                    id=job_id,
                    community_id=context.community_id,
                    created_by=context.actor_id,
                    notification_kind="event_updated",
                    audience="event_registrants",
                    event_id=context.event_id,
                    title="Worker test",
                    body="Worker test body",
                    data={},
                    status=job_status,
                    updated_at=updated_at,
                )
                session.add(job)
                await session.flush()
                for index in range(delivery_count):
                    token_id = uuid4()
                    token_ids.append(token_id)
                    session.add(
                        DeviceToken(
                            id=token_id,
                            user_id=context.actor_id,
                            platform="ios",
                            push_provider="expo",
                            expo_push_token=f"ExponentPushToken[{uuid4()}]",
                            environment="development",
                            is_active=True,
                            updated_at=updated_at,
                        ),
                    )
                await session.flush()
                for index, token_id in enumerate(token_ids):
                    session.add(
                        PushNotificationDelivery(
                            id=uuid4(),
                            job_id=job_id,
                            user_id=context.actor_id,
                            device_token_id=token_id,
                            expo_push_token=f"delivery-token-{uuid4()}",
                            status=delivery_status,
                            expo_ticket_id=ticket_id if index == 0 else None,
                            updated_at=updated_at,
                        ),
                    )
        return job_id, token_ids[0]


if __name__ == "__main__":
    unittest.main()
