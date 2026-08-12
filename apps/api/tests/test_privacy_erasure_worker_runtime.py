from __future__ import annotations

import asyncio
import base64
from datetime import UTC, date, datetime, timedelta
import logging
import unittest
from unittest.mock import AsyncMock
from uuid import UUID, uuid4

from sqlalchemy import delete, event as sqlalchemy_event, func, select, update

from app.core.config import Settings
from app.db.models.core import (
    AppUser,
    Community,
    Event,
    EventCategory,
    EventRegistration,
    EventRegistrationOptionSelection,
    PrayerActivityLog,
    PrivacyDestructionEvidence,
    PrivacyRetainedFinancialEvidence,
    PrivacyRequest,
)
from app.db.session import AsyncSessionLocal, engine
from app.services.email_delivery import EmailSendResult
from app.services.privacy_erasure_worker import (
    DATABASE_FAILURE_CODE,
    MANUAL_REVIEW_FAILURE_CODE,
    PRIVACY_ERASURE_EXECUTION_VERSION,
    PrivacyErasureWorkerResult,
    execute_privacy_erasure_request,
)
from app.workers.privacy_erasure import PrivacyErasureRuntime, run_worker


class _FakeRegisterStorage:
    def __init__(self) -> None:
        self.objects: dict[str, bytes] = {}

    async def get_object(self, key: str) -> bytes | None:
        return self.objects.get(key)

    async def put_object_if_absent(self, key: str, body: bytes) -> bool:
        if key in self.objects:
            return False
        self.objects[key] = body
        return True

    async def list_object_keys(self, prefix: str) -> list[str]:
        return sorted(key for key in self.objects if key.startswith(prefix))


class PrivacyErasureRuntimeTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        await engine.dispose()
        self.now = datetime.now(UTC).replace(microsecond=0)
        self.queue_created_at = datetime(2000, 1, 1, tzinfo=UTC)
        self.marker = uuid4().hex[:12]
        self.community_id = uuid4()
        self.event_id = uuid4()
        self.user_ids: set[UUID] = set()
        self.request_ids: set[UUID] = set()
        self.registration_ids: set[UUID] = set()
        self.settings = Settings(
            api_privacy_erasure_worker_enabled=True,
            api_privacy_erasure_poll_interval_seconds=1,
            api_privacy_erasure_batch_size=10,
            api_privacy_erasure_notification_key_b64=base64.b64encode(
                b"synthetic-worker-notice-key-32bx"
            ).decode("ascii"),
            api_privacy_erasure_notification_key_id="synthetic-runtime-key-v1",
            api_privacy_erasure_notification_delivery_window_hours=24,
            api_privacy_erasure_financial_retention_days=365,
        )
        self.register_storage = _FakeRegisterStorage()

        async with AsyncSessionLocal() as session:
            async with session.begin():
                session.add(
                    Community(
                        id=self.community_id,
                        name="Synthetic runtime community",
                        city="Moscow",
                        slug=f"runtime-{self.marker}",
                    ),
                )
                await session.flush()
                session.add(
                    EventCategory(
                        community_id=self.community_id,
                        slug="runtime",
                        title="Runtime",
                        color="#123456",
                        icon="*",
                    ),
                )
                await session.flush()
                session.add(
                    Event(
                        id=self.event_id,
                        community_id=self.community_id,
                        title="Synthetic runtime event",
                        starts_at=self.now + timedelta(days=7),
                        category="runtime",
                        registration_mode="internal_free",
                        price_amount=0,
                        status="published",
                        visibility="public",
                    ),
                )

    async def asyncTearDown(self) -> None:
        try:
            async with AsyncSessionLocal() as session:
                async with session.begin():
                    evidence_ids = list(
                        (
                            await session.scalars(
                                select(PrivacyRequest.destruction_evidence_id).where(
                                    PrivacyRequest.id.in_(self.request_ids),
                                    PrivacyRequest.destruction_evidence_id.is_not(None),
                                ),
                            )
                        ).all(),
                    )
                    if self.request_ids:
                        await session.execute(
                            delete(PrivacyRequest).where(
                                PrivacyRequest.id.in_(self.request_ids),
                            ),
                        )
                    await session.execute(
                        delete(PrivacyRetainedFinancialEvidence).where(
                            PrivacyRetainedFinancialEvidence.source_event_id
                            == self.event_id,
                        ),
                    )
                    if evidence_ids:
                        await session.execute(
                            delete(PrivacyDestructionEvidence).where(
                                PrivacyDestructionEvidence.id.in_(evidence_ids),
                            ),
                        )
                    if self.user_ids:
                        await session.execute(
                            delete(AppUser).where(AppUser.id.in_(self.user_ids)),
                        )
                    await session.execute(
                        delete(Event).where(Event.id == self.event_id),
                    )
                    await session.execute(
                        delete(Community).where(Community.id == self.community_id),
                    )
        finally:
            await engine.dispose()

    async def _add_subject(
        self,
        *,
        failure_code: str | None = None,
        cancelled: bool = False,
        completed: bool = False,
    ) -> tuple[UUID, UUID, str, str]:
        user_id = uuid4()
        request_id = uuid4()
        email = f"runtime-{self.marker}-{len(self.user_ids)}@example.invalid"
        phone = f"+7998{int(user_id.hex[:7], 16) % 10**7:07d}"
        self.user_ids.add(user_id)
        self.request_ids.add(request_id)
        async with AsyncSessionLocal() as session:
            async with session.begin():
                session.add(
                    AppUser(
                        id=user_id,
                        email=email,
                        phone=phone,
                        password_hash=f"synthetic-{self.marker}",
                        account_origin="password_signup",
                        claim_state="claimed",
                        status="deletion_pending",
                        deletion_requested_at=self.now,
                    ),
                )
                await session.flush()
                evidence_id = None
                if completed:
                    evidence = PrivacyDestructionEvidence(
                        subject_ref_hash=f"completed-{request_id.hex}",
                        execution_version=PRIVACY_ERASURE_EXECUTION_VERSION,
                        result_status="completed",
                        completed_at=self.now,
                        categories_deleted=["account"],
                        categories_retained=[],
                        created_at=self.now,
                    )
                    session.add(evidence)
                    await session.flush()
                    evidence_id = evidence.id
                session.add(
                    PrivacyRequest(
                        id=request_id,
                        user_id=user_id,
                        request_type="deletion",
                        message="Synthetic private runtime request",
                        status="resolved" if completed else "open",
                        identity_verified_at=self.now,
                        processing_stopped_at=self.now,
                        execution_started_at=self.now if completed else None,
                        completed_at=self.now if completed else None,
                        pre_deletion_user_status="active",
                        cancelled_at=self.now if cancelled else None,
                        destruction_evidence_id=evidence_id,
                        failure_code=failure_code,
                        created_at=self.queue_created_at,
                        updated_at=self.now,
                    ),
                )
        return user_id, request_id, email, phone

    async def _add_paid_registration(self, user_id: UUID) -> UUID:
        registration_id = uuid4()
        self.registration_ids.add(registration_id)
        async with AsyncSessionLocal() as session:
            async with session.begin():
                session.add(
                    EventRegistration(
                        id=registration_id,
                        event_id=self.event_id,
                        user_id=user_id,
                        status="confirmed",
                        source_channel="public_web",
                        seats_count=1,
                        payment_status="paid",
                        payment_id=f"synthetic-{registration_id.hex}",
                    ),
                )
                await session.flush()
                session.add(
                    EventRegistrationOptionSelection(
                        registration_id=registration_id,
                        title_snapshot="Synthetic participation",
                        option_type_snapshot="participation",
                        quantity=1,
                        unit_price_amount=12500,
                        total_amount=12500,
                        currency="RUB",
                        counts_toward_capacity=True,
                        seats_count=1,
                        is_donation=False,
                    ),
                )
        return registration_id

    def _runtime(self, executor, *, batch_size: int = 10) -> PrivacyErasureRuntime:
        return PrivacyErasureRuntime(
            settings=self.settings.model_copy(
                update={"api_privacy_erasure_batch_size": batch_size},
            ),
            executor=executor,
        )

    async def test_eligible_requests_are_automatic_and_batch_is_bounded(self) -> None:
        for _ in range(3):
            await self._add_subject()
        executor = AsyncMock(
            return_value=PrivacyErasureWorkerResult(uuid4(), "retryable_failure"),
        )
        processed = await self._runtime(executor, batch_size=2).run_once()
        self.assertEqual(processed, 2)
        self.assertEqual(executor.await_count, 2)

    async def test_empty_queue_waits_for_poll_interval_without_hot_loop(self) -> None:
        stop = asyncio.Event()
        runtime = self._runtime(AsyncMock())
        task = asyncio.create_task(run_worker(worker=runtime, shutdown_event=stop))
        await asyncio.sleep(0.05)
        stop.set()
        await asyncio.wait_for(task, timeout=1)

    async def test_two_workers_cannot_claim_the_same_request(self) -> None:
        await self._add_subject()
        entered = asyncio.Event()
        release = asyncio.Event()
        calls: list[UUID] = []

        async def executor(request_id: UUID) -> PrivacyErasureWorkerResult:
            calls.append(request_id)
            entered.set()
            await release.wait()
            return PrivacyErasureWorkerResult(request_id, "retryable_failure")

        first = asyncio.create_task(self._runtime(executor).run_once())
        await asyncio.wait_for(entered.wait(), timeout=2)
        second_count = await self._runtime(executor).run_once()
        release.set()
        first_count = await asyncio.wait_for(first, timeout=2)
        self.assertEqual((first_count, second_count), (1, 0))
        self.assertEqual(len(calls), 1)

    async def test_completed_and_cancelled_requests_are_not_executed(self) -> None:
        _, completed_request, _, _ = await self._add_subject(completed=True)
        _, cancelled_request, _, _ = await self._add_subject(cancelled=True)
        claimed: list[UUID] = []

        async def executor(request_id: UUID) -> PrivacyErasureWorkerResult:
            claimed.append(request_id)
            return PrivacyErasureWorkerResult(request_id, "retryable_failure")

        await self._runtime(executor, batch_size=100).run_once()
        self.assertNotIn(completed_request, claimed)
        self.assertNotIn(cancelled_request, claimed)

    async def test_retryable_failure_is_picked_up_again(self) -> None:
        _, request_id, _, _ = await self._add_subject(
            failure_code=DATABASE_FAILURE_CODE,
        )
        executor = AsyncMock(
            return_value=PrivacyErasureWorkerResult(
                request_id,
                "retryable_failure",
                failure_code=DATABASE_FAILURE_CODE,
            ),
        )
        runtime = self._runtime(executor, batch_size=1)
        self.assertEqual(await runtime.run_once(), 1)
        self.assertEqual(await runtime.run_once(), 1)
        self.assertEqual(executor.await_count, 2)

    async def test_manual_review_is_not_polled_again(self) -> None:
        _, request_id, _, _ = await self._add_subject()

        async def executor(claimed_id: UUID) -> PrivacyErasureWorkerResult:
            async with AsyncSessionLocal() as session:
                async with session.begin():
                    await session.execute(
                        update(PrivacyRequest)
                        .where(PrivacyRequest.id == claimed_id)
                        .values(failure_code=MANUAL_REVIEW_FAILURE_CODE),
                    )
            return PrivacyErasureWorkerResult(
                claimed_id,
                "not_eligible",
                failure_code=MANUAL_REVIEW_FAILURE_CODE,
            )

        runtime = self._runtime(executor, batch_size=1)
        self.assertEqual(await runtime.run_once(), 1)
        self.assertEqual(await runtime.run_once(), 0)
        async with AsyncSessionLocal() as session:
            request = await session.get(PrivacyRequest, request_id)
        self.assertEqual(request.failure_code, MANUAL_REVIEW_FAILURE_CODE)

    async def test_unexpected_request_failure_does_not_stop_later_work(self) -> None:
        await self._add_subject()
        await self._add_subject()
        calls = 0

        async def executor(request_id: UUID) -> PrivacyErasureWorkerResult:
            nonlocal calls
            calls += 1
            if calls == 1:
                raise RuntimeError("synthetic sensitive provider detail")
            return PrivacyErasureWorkerResult(request_id, "retryable_failure")

        with self.assertLogs(
            "app.workers.privacy_erasure",
            level=logging.ERROR,
        ) as captured:
            self.assertEqual(await self._runtime(executor).run_once(), 2)
        self.assertEqual(calls, 2)
        self.assertNotIn("sensitive provider detail", "\n".join(captured.output))

    async def test_runtime_preserves_retention_idempotency_and_privacy(self) -> None:
        free_user, free_request, free_email, free_phone = await self._add_subject()
        paid_user, paid_request, paid_email, paid_phone = await self._add_subject()
        paid_registration = await self._add_paid_registration(paid_user)
        async with AsyncSessionLocal() as session:
            async with session.begin():
                session.add(
                    PrayerActivityLog(
                        user_id=free_user,
                        activity_type="mincha",
                        activity_date=date.today(),
                        completed_at=self.now,
                        city="Synthetic City",
                    ),
                )

        async def executor(request_id: UUID) -> PrivacyErasureWorkerResult:
            return await execute_privacy_erasure_request(
                request_id,
                settings=self.settings,
                register_storage_factory=lambda: self.register_storage,
                notification_email_sender=lambda **_kwargs: EmailSendResult(
                    sent=True,
                    disabled=False,
                ),
            )

        statements: list[str] = []

        def capture_statement(_conn, _cursor, statement, _params, _context, _many):
            statements.append(statement.lower())

        sqlalchemy_event.listen(
            engine.sync_engine,
            "before_cursor_execute",
            capture_statement,
        )
        try:
            with self.assertLogs(
                "app.workers.privacy_erasure",
                level=logging.INFO,
            ) as captured:
                self.assertEqual(await self._runtime(executor).run_once(), 2)
        finally:
            sqlalchemy_event.remove(
                engine.sync_engine,
                "before_cursor_execute",
                capture_statement,
            )

        async with AsyncSessionLocal() as session:
            requests = list(
                (
                    await session.scalars(
                        select(PrivacyRequest).where(
                            PrivacyRequest.id.in_({free_request, paid_request}),
                        ),
                    )
                ).all(),
            )
            evidence = list(
                (
                    await session.scalars(
                        select(PrivacyDestructionEvidence).where(
                            PrivacyDestructionEvidence.id.in_(
                                {request.destruction_evidence_id for request in requests},
                            ),
                        ),
                    )
                ).all(),
            )
            retained_count = await session.scalar(
                select(func.count())
                .select_from(PrivacyRetainedFinancialEvidence)
                .where(
                    PrivacyRetainedFinancialEvidence.source_registration_id
                    == paid_registration,
                ),
            )
        self.assertEqual(
            {item.result_status for item in evidence},
            {"completed", "completed_with_retention"},
        )
        self.assertEqual(len(evidence), 2)
        self.assertEqual(retained_count, 1)
        self.assertEqual(await self._runtime(executor).run_once(), 0)

        async with AsyncSessionLocal() as session:
            evidence_count_after_restart = await session.scalar(
                select(func.count())
                .select_from(PrivacyDestructionEvidence)
                .where(
                    PrivacyDestructionEvidence.id.in_(
                        {item.id for item in evidence},
                    ),
                ),
            )
            retained_count_after_restart = await session.scalar(
                select(func.count())
                .select_from(PrivacyRetainedFinancialEvidence)
                .where(
                    PrivacyRetainedFinancialEvidence.source_registration_id
                    == paid_registration,
                ),
            )
        self.assertEqual(evidence_count_after_restart, 2)
        self.assertEqual(retained_count_after_restart, 1)
        prayer_sql = [sql for sql in statements if "prayer_activity_logs" in sql]
        self.assertTrue(any(sql.lstrip().startswith("delete") for sql in prayer_sql))
        self.assertFalse(any(sql.lstrip().startswith("select") for sql in prayer_sql))
        self.assertFalse(any("returning" in sql for sql in prayer_sql))
        safe_logs = "\n".join(captured.output)
        for private_value in (
            free_email,
            free_phone,
            paid_email,
            paid_phone,
            "Synthetic private runtime request",
            "Synthetic City",
        ):
            self.assertNotIn(private_value, safe_logs)


if __name__ == "__main__":
    unittest.main()
