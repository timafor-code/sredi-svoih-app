from __future__ import annotations

import asyncio
import base64
import importlib.util
import json
from pathlib import Path
import unittest
from contextlib import redirect_stderr, redirect_stdout
from datetime import UTC, date, datetime, timedelta
from io import StringIO
from unittest.mock import AsyncMock, patch
from uuid import UUID, uuid4

from sqlalchemy import delete, event, func, select, update
from sqlalchemy.exc import SQLAlchemyError

from app.core.config import Settings
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
    EventRegistrationAnswer,
    EventRegistrationCapacityReservation,
    EventRegistrationForm,
    EventRegistrationFormField,
    EventRegistrationOptionSelection,
    LegalAcceptance,
    LegalDocument,
    PrayerActivityLog,
    PrivacyDestructionEvidence,
    PrivacyErasureNotificationOutbox,
    PrivacyRetainedFinancialEvidence,
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
    RETENTION_CONFIGURATION_FAILURE_CODE,
    RESTORE_REGISTER_FAILURE_CODE,
    SUBJECT_MISSING_FAILURE_CODE,
    PrivacyErasureWorkerResult,
    execute_privacy_erasure_request,
)
from app.services.privacy_erasure_restore_register import (
    ensure_restore_register_marker,
    privacy_erasure_subject_ref_hash,
)
from app.services.email_delivery import EmailSendResult


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


class _FakeRegisterStorage:
    def __init__(self, *, fail_reads: bool = False, fail_writes: bool = False) -> None:
        self.fail_reads = fail_reads
        self.fail_writes = fail_writes
        self.objects: dict[str, bytes] = {}
        self.put_calls: list[str] = []

    async def get_object(self, key: str) -> bytes | None:
        if self.fail_reads:
            raise RuntimeError("synthetic register read failure with provider details")
        return self.objects.get(key)

    async def put_object_if_absent(self, key: str, body: bytes) -> bool:
        self.put_calls.append(key)
        if self.fail_writes:
            raise RuntimeError("synthetic register write failure with provider details")
        if key in self.objects:
            return False
        self.objects[key] = body
        return True

    async def list_object_keys(self, prefix: str) -> list[str]:
        if self.fail_reads:
            raise RuntimeError("synthetic register listing failure with provider details")
        return sorted(key for key in self.objects if key.startswith(prefix))


class PrivacyErasureWorkerTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        await engine.dispose()
        self.marker = uuid4().hex[:12]
        self.now = datetime.now(UTC).replace(microsecond=0)
        self.community_id = uuid4()
        self.event_id = uuid4()
        self.legal_document_id = uuid4()
        self.questionnaire_form_id = uuid4()
        self.questionnaire_field_id = uuid4()
        self.other_user_id = uuid4()
        self.user_ids: set[UUID] = {self.other_user_id}
        self.request_ids: set[UUID] = set()
        self.evidence_ids: set[UUID] = set()
        self.notification_settings = Settings(
            api_privacy_erasure_notification_key_b64=base64.b64encode(
                b"synthetic-worker-notice-key-32bx"
            ).decode("ascii"),
            api_privacy_erasure_notification_key_id="synthetic-worker-key-v1",
            api_privacy_erasure_notification_delivery_window_hours=24,
            api_privacy_erasure_financial_retention_days=365,
        )
        self.register_storage = _FakeRegisterStorage()

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
            async with session.begin():
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
                await session.flush()
                questionnaire = EventRegistrationForm(
                    id=self.questionnaire_form_id,
                    event_id=self.event_id,
                    channel="web",
                    version=1,
                    purpose="Ordinary worker test questionnaire",
                    status="draft",
                )
                session.add(questionnaire)
                await session.flush()
                session.add(
                    EventRegistrationFormField(
                        id=self.questionnaire_field_id,
                        form_id=self.questionnaire_form_id,
                        field_key="worker_note",
                        field_type="short_text",
                        label="Worker note",
                        required=False,
                        purpose="Ordinary worker test purpose",
                        retention_days=7,
                        options_payload=[],
                        validation_payload={},
                        data_category="ordinary",
                        sort_order=0,
                    ),
                )
                await session.flush()
                questionnaire.status = "published"
                questionnaire.published_at = self.now

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
                        delete(PrivacyRetainedFinancialEvidence).where(
                            PrivacyRetainedFinancialEvidence.source_event_id
                            == self.event_id,
                        ),
                    )
                    await session.execute(
                        delete(LegalAcceptance).where(
                            LegalAcceptance.legal_document_id == self.legal_document_id,
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

    @staticmethod
    def _send_notification(**_kwargs) -> EmailSendResult:
        return EmailSendResult(sent=True, disabled=False)

    async def _execute_worker(self, request_id: UUID, **kwargs):
        kwargs.setdefault("settings", self.notification_settings)
        kwargs.setdefault("notification_email_sender", self._send_notification)
        kwargs.setdefault(
            "register_storage_factory",
            lambda: self.register_storage,
        )
        return await execute_privacy_erasure_request(request_id, **kwargs)

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
            "answer": uuid4(),
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
                        EventRegistrationAnswer(
                            id=ids["answer"],
                            registration_id=ids["registration"],
                            field_id=self.questionnaire_field_id,
                            value_payload="Synthetic answer",
                            created_at=self.now,
                            purge_at=self.now + timedelta(days=7),
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

    async def _add_financial_registration(
        self,
        user_id: UUID,
        *,
        payment_status: str,
        amount: int = 12500,
        currency: str = "RUB",
    ) -> UUID:
        registration_id = uuid4()
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
                        payment_status=payment_status,
                        payment_id=f"synthetic-provider-{registration_id.hex}",
                    ),
                )
                await session.flush()
                session.add(
                    EventRegistrationOptionSelection(
                        registration_id=registration_id,
                        title_snapshot="Synthetic paid participation",
                        option_type_snapshot="participation",
                        quantity=1,
                        unit_price_amount=amount,
                        total_amount=amount,
                        currency=currency,
                        counts_toward_capacity=True,
                        seats_count=1,
                        is_donation=False,
                    ),
                )
        return registration_id

    async def test_complete_graph_is_private_idempotent_and_preserves_audit(self) -> None:
        user_id, request_id, email, phone = await self._add_subject()
        ids = await self._add_complete_graph(user_id, request_id, email, phone)
        storage = _FakeAvatarStorage()
        statements: list[str] = []

        def capture_statement(_conn, _cursor, statement, _parameters, _context, _many):
            statements.append(statement.lower())

        event.listen(engine.sync_engine, "before_cursor_execute", capture_statement)
        try:
            first = await self._execute_worker(
                request_id,
                storage_factory=lambda: storage,
            )
        finally:
            event.remove(engine.sync_engine, "before_cursor_execute", capture_statement)

        self.assertEqual(first.result, "completed", repr(first))
        self.assertEqual(first.notification_result, "sent")
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
            outbox = await session.scalar(
                select(PrivacyErasureNotificationOutbox).where(
                    PrivacyErasureNotificationOutbox.privacy_request_id
                    == request_id,
                ),
            )
            retained_count = await session.scalar(
                select(func.count())
                .select_from(PrivacyRetainedFinancialEvidence)
                .where(
                    PrivacyRetainedFinancialEvidence.subject_ref_hash
                    == evidence.subject_ref_hash,
                ),
            )
            checks = {
                "user": await session.get(AppUser, user_id),
                "profile": await session.get(Profile, ids["profile"]),
                "avatar": await session.get(ProfileAvatar, ids["avatar"]),
                "registration": await session.get(
                    EventRegistration,
                    ids["registration"],
                ),
                "answer": await session.get(
                    EventRegistrationAnswer,
                    ids["answer"],
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
        self.assertEqual(retained_count, 0)
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
                "questionnaire_answer",
                "registration",
                "session",
                "synced_contact",
                "web_registration_intent",
            },
        )
        self.assertIsNotNone(audit)
        self.assertIsNotNone(outbox)
        self.assertEqual(outbox.status, "sent")
        self.assertIsNone(outbox.recipient_ciphertext)
        self.assertIsNone(outbox.recipient_nonce)
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

        second = await self._execute_worker(
            request_id,
            storage_factory=lambda: (_ for _ in ()).throw(
                AssertionError("storage must not be used"),
            ),
        )
        self.assertEqual(second.result, "already_completed")
        self.assertEqual(second.notification_result, "already_sent")
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
            result = await self._execute_worker(
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

    async def test_restore_register_is_durable_before_avatar_deletion(self) -> None:
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
        events: list[str] = []

        class OrderedRegister(_FakeRegisterStorage):
            async def put_object_if_absent(self, key: str, body: bytes) -> bool:
                events.append("register")
                return await super().put_object_if_absent(key, body)

        class OrderedAvatar(_FakeAvatarStorage):
            async def delete_avatar(self, *, object_key: str) -> None:
                events.append("avatar")
                await super().delete_avatar(object_key=object_key)

        register = OrderedRegister()
        result = await self._execute_worker(
            request_id,
            register_storage_factory=lambda: register,
            storage_factory=OrderedAvatar,
        )
        self.assertEqual(result.result, "completed")
        self.evidence_ids.add(result.destruction_evidence_id)
        self.assertEqual(events[-1], "avatar")
        self.assertTrue(events.index("register") < events.index("avatar"))
        self.assertEqual(len(register.objects), 2)

    async def test_restore_register_failure_and_key_mismatch_preserve_everything(self) -> None:
        for storage in (
            _FakeRegisterStorage(fail_writes=True),
            _FakeRegisterStorage(),
        ):
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
            if not storage.fail_writes:
                other_settings = self.notification_settings.model_copy(
                    update={"api_token_hash_secret": "different-synthetic-hash-key"},
                )
                other_hash = privacy_erasure_subject_ref_hash(user_id, other_settings)
                await ensure_restore_register_marker(
                    storage,
                    settings=other_settings,
                    subject_ref_hash=other_hash,
                )
            avatar_storage = _FakeAvatarStorage()
            result = await self._execute_worker(
                request_id,
                register_storage_factory=lambda storage=storage: storage,
                storage_factory=lambda: avatar_storage,
            )
            self.assertEqual(result.result, "retryable_failure")
            self.assertEqual(result.failure_code, RESTORE_REGISTER_FAILURE_CODE)
            self.assertEqual(avatar_storage.deleted, [])
            async with AsyncSessionLocal() as session:
                request = await session.get(PrivacyRequest, request_id)
                self.assertIsNotNone(await session.get(AppUser, user_id))
                self.assertIsNotNone(await session.get(ProfileAvatar, avatar_id))
                self.assertIsNone(request.completed_at)
                self.assertEqual(request.failure_code, RESTORE_REGISTER_FAILURE_CODE)

    async def test_identical_marker_is_accepted_and_incompatible_marker_fails_closed(self) -> None:
        accepted_user, accepted_request, _, _ = await self._add_subject()
        subject_hash = privacy_erasure_subject_ref_hash(
            accepted_user,
            self.notification_settings,
        )
        await ensure_restore_register_marker(
            self.register_storage,
            settings=self.notification_settings,
            subject_ref_hash=subject_hash,
        )
        before_keys = set(self.register_storage.objects)
        accepted = await self._execute_worker(accepted_request)
        self.assertEqual(accepted.result, "completed")
        self.evidence_ids.add(accepted.destruction_evidence_id)
        self.assertEqual(set(self.register_storage.objects), before_keys)

        failed_user, failed_request, _, _ = await self._add_subject()
        failed_hash = privacy_erasure_subject_ref_hash(
            failed_user,
            self.notification_settings,
        )
        await ensure_restore_register_marker(
            self.register_storage,
            settings=self.notification_settings,
            subject_ref_hash=failed_hash,
        )
        marker_key = next(
            key
            for key, value in self.register_storage.objects.items()
            if failed_hash.encode("ascii") in value
        )
        self.register_storage.objects[marker_key] = (
            b'{"format_version":"privacy-erasure-register-marker-v1",'
            b'"subject_ref_hash":"hmac-sha256-v1:' + b"0" * 64 + b'"}\n'
        )
        failed = await self._execute_worker(failed_request)
        self.assertEqual(failed.result, "retryable_failure")
        self.assertEqual(failed.failure_code, RESTORE_REGISTER_FAILURE_CODE)
        async with AsyncSessionLocal() as session:
            self.assertIsNotNone(await session.get(AppUser, failed_user))

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

        failed = await self._execute_worker(
            request_id,
            storage_factory=lambda: storage,
            after_storage=fail_after_storage,
        )
        self.assertEqual(failed.result, "retryable_failure")
        self.assertEqual(failed.failure_code, DATABASE_FAILURE_CODE)
        async with AsyncSessionLocal() as session:
            self.assertIsNotNone(await session.get(AppUser, user_id))
            self.assertIsNotNone(await session.get(ProfileAvatar, avatar_id))

        completed = await self._execute_worker(
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

    async def test_attempted_financial_states_do_not_retain_live_graph(self) -> None:
        await self._set_event_internal_paid()
        for payment_status in ("pending", "failed", "cancelled"):
            with self.subTest(payment_status=payment_status):
                user_id, request_id, _, _ = await self._add_subject()
                registration_id = await self._add_financial_registration(
                    user_id,
                    payment_status=payment_status,
                )
                result = await self._execute_worker(request_id)
                self.assertEqual(result.result, "completed")
                self.evidence_ids.add(result.destruction_evidence_id)
                async with AsyncSessionLocal() as session:
                    evidence = await session.get(
                        PrivacyDestructionEvidence,
                        result.destruction_evidence_id,
                    )
                    retained_count = await session.scalar(
                        select(func.count())
                        .select_from(PrivacyRetainedFinancialEvidence)
                        .where(
                            PrivacyRetainedFinancialEvidence.source_registration_id
                            == registration_id,
                        ),
                    )
                    self.assertIsNone(await session.get(AppUser, user_id))
                    self.assertIsNone(
                        await session.get(EventRegistration, registration_id),
                    )
                self.assertEqual(retained_count, 0)
                self.assertEqual(evidence.result_status, "completed")
                self.assertEqual(evidence.categories_retained, [])
                self.assertIsNone(evidence.retention_until)

    async def test_finalized_financial_states_retain_only_minimal_evidence(self) -> None:
        retained_columns = {
            column.name
            for column in PrivacyRetainedFinancialEvidence.__table__.columns
        }
        self.assertEqual(
            retained_columns,
            {
                "id",
                "subject_ref_hash",
                "source_registration_id",
                "source_event_id",
                "financial_state",
                "amount",
                "currency",
                "retention_basis_code",
                "retention_until",
                "created_at",
            },
        )
        for payment_status in ("succeeded", "paid", "refunded"):
            with self.subTest(payment_status=payment_status):
                user_id, request_id, email, phone = await self._add_subject()
                if payment_status == "paid":
                    ids = await self._add_complete_graph(
                        user_id,
                        request_id,
                        email,
                        phone,
                    )
                    registration_id = ids["registration"]
                    async with AsyncSessionLocal() as session:
                        async with session.begin():
                            registration = await session.get(
                                EventRegistration,
                                registration_id,
                            )
                            registration.payment_status = payment_status
                            selection = await session.get(
                                EventRegistrationOptionSelection,
                                ids["selection"],
                            )
                            selection.unit_price_amount = 12500
                            selection.total_amount = 12500
                            selection.currency = "RUB"
                else:
                    ids = None
                    registration_id = await self._add_financial_registration(
                        user_id,
                        payment_status=payment_status,
                    )

                first = await self._execute_worker(request_id)
                self.assertEqual(first.result, "completed")
                self.evidence_ids.add(first.destruction_evidence_id)
                async with AsyncSessionLocal() as session:
                    evidence = await session.get(
                        PrivacyDestructionEvidence,
                        first.destruction_evidence_id,
                    )
                    retained = await session.scalar(
                        select(PrivacyRetainedFinancialEvidence).where(
                            PrivacyRetainedFinancialEvidence.source_registration_id
                            == registration_id,
                        ),
                    )
                    retained_count = await session.scalar(
                        select(func.count())
                        .select_from(PrivacyRetainedFinancialEvidence)
                        .where(
                            PrivacyRetainedFinancialEvidence.source_registration_id
                            == registration_id,
                        ),
                    )
                    evidence_count = await session.scalar(
                        select(func.count())
                        .select_from(PrivacyDestructionEvidence)
                        .where(PrivacyDestructionEvidence.id == evidence.id),
                    )
                    outbox = await session.scalar(
                        select(PrivacyErasureNotificationOutbox).where(
                            PrivacyErasureNotificationOutbox.privacy_request_id
                            == request_id,
                        ),
                    )
                    self.assertIsNone(await session.get(AppUser, user_id))
                    self.assertIsNone(
                        await session.get(EventRegistration, registration_id),
                    )
                    if ids is not None:
                        self.assertIsNone(await session.get(Profile, ids["profile"]))
                        self.assertIsNone(
                            await session.get(EventRegistrationAnswer, ids["answer"]),
                        )
                        self.assertIsNone(
                            await session.get(ProfileAvatar, ids["avatar"]),
                        )
                    prayer_count = await session.scalar(
                        select(func.count())
                        .select_from(PrayerActivityLog)
                        .where(PrayerActivityLog.user_id == user_id),
                    )
                self.assertEqual(evidence.result_status, "completed_with_retention")
                self.assertEqual(evidence.categories_retained, ["financial_evidence"])
                self.assertEqual(outbox.notification_kind, "completed_with_retention")
                expected_until = evidence.completed_at + timedelta(days=365)
                self.assertEqual(evidence.retention_until, expected_until)
                self.assertEqual(retained.financial_state, payment_status)
                self.assertEqual(retained.amount, 12500)
                self.assertEqual(retained.currency, "RUB")
                self.assertEqual(
                    retained.retention_basis_code,
                    "finalized_event_registration_financial",
                )
                self.assertEqual(retained.retention_until, expected_until)
                self.assertNotIn(str(user_id), retained.subject_ref_hash)
                self.assertEqual(retained_count, 1)
                self.assertEqual(evidence_count, 1)
                self.assertEqual(prayer_count, 0)

                second = await self._execute_worker(request_id)
                self.assertEqual(second.result, "already_completed")
                self.assertEqual(
                    second.destruction_evidence_id,
                    first.destruction_evidence_id,
                )
                async with AsyncSessionLocal() as session:
                    retry_retained_count = await session.scalar(
                        select(func.count())
                        .select_from(PrivacyRetainedFinancialEvidence)
                        .where(
                            PrivacyRetainedFinancialEvidence.source_registration_id
                            == registration_id,
                        ),
                    )
                self.assertEqual(retry_retained_count, 1)

    async def test_finalized_financial_state_requires_configured_duration(self) -> None:
        user_id, request_id, _, _ = await self._add_subject()
        registration_id = await self._add_financial_registration(
            user_id,
            payment_status="paid",
        )
        settings_without_duration = self.notification_settings.model_copy(
            update={"api_privacy_erasure_financial_retention_days": None},
        )
        result = await self._execute_worker(
            request_id,
            settings=settings_without_duration,
            storage_factory=lambda: (_ for _ in ()).throw(
                AssertionError("storage must not be used"),
            ),
        )
        self.assertEqual(result.result, "retryable_failure")
        self.assertEqual(
            result.failure_code,
            RETENTION_CONFIGURATION_FAILURE_CODE,
        )
        async with AsyncSessionLocal() as session:
            request = await session.get(PrivacyRequest, request_id)
            retained_count = await session.scalar(
                select(func.count())
                .select_from(PrivacyRetainedFinancialEvidence)
                .where(
                    PrivacyRetainedFinancialEvidence.source_registration_id
                    == registration_id,
                ),
            )
            user = await session.get(AppUser, user_id)
            self.assertIsNotNone(user)
        self.assertEqual(request.failure_code, RETENTION_CONFIGURATION_FAILURE_CODE)
        self.assertIsNone(request.execution_started_at)
        self.assertEqual(user.status, "deletion_pending")
        self.assertEqual(retained_count, 0)

    async def _set_event_internal_paid(self) -> None:
        async with AsyncSessionLocal() as session:
            async with session.begin():
                await session.execute(
                    update(Event)
                    .where(Event.id == self.event_id)
                    .values(registration_mode="internal_paid", price_amount=12500),
                )

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
        manual = await self._execute_worker(
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
            result = await self._execute_worker(
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
        result = await self._execute_worker(request_id)
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
            self._execute_worker(request_id),
            self._execute_worker(request_id),
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
            ("completed", None, "sent", None, 0),
            ("already_completed", None, "already_sent", None, 0),
            (
                "already_completed",
                None,
                "legacy_notification_unavailable",
                None,
                0,
            ),
            ("retryable_failure", DATABASE_FAILURE_CODE, "not_created", None, 1),
            ("not_eligible", MANUAL_REVIEW_FAILURE_CODE, "not_created", None, 2),
            (
                "completed",
                None,
                "retryable_failure",
                "privacy_erasure_notification_delivery_unavailable",
                1,
            ),
            (
                "already_completed",
                None,
                "expired",
                "privacy_erasure_notification_delivery_window_expired",
                2,
            ),
        ]
        for (
            result_name,
            failure_code,
            notification_result,
            notification_failure_code,
            expected_exit,
        ) in cases:
            result = PrivacyErasureWorkerResult(
                request_id=request_id,
                result=result_name,
                destruction_evidence_id=evidence_id
                if result_name in {"completed", "already_completed"}
                else None,
                failure_code=failure_code,
                notification_result=notification_result,
                notification_failure_code=notification_failure_code,
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
            self.assertEqual(payload["notification_result"], notification_result)
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
