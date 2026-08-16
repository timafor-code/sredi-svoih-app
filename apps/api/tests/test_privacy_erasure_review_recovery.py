from __future__ import annotations

import base64
import unittest
from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock
from uuid import UUID, uuid4

from sqlalchemy import delete, func, select

from app.core.config import Settings
from app.db.models.core import (
    AppUser,
    Community,
    Event,
    EventCategory,
    EventRegistration,
    PrivacyDestructionEvidence,
    PrivacyRequest,
)
from app.db.models.privacy_financial_review import PrivacyFinancialReviewEvidence
from app.db.session import AsyncSessionLocal, engine
from app.services.email_delivery import EmailSendResult
from app.services.privacy_erasure_worker import (
    MANUAL_REVIEW_FAILURE_CODE,
    RETENTION_CONFIGURATION_FAILURE_CODE,
    execute_privacy_erasure_request,
)
from app.workers.privacy_erasure import PrivacyErasureRuntime


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


class PrivacyErasureReviewRecoveryTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        await engine.dispose()
        self.now = datetime.now(UTC).replace(microsecond=0)
        self.marker = uuid4().hex[:12]
        self.community_id = uuid4()
        self.event_id = uuid4()
        self.user_ids: set[UUID] = set()
        self.request_ids: set[UUID] = set()
        self.settings = Settings(
            api_privacy_erasure_worker_enabled=True,
            api_privacy_erasure_poll_interval_seconds=1,
            api_privacy_erasure_batch_size=10,
            api_privacy_erasure_notification_key_b64=base64.b64encode(
                b"synthetic-review-notice-key-32byt"
            ).decode("ascii"),
            api_privacy_erasure_notification_key_id="synthetic-review-key-v1",
            api_privacy_erasure_notification_delivery_window_hours=24,
            api_privacy_erasure_financial_retention_days=365,
        )
        self.register_storage = _FakeRegisterStorage()

        async with AsyncSessionLocal() as session:
            async with session.begin():
                session.add(
                    Community(
                        id=self.community_id,
                        name="Synthetic review recovery community",
                        city="Moscow",
                        slug=f"review-recovery-{self.marker}",
                    ),
                )
            async with session.begin():
                session.add(
                    EventCategory(
                        community_id=self.community_id,
                        slug="review-recovery",
                        title="Review recovery",
                        color="#123456",
                        icon="*",
                    ),
                )
                await session.flush()
                session.add(
                    Event(
                        id=self.event_id,
                        community_id=self.community_id,
                        title="Synthetic review recovery event",
                        starts_at=self.now + timedelta(days=7),
                        category="review-recovery",
                        registration_mode="internal_paid",
                        price_amount=12500,
                        price_currency="RUB",
                        status="published",
                        visibility="public",
                    ),
                )

    async def asyncTearDown(self) -> None:
        try:
            async with AsyncSessionLocal() as session:
                async with session.begin():
                    await session.execute(
                        delete(PrivacyFinancialReviewEvidence).where(
                            PrivacyFinancialReviewEvidence.source_event_id == self.event_id,
                        ),
                    )
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

    @staticmethod
    def _send_notification(**_kwargs) -> EmailSendResult:
        return EmailSendResult(sent=True, disabled=False)

    async def _execute(self, request_id: UUID, *, settings: Settings | None = None):
        return await execute_privacy_erasure_request(
            request_id,
            settings=settings or self.settings,
            register_storage_factory=lambda: self.register_storage,
            notification_email_sender=self._send_notification,
        )

    async def _add_inconsistent_paid_subject(self) -> tuple[UUID, UUID, UUID]:
        user_id = uuid4()
        request_id = uuid4()
        registration_id = uuid4()
        self.user_ids.add(user_id)
        self.request_ids.add(request_id)
        async with AsyncSessionLocal() as session:
            async with session.begin():
                session.add(
                    AppUser(
                        id=user_id,
                        email=f"review-{self.marker}-{len(self.user_ids)}@example.invalid",
                        account_origin="password_signup",
                        claim_state="claimed",
                        status="deletion_pending",
                        deletion_requested_at=self.now,
                    ),
                )
                await session.flush()
                session.add_all(
                    [
                        PrivacyRequest(
                            id=request_id,
                            user_id=user_id,
                            request_type="deletion",
                            status="open",
                            origin="self_service",
                            identity_verified_at=self.now,
                            processing_stopped_at=self.now,
                            pre_deletion_user_status="active",
                            created_at=self.now,
                            updated_at=self.now,
                        ),
                        EventRegistration(
                            id=registration_id,
                            event_id=self.event_id,
                            user_id=user_id,
                            status="confirmed",
                            source_channel="public_web",
                            seats_count=1,
                            payment_status="paid",
                            payment_id=f"synthetic-review-{registration_id.hex}",
                        ),
                    ],
                )
        return user_id, request_id, registration_id

    def test_review_evidence_schema_is_data_minimal(self) -> None:
        columns = {
            column.name for column in PrivacyFinancialReviewEvidence.__table__.columns
        }
        self.assertEqual(
            columns,
            {
                "id",
                "subject_ref_hash",
                "source_registration_id",
                "source_event_id",
                "financial_state",
                "observed_amount",
                "currency_codes",
                "retention_basis_code",
                "retention_until",
                "created_at",
            },
        )
        self.assertTrue(
            columns.isdisjoint(
                {
                    "name",
                    "email",
                    "phone",
                    "address",
                    "profile",
                    "comment",
                    "payment_id",
                    "user_id",
                },
            ),
        )

    async def test_manual_review_recovers_then_physically_deletes_account(self) -> None:
        user_id, request_id, registration_id = await self._add_inconsistent_paid_subject()

        first = await self._execute(request_id)
        self.assertEqual(first.result, "not_eligible")
        self.assertEqual(first.failure_code, MANUAL_REVIEW_FAILURE_CODE)

        second = await self._execute(request_id)
        self.assertEqual(second.result, "completed")
        self.assertIsNotNone(second.destruction_evidence_id)

        async with AsyncSessionLocal() as session:
            request = await session.get(PrivacyRequest, request_id)
            evidence = await session.get(
                PrivacyDestructionEvidence,
                second.destruction_evidence_id,
            )
            review = await session.scalar(
                select(PrivacyFinancialReviewEvidence).where(
                    PrivacyFinancialReviewEvidence.source_registration_id
                    == registration_id,
                ),
            )
            review_count = await session.scalar(
                select(func.count())
                .select_from(PrivacyFinancialReviewEvidence)
                .where(
                    PrivacyFinancialReviewEvidence.source_registration_id
                    == registration_id,
                ),
            )
            self.assertIsNone(await session.get(AppUser, user_id))
            self.assertIsNone(await session.get(EventRegistration, registration_id))

        self.assertIsNotNone(request.completed_at)
        self.assertIsNone(request.user_id)
        self.assertEqual(evidence.result_status, "completed_with_retention")
        self.assertEqual(evidence.categories_retained, ["financial_evidence"])
        self.assertIsNotNone(review)
        self.assertEqual(review.financial_state, "paid")
        self.assertEqual(review.observed_amount, 0)
        self.assertEqual(review.currency_codes, [])
        self.assertEqual(
            review.retention_basis_code,
            "inconsistent_finalized_event_registration_financial",
        )
        self.assertNotIn(str(user_id), review.subject_ref_hash)
        self.assertEqual(review_count, 1)

        replay = await self._execute(request_id)
        self.assertEqual(replay.result, "already_completed")
        async with AsyncSessionLocal() as session:
            replay_count = await session.scalar(
                select(func.count())
                .select_from(PrivacyFinancialReviewEvidence)
                .where(
                    PrivacyFinancialReviewEvidence.source_registration_id
                    == registration_id,
                ),
            )
        self.assertEqual(replay_count, 1)

    async def test_recovery_keeps_retention_configuration_fail_closed(self) -> None:
        user_id, request_id, registration_id = await self._add_inconsistent_paid_subject()
        first = await self._execute(request_id)
        self.assertEqual(first.failure_code, MANUAL_REVIEW_FAILURE_CODE)

        without_duration = self.settings.model_copy(
            update={"api_privacy_erasure_financial_retention_days": None},
        )
        second = await self._execute(request_id, settings=without_duration)
        self.assertEqual(second.result, "retryable_failure")
        self.assertEqual(
            second.failure_code,
            RETENTION_CONFIGURATION_FAILURE_CODE,
        )
        async with AsyncSessionLocal() as session:
            self.assertIsNotNone(await session.get(AppUser, user_id))
            review_count = await session.scalar(
                select(func.count())
                .select_from(PrivacyFinancialReviewEvidence)
                .where(
                    PrivacyFinancialReviewEvidence.source_registration_id
                    == registration_id,
                ),
            )
        self.assertEqual(review_count, 0)

        third = await self._execute(request_id)
        self.assertEqual(third.result, "completed")
        async with AsyncSessionLocal() as session:
            self.assertIsNone(await session.get(AppUser, user_id))

    async def test_only_canonical_runtime_requeues_manual_review(self) -> None:
        _, request_id, _ = await self._add_inconsistent_paid_subject()
        first = await self._execute(request_id)
        self.assertEqual(first.failure_code, MANUAL_REVIEW_FAILURE_CODE)

        custom_runtime = PrivacyErasureRuntime(
            settings=self.settings,
            executor=AsyncMock(),
        )
        async with engine.connect() as connection:
            custom_claims = await custom_runtime._claim_batch(connection)
            for claimed_id, lock_key in custom_claims:
                await custom_runtime._release_lock(connection, claimed_id, lock_key)
        self.assertNotIn(request_id, {item[0] for item in custom_claims})

        canonical_runtime = PrivacyErasureRuntime(settings=self.settings)
        async with engine.connect() as connection:
            canonical_claims = await canonical_runtime._claim_batch(connection)
            for claimed_id, lock_key in canonical_claims:
                await canonical_runtime._release_lock(connection, claimed_id, lock_key)
        self.assertIn(request_id, {item[0] for item in canonical_claims})


if __name__ == "__main__":
    unittest.main()
