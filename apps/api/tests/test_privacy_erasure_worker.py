from __future__ import annotations

import asyncio
import importlib.util
import json
from pathlib import Path
import unittest
from contextlib import redirect_stderr, redirect_stdout
from datetime import UTC, date, datetime, timedelta
from io import StringIO
from unittest.mock import AsyncMock, patch
from uuid import UUID, uuid4

from sqlalchemy import delete, event, func, select
from sqlalchemy.exc import SQLAlchemyError

from app.db.models.audit import AdminEventAuditEntry
from app.db.models.auth import (
    AuthEmailVerificationCode,
    AuthSession,
    PrivacyAccessCode,
    PrivacyAccessSession,
    WebRegistrationVerificationCode,
)
from app.db.models.avatar import ProfileAvatar
from app.db.models.core import (
    AdminFeedback,
    AppUser,
    Community,
    CommunityMembership,
    DeviceToken,
    Event,
    EventCapacityUnit,
    EventCategory,
    EventRegistration,
    EventRegistrationCapacityReservation,
    EventRegistrationOptionSelection,
    LegalAcceptance,
    LegalDocument,
    PrayerActivityLog,
    PrivacyDestructionEvidence,
    PrivacyRequest,
    Profile,
    ProfileContactVisibility,
    SyncedContact,
    WebRegistrationIdentityConflict,
    WebRegistrationIntent,
)
from app.db.models.seating import EventSeatingAssignment, EventSeatingLayout
from app.db.session import AsyncSessionLocal, engine
from app.services.privacy_erasure_worker import (
    AVATAR_STORAGE_FAILURE_CODE,
    DATABASE_FAILURE_CODE,
    MANUAL_REVIEW_FAILURE_CODE,
    PRIVACY_ERASURE_EXECUTION_VERSION,
    SUBJECT_MISSING_FAILURE_CODE,
    PrivacyErasureWorkerResult,
    execute_privacy_erasure_request,
)


def _load_cli_module():
    path = Path(__file__).resolve().parents[1] / "scripts" / "run_privacy_erasure.py"
    spec = importlib.util.spec_from_file_location("run_privacy_erasure", path)
    if spec is None or spec.loader is None:
        raise RuntimeError("privacy erasure CLI module could not be loaded")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


run_privacy_erasure = _load_cli_module()


class _FakeAvatarStorage:
    def __init__(self, *, fail: bool = False) -> None:
        self.fail = fail
        self.deleted: list[str] = []

    async def delete_avatar(self, *, object_key: str) -> None:
        self.deleted.append(object_key)
        if self.fail:
            raise RuntimeError(f"synthetic provider failure for {object_key}")


class PrivacyErasureWorkerTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        await engine.dispose()
        self.marker = uuid4().hex[:12]
        self.now = datetime.now(UTC).replace(microsecond=0)
        self.community_id = uuid4()
        self.event_id = uuid4()
        self.legal_document_id = uuid4()
        self.other_user_id = uuid4()
        self.user_ids: set[UUID] = {self.other_user_id}
        self.request_ids: set[UUID] = set()
        self.evidence_ids: set[UUID] = set()

        async with AsyncSessionLocal() as session:
            async with session.begin():
                session.add_all(
                    [
                        Community(
                            id=self.community_id,
                            name="Synthetic worker community",
                            city="Moscow",
                            slug=f"worker-{self.marker}",
                        ),
                        AppUser(
                            id=self.other_user_id,
                            email=f"other-{self.marker}@example.invalid",
                            account_origin="migration",
                            claim_state="claimed",
                            status="active",
                        ),
                    ],
                )
                await session.flush()
                session.add(
                    EventCategory(
                        community_id=self.community_id,
                        slug="community",
                        title="Community",
                        color="#123456",
                        icon="*",
                    ),
                )
                await session.flush()
                session.add_all(
                    [
                        Event(
                            id=self.event_id,
                            community_id=self.community_id,
                            title="Synthetic worker event",
                            starts_at=self.now + timedelta(days=10),
                            category="community",
                            registration_mode="internal_free",
                            price_amount=0,
                            status="published",
                            visibility="public",
                        ),
                        LegalDocument(
                            id=self.legal_document_id,
                            document_type="event_registration_consent",
                            version=f"worker-{self.marker}",
                            title="Synthetic worker legal document",
                            content_hash=f"sha256:{self.marker}",
                            published_url="https://example.invalid/legal",
                            effective_at=self.now - timedelta(days=1),
                        ),
                    ],
                )

    async def asyncTearDown(self) -> None:
        try:
            async with AsyncSessionLocal() as session:
                async with session.begin():
                    await session.execute(
                        delete(AdminEventAuditEntry).where(
                            AdminEventAuditEntry.event_id == self.event_id,
                        ),
                    )
                    if self.request_ids:
                        await session.execute(
                            delete(PrivacyRequest).where(
                                PrivacyRequest.id.in_(self.request_ids),
                            ),
                        )
                    if self.evidence_ids:
                        await session.execute(
                            delete(PrivacyDestructionEvidence).where(
                                PrivacyDestructionEvidence.id.in_(self.evidence_ids),
                            ),
                        )
                    await session.execute(
                        delete(LegalDocument).where(
                            LegalDocument.id == self.legal_document_id,
                        ),
                    )
                    await session.execute(
                        delete(Community).where(Community.id == self.community_id),
                    )
                    if self.user_ids:
                        await session.execute(
                            delete(AppUser).where(AppUser.id.in_(self.user_ids)),
                        )
        finally:
            await engine.dispose()

    async def _add_subject(
        self,
        *,
        request_type: str = "deletion",
        verified: bool = True,
        processing_stopped: bool = True,
        status: str = "deletion_pending",
        cancelled: bool = False,
    ) -> tuple[UUID, UUID, str, str]:
        user_id = uuid4()
        request_id = uuid4()
        email = f"subject-{self.marker}-{len(self.user_ids)}@example.invalid"
        phone = f"+7999{int(user_id.hex[:7], 16) % 10**7:07d}"
        self.user_ids.add(user_id)
        self.request_ids.add(request_id)
        async with AsyncSessionLocal() as session:
            async with session.begin():
                session.add(
                    AppUser(
                        id=user_id,
                        email=email,
                        phone=phone,
                        password_hash=f"synthetic-hash-{self.marker}",
                        account_origin="password_signup",
                        claim_state="claimed",
                        status=status,
                        deletion_requested_at=self.now
                        if status == "deletion_pending"
                        else None,
                    ),
                )
                await session.flush()
                session.add(
                    PrivacyRequest(
                        id=request_id,
                        user_id=user_id,
                        request_type=request_type,
                        message="Synthetic privacy request content",
                        status="open",
                        identity_verified_at=self.now if verified else None,
                        processing_stopped_at=self.now
                        if verified and processing_stopped
                        else None,
                        pre_deletion_user_status="active"
                        if processing_stopped
                        else None,
                        cancelled_at=self.now if cancelled else None,
                        created_at=self.now,
                        updated_at=self.now,
                    ),
                )
        return user_id, request_id, email, phone

    async def _add_complete_graph(
        self,
        user_id: UUID,
        request_id: UUID,
        email: str,
        phone: str,
    ) -> dict[str, UUID | str | datetime]:
        ids = {
            "profile": uuid4(),
            "avatar": uuid4(),
            "registration": uuid4(),
            "selection": uuid4(),
            "capacity_unit": uuid4(),
            "reservation": uuid4(),
            "layout": uuid4(),
            "assignment": uuid4(),
            "intent": uuid4(),
            "verification": uuid4(),
            "conflict": uuid4(),
            "other_request": uuid4(),
            "audit": uuid4(),
        }
        self.request_ids.add(ids["other_request"])
        avatar_key = f"synthetic/avatar/{uuid4().hex}"
        async with AsyncSessionLocal() as session:
            async with session.begin():
                session.add_all(
                    [
                        ProfileAvatar(
                            id=ids["avatar"],
                            user_id=user_id,
                            object_key=avatar_key,
                            content_type="image/png",
                            status="deleted",
                            deleted_at=self.now,
                        ),
                        Profile(
                            id=ids["profile"],
                            user_id=user_id,
                            full_name="Synthetic Subject",
                            email=email,
                            phone=phone,
                            avatar_id=ids["avatar"],
                        ),
                        ProfileContactVisibility(user_id=user_id),
                        CommunityMembership(
                            community_id=self.community_id,
                            user_id=user_id,
                            role="admin",
                            status="active",
                        ),
                        DeviceToken(
                            user_id=user_id,
                            expo_push_token=f"ExponentPushToken[{uuid4().hex}]",
                        ),
                        SyncedContact(
                            user_id=user_id,
                            name="Synthetic Contact",
                            phone_hash=f"phone-{self.marker}",
                        ),
                        PrayerActivityLog(
                            user_id=user_id,
                            activity_type="mincha",
                            activity_date=date.today(),
                            completed_at=self.now,
                            city="Synthetic City",
                        ),
                        AuthSession(
                            user_id=user_id,
                            refresh_token_hash=f"refresh-{uuid4().hex}",
                            expires_at=self.now + timedelta(hours=1),
                        ),
                        AuthEmailVerificationCode(
                            user_id=user_id,
                            code_hash=f"email-{uuid4().hex}",
                            expires_at=self.now + timedelta(hours=1),
                        ),
                        PrivacyAccessCode(
                            user_id=user_id,
                            code_hash=f"privacy-code-{uuid4().hex}",
                            expires_at=self.now + timedelta(hours=1),
                        ),
                        PrivacyAccessSession(
                            user_id=user_id,
                            token_hash=f"privacy-session-{uuid4().hex}",
                            scope="privacy_self_service",
                            expires_at=self.now + timedelta(hours=1),
                        ),
                        AdminFeedback(
                            community_id=self.community_id,
                            user_id=user_id,
                            section="worker",
                            message="Synthetic feedback content",
                        ),
                        EventCapacityUnit(
                            id=ids["capacity_unit"],
                            event_id=self.event_id,
                            key=f"main-{self.marker}",
                            title="Main capacity",
                            capacity=20,
                        ),
                        EventRegistration(
                            id=ids["registration"],
                            event_id=self.event_id,
                            user_id=user_id,
                            status="attended",
                            source_channel="mobile",
                            seats_count=1,
                            guest_names=["Synthetic Guest"],
                            comment="Synthetic registration content",
                            payment_status="not_required",
                        ),
                    ],
                )
                await session.flush()
                session.add_all(
                    [
                        EventRegistrationOptionSelection(
                            id=ids["selection"],
                            registration_id=ids["registration"],
                            title_snapshot="Free option",
                            option_type_snapshot="participation",
                            quantity=1,
                            unit_price_amount=0,
                            total_amount=0,
                            seats_count=1,
                            is_donation=False,
                        ),
                        EventRegistrationCapacityReservation(
                            id=ids["reservation"],
                            registration_id=ids["registration"],
                            event_id=self.event_id,
                            capacity_unit_id=ids["capacity_unit"],
                            capacity_unit_key_snapshot="main",
                            capacity_unit_title_snapshot="Main capacity",
                            quantity=1,
                            seats_per_quantity=1,
                            seats_count=1,
                        ),
                        EventSeatingLayout(
                            id=ids["layout"],
                            community_id=self.community_id,
                            event_id=self.event_id,
                            capacity_unit_id=ids["capacity_unit"],
                            title="Synthetic seating",
                            created_by=self.other_user_id,
                        ),
                        LegalAcceptance(
                            user_id=user_id,
                            registration_id=ids["registration"],
                            legal_document_id=self.legal_document_id,
                            accepted_at=self.now,
                            acceptance_method="authenticated_action",
                            source_channel="mobile",
                            evidence_version="synthetic-v1",
                        ),
                    ],
                )
                await session.flush()
                session.add(
                    EventSeatingAssignment(
                        id=ids["assignment"],
                        layout_id=ids["layout"],
                        registration_id=ids["registration"],
                        user_id=user_id,
                        seat_key="table-1:a",
                        guest_index=0,
                        guest_label="Synthetic Subject",
                        guest_initials="SS",
                        created_by=self.other_user_id,
                    ),
                )
                session.add(
                    WebRegistrationIntent(
                        id=ids["intent"],
                        flow_token_hash=f"flow-{uuid4().hex}",
                        event_id=self.event_id,
                        matched_user_id=user_id,
                        first_name="Synthetic",
                        last_name="Subject",
                        email_normalized=email,
                        phone_normalized=phone,
                        seats_count=1,
                        option_payload=[],
                        answer_payload=[],
                        legal_acceptance_payload=[],
                        account_choice="without_password",
                        status="confirmed",
                        idempotency_key_hash=f"idem-{uuid4().hex}",
                        request_fingerprint_hash=f"fingerprint-{uuid4().hex}",
                        expires_at=self.now + timedelta(hours=1),
                        confirmed_at=self.now,
                        created_at=self.now,
                    ),
                )
                await session.flush()
                session.add_all(
                    [
                        WebRegistrationVerificationCode(
                            id=ids["verification"],
                            registration_intent_id=ids["intent"],
                            code_hash=f"web-code-{uuid4().hex}",
                            expires_at=self.now + timedelta(hours=1),
                        ),
                        WebRegistrationIdentityConflict(
                            id=ids["conflict"],
                            registration_intent_id=ids["intent"],
                            category="email_phone_different_users",
                            email_user_id=user_id,
                            phone_user_id=self.other_user_id,
                            status="open",
                        ),
                        PrivacyRequest(
                            id=ids["other_request"],
                            user_id=user_id,
                            request_type="correction",
                            message="Synthetic secondary content",
                            resolution_note="Synthetic resolution content",
                            status="reviewed",
                            created_at=self.now,
                            updated_at=self.now,
                        ),
                        AdminEventAuditEntry(
                            id=ids["audit"],
                            actor_user_id=user_id,
                            event_id=self.event_id,
                            action="event_web_visibility_changed",
                            old_state="disabled",
                            new_state="listed",
                            created_at=self.now,
                        ),
                        CommunityMembership(
                            community_id=self.community_id,
                            user_id=self.other_user_id,
                            role="member",
                            status="active",
                        ),
                    ],
                )
        ids["avatar_key"] = avatar_key
        return ids

    async def test_complete_graph_is_private_idempotent_and_preserves_audit(self) -> None:
        user_id, request_id, email, phone = await self._add_subject()
        ids = await self._add_complete_graph(user_id, request_id, email, phone)
        storage = _FakeAvatarStorage()
        statements: list[str] = []

        def capture_statement(_conn, _cursor, statement, _parameters, _context, _many):
            statements.append(statement.lower())

        event.listen(engine.sync_engine, "before_cursor_execute", capture_statement)
        try:
            first = await execute_privacy_erasure_request(
                request_id,
                storage_factory=lambda: storage,
            )
        finally:
            event.remove(engine.sync_engine, "before_cursor_execute", capture_statement)

        self.assertEqual(first.result, "completed")
        self.assertIsNotNone(first.destruction_evidence_id)
        self.evidence_ids.add(first.destruction_evidence_id)
        self.assertEqual(storage.deleted, [ids["avatar_key"]])
        prayer_statements = [
            statement for statement in statements if "prayer_activity_logs" in statement
        ]
        self.assertTrue(any(statement.lstrip().startswith("delete") for statement in prayer_statements))
        self.assertFalse(any(statement.lstrip().startswith("select") for statement in prayer_statements))
        self.assertFalse(any("returning" in statement for statement in prayer_statements))

        async with AsyncSessionLocal() as session:
            current_request = await session.get(PrivacyRequest, request_id)
            secondary_request = await session.get(PrivacyRequest, ids["other_request"])
            evidence = await session.get(
                PrivacyDestructionEvidence,
                first.destruction_evidence_id,
            )
            audit = await session.get(AdminEventAuditEntry, ids["audit"])
            checks = {
                "user": await session.get(AppUser, user_id),
                "profile": await session.get(Profile, ids["profile"]),
                "avatar": await session.get(ProfileAvatar, ids["avatar"]),
                "registration": await session.get(
                    EventRegistration,
                    ids["registration"],
                ),
                "selection": await session.get(
                    EventRegistrationOptionSelection,
                    ids["selection"],
                ),
                "reservation": await session.get(
                    EventRegistrationCapacityReservation,
                    ids["reservation"],
                ),
                "assignment": await session.get(
                    EventSeatingAssignment,
                    ids["assignment"],
                ),
                "intent": await session.get(WebRegistrationIntent, ids["intent"]),
                "verification": await session.get(
                    WebRegistrationVerificationCode,
                    ids["verification"],
                ),
                "conflict": await session.get(
                    WebRegistrationIdentityConflict,
                    ids["conflict"],
                ),
            }
            event_row = await session.get(Event, self.event_id)
            legal_document = await session.get(LegalDocument, self.legal_document_id)
            other_user = await session.get(AppUser, self.other_user_id)
            other_membership = await session.scalar(
                select(CommunityMembership).where(
                    CommunityMembership.user_id == self.other_user_id,
                ),
            )

        self.assertTrue(all(value is None for value in checks.values()))
        self.assertIsNone(current_request.user_id)
        self.assertIsNone(current_request.message)
        self.assertIsNone(current_request.resolution_note)
        self.assertIsNotNone(current_request.completed_at)
        self.assertEqual(current_request.status, "resolved")
        self.assertIsNone(secondary_request.user_id)
        self.assertIsNone(secondary_request.message)
        self.assertIsNone(secondary_request.resolution_note)
        self.assertIsNotNone(evidence)
        self.assertEqual(evidence.execution_version, PRIVACY_ERASURE_EXECUTION_VERSION)
        self.assertEqual(evidence.result_status, "completed")
        self.assertEqual(evidence.categories_retained, [])
        self.assertIsNone(evidence.retention_until)
        self.assertNotIn(str(user_id), evidence.subject_ref_hash)
        self.assertNotIn(str(user_id), json.dumps(evidence.categories_deleted))
        self.assertEqual(
            set(evidence.categories_deleted),
            {
                "account",
                "avatar",
                "contact",
                "credential",
                "device",
                "feedback",
                "legal_acceptance",
                "membership",
                "prayer_activity",
                "privacy_request_content",
                "profile",
                "registration",
                "session",
                "synced_contact",
                "web_registration_intent",
            },
        )
        self.assertIsNotNone(audit)
        self.assertIsNone(audit.actor_user_id)
        self.assertEqual(audit.event_id, self.event_id)
        self.assertEqual(audit.action, "event_web_visibility_changed")
        self.assertEqual(audit.old_state, "disabled")
        self.assertEqual(audit.new_state, "listed")
        self.assertEqual(audit.created_at, self.now)
        self.assertIsNotNone(event_row)
        self.assertIsNotNone(legal_document)
        self.assertIsNotNone(other_user)
        self.assertIsNotNone(other_membership)

        second = await execute_privacy_erasure_request(
            request_id,
            storage_factory=lambda: (_ for _ in ()).throw(
                AssertionError("storage must not be used"),
            ),
        )
        self.assertEqual(second.result, "already_completed")
        self.assertEqual(second.destruction_evidence_id, first.destruction_evidence_id)

    async def test_avatar_failure_preserves_database_and_is_retryable(self) -> None:
        user_id, request_id, _, _ = await self._add_subject()
        avatar_id = uuid4()
        object_key = f"synthetic/avatar/{uuid4().hex}"
        async with AsyncSessionLocal() as session:
            async with session.begin():
                session.add(
                    ProfileAvatar(
                        id=avatar_id,
                        user_id=user_id,
                        object_key=object_key,
                        content_type="image/png",
                        status="pending",
                    ),
                )
        storage = _FakeAvatarStorage(fail=True)
        with self.assertNoLogs("app.services.privacy_erasure_worker", level="WARNING"):
            result = await execute_privacy_erasure_request(
                request_id,
                storage_factory=lambda: storage,
            )
        self.assertEqual(result.result, "retryable_failure")
        self.assertEqual(result.failure_code, AVATAR_STORAGE_FAILURE_CODE)
        async with AsyncSessionLocal() as session:
            user = await session.get(AppUser, user_id)
            avatar = await session.get(ProfileAvatar, avatar_id)
            request = await session.get(PrivacyRequest, request_id)
            evidence_count = await session.scalar(
                select(func.count()).select_from(PrivacyDestructionEvidence),
            )
        self.assertIsNotNone(user)
        self.assertIsNotNone(avatar)
        self.assertIsNotNone(request.execution_started_at)
        self.assertIsNone(request.completed_at)
        self.assertEqual(request.failure_code, AVATAR_STORAGE_FAILURE_CODE)
        self.assertEqual(evidence_count, 0)

    async def test_database_failure_after_storage_rolls_back_and_retry_completes(self) -> None:
        user_id, request_id, _, _ = await self._add_subject()
        avatar_id = uuid4()
        object_key = f"synthetic/avatar/{uuid4().hex}"
        async with AsyncSessionLocal() as session:
            async with session.begin():
                session.add(
                    ProfileAvatar(
                        id=avatar_id,
                        user_id=user_id,
                        object_key=object_key,
                        content_type="image/png",
                        status="active",
                    ),
                )
        storage = _FakeAvatarStorage()

        async def fail_after_storage(_session) -> None:
            raise SQLAlchemyError("synthetic database failure")

        failed = await execute_privacy_erasure_request(
            request_id,
            storage_factory=lambda: storage,
            after_storage=fail_after_storage,
        )
        self.assertEqual(failed.result, "retryable_failure")
        self.assertEqual(failed.failure_code, DATABASE_FAILURE_CODE)
        async with AsyncSessionLocal() as session:
            self.assertIsNotNone(await session.get(AppUser, user_id))
            self.assertIsNotNone(await session.get(ProfileAvatar, avatar_id))

        completed = await execute_privacy_erasure_request(
            request_id,
            storage_factory=lambda: storage,
        )
        self.assertEqual(completed.result, "completed")
        self.evidence_ids.add(completed.destruction_evidence_id)
        self.assertEqual(storage.deleted, [object_key, object_key])
        async with AsyncSessionLocal() as session:
            self.assertIsNone(await session.get(AppUser, user_id))
            count = await session.scalar(
                select(func.count())
                .select_from(PrivacyDestructionEvidence)
                .where(PrivacyDestructionEvidence.id == completed.destruction_evidence_id),
            )
        self.assertEqual(count, 1)

    async def test_manual_review_and_invalid_lifecycle_do_not_claim_or_delete(self) -> None:
        paid_user, paid_request, _, _ = await self._add_subject()
        async with AsyncSessionLocal() as session:
            async with session.begin():
                session.add(
                    EventRegistration(
                        event_id=self.event_id,
                        user_id=paid_user,
                        status="confirmed",
                        source_channel="mobile",
                        seats_count=1,
                        payment_status="paid",
                    ),
                )
        manual = await execute_privacy_erasure_request(
            paid_request,
            storage_factory=lambda: (_ for _ in ()).throw(
                AssertionError("storage must not be used"),
            ),
        )
        self.assertEqual(manual.result, "not_eligible")
        self.assertEqual(manual.failure_code, MANUAL_REVIEW_FAILURE_CODE)
        async with AsyncSessionLocal() as session:
            request = await session.get(PrivacyRequest, paid_request)
            self.assertIsNone(request.execution_started_at)
            self.assertIsNotNone(await session.get(AppUser, paid_user))

        cases = [
            {"request_type": "correction"},
            {"verified": False, "processing_stopped": False},
            {"processing_stopped": False},
            {"status": "active"},
            {"cancelled": True},
        ]
        for values in cases:
            user_id, request_id, _, _ = await self._add_subject(**values)
            result = await execute_privacy_erasure_request(
                request_id,
                storage_factory=lambda: (_ for _ in ()).throw(
                    AssertionError("storage must not be used"),
                ),
            )
            self.assertEqual(result.result, "not_eligible")
            async with AsyncSessionLocal() as session:
                self.assertIsNotNone(await session.get(AppUser, user_id))

    async def test_missing_subject_does_not_create_evidence(self) -> None:
        user_id, request_id, _, _ = await self._add_subject()
        async with AsyncSessionLocal() as session:
            async with session.begin():
                await session.execute(delete(AppUser).where(AppUser.id == user_id))
        result = await execute_privacy_erasure_request(request_id)
        self.assertEqual(result.result, "not_eligible")
        self.assertEqual(result.failure_code, SUBJECT_MISSING_FAILURE_CODE)
        async with AsyncSessionLocal() as session:
            request = await session.get(PrivacyRequest, request_id)
            evidence_count = await session.scalar(
                select(func.count()).select_from(PrivacyDestructionEvidence),
            )
        self.assertIsNone(request.user_id)
        self.assertIsNone(request.completed_at)
        self.assertEqual(request.failure_code, SUBJECT_MISSING_FAILURE_CODE)
        self.assertEqual(evidence_count, 0)

    async def test_concurrent_workers_serialize_to_one_evidence(self) -> None:
        user_id, request_id, _, _ = await self._add_subject()
        results = await asyncio.gather(
            execute_privacy_erasure_request(request_id),
            execute_privacy_erasure_request(request_id),
        )
        self.assertEqual(
            {result.result for result in results},
            {"completed", "already_completed"},
        )
        evidence_ids = {
            result.destruction_evidence_id
            for result in results
            if result.destruction_evidence_id is not None
        }
        self.assertEqual(len(evidence_ids), 1)
        self.evidence_ids.update(evidence_ids)
        async with AsyncSessionLocal() as session:
            self.assertIsNone(await session.get(AppUser, user_id))
            count = await session.scalar(
                select(func.count())
                .select_from(PrivacyDestructionEvidence)
                .where(PrivacyDestructionEvidence.id.in_(evidence_ids)),
            )
        self.assertEqual(count, 1)


class PrivacyErasureCliTests(unittest.TestCase):
    def test_invalid_uuid_returns_usage_exit_without_stdout(self) -> None:
        stdout = StringIO()
        stderr = StringIO()
        with redirect_stdout(stdout), redirect_stderr(stderr):
            exit_code = run_privacy_erasure.main(["--request-id", "not-a-uuid"])
        self.assertEqual(exit_code, 64)
        self.assertEqual(stdout.getvalue(), "")
        self.assertNotIn("not-a-uuid", stderr.getvalue())

    def test_result_exit_codes_and_safe_json(self) -> None:
        request_id = uuid4()
        evidence_id = uuid4()
        cases = [
            ("completed", None, 0),
            ("already_completed", None, 0),
            ("retryable_failure", DATABASE_FAILURE_CODE, 1),
            ("not_eligible", MANUAL_REVIEW_FAILURE_CODE, 2),
        ]
        for result_name, failure_code, expected_exit in cases:
            result = PrivacyErasureWorkerResult(
                request_id=request_id,
                result=result_name,
                destruction_evidence_id=evidence_id
                if result_name in {"completed", "already_completed"}
                else None,
                failure_code=failure_code,
            )
            stdout = StringIO()
            with patch.object(
                run_privacy_erasure,
                "execute_privacy_erasure_request",
                new=AsyncMock(return_value=result),
            ), redirect_stdout(stdout):
                exit_code = run_privacy_erasure.main(
                    ["--request-id", str(request_id)],
                )
            payload = json.loads(stdout.getvalue())
            self.assertEqual(exit_code, expected_exit)
            self.assertEqual(payload["request_id"], str(request_id))
            self.assertEqual(payload["result"], result_name)
            self.assertEqual(
                payload["execution_version"],
                PRIVACY_ERASURE_EXECUTION_VERSION,
            )
            output = stdout.getvalue().lower()
            for forbidden in (
                "email",
                "phone",
                "object_key",
                "password",
                "payment",
                "prayer",
                "exception",
            ):
                self.assertNotIn(forbidden, output)


if __name__ == "__main__":
    unittest.main()
