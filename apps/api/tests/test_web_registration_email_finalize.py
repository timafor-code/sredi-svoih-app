from __future__ import annotations

import unittest
from datetime import UTC, datetime, timedelta
from unittest.mock import patch
from uuid import uuid4

import httpx
from alembic.config import Config
from alembic.script import ScriptDirectory
from fastapi import HTTPException
from sqlalchemy import delete, func, select, text, update
from sqlalchemy.exc import IntegrityError

from app.core.config import Settings
from app.db.models.auth import AuthSetPasswordCode, WebRegistrationVerificationCode
from app.db.models.core import (
    AppUser,
    Community,
    CommunityMembership,
    Event,
    EventCategory,
    EventRegistration,
    EventRegistrationCapacityReservation,
    LegalAcceptance,
    LegalDocument,
    Profile,
    WebRegistrationIdentityConflict,
    WebRegistrationIntent,
)
from app.db.session import AsyncSessionLocal, engine
from app.main import app
from app.schemas.web_registration import WebRegistrationIntentRequest
from app.services import auth as auth_service
from app.services import web_registration as service
from app.services.auth_tokens import verify_token_hash
from app.services.email_delivery import EmailSendResult
from app.services.web_registration_email_service import (
    WebRegistrationEmailDeliveryError,
    send_web_registration_verification_code,
)
from app.services.web_registration_email_templates import (
    render_registration_result_email,
    render_verification_code_email,
)


class WebRegistrationEmailFinalizeTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        service._rate_limiter = None
        self.community_id = uuid4()
        self.event_id = uuid4()
        self.document_id = uuid4()
        self.marker = uuid4().hex[:12]
        self.email = f"web-finalize-{self.marker}@example.invalid"
        self.phone = f"+7900{int(self.marker[:8], 16) % 10**7:07d}"
        self.now = datetime.now(UTC).replace(microsecond=0)
        self.verification_deliveries: list[tuple[str, str]] = []
        self.result_deliveries: list[tuple[str, str]] = []

        def capture_verification(**kwargs):
            self.verification_deliveries.append((kwargs["to_address"], kwargs["code"]))
            return EmailSendResult(sent=True, disabled=False)

        def capture_result(**kwargs):
            self.result_deliveries.append(
                (kwargs["to_address"], kwargs["registration_status"]),
            )
            return EmailSendResult(sent=True, disabled=False)

        self.verification_patcher = patch(
            "app.services.web_registration.send_web_registration_verification_code",
            side_effect=capture_verification,
        )
        self.result_patcher = patch(
            "app.services.web_registration.send_web_registration_result",
            side_effect=capture_result,
        )
        self.verification_patcher.start()
        self.result_patcher.start()

        async with AsyncSessionLocal() as session:
            async with session.begin():
                session.add(
                    Community(
                        id=self.community_id,
                        name="Web finalize tests",
                        city="Moscow",
                        slug=f"web-finalize-{self.marker}",
                    ),
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
                session.add(
                    Event(
                        id=self.event_id,
                        community_id=self.community_id,
                        title="Synthetic web finalize event",
                        starts_at=self.now + timedelta(days=2),
                        category="community",
                        registration_mode="internal_free",
                        status="published",
                        visibility="public",
                        capacity=2,
                    ),
                )
                session.add(
                    LegalDocument(
                        id=self.document_id,
                        document_type="event_registration_consent",
                        version=f"web-finalize-{self.marker}",
                        title="Synthetic consent",
                        content_hash=f"sha256:{self.marker}",
                        published_url="https://example.invalid/consent",
                        effective_at=self.now - timedelta(days=1),
                    ),
                )

    async def asyncTearDown(self) -> None:
        self.result_patcher.stop()
        self.verification_patcher.stop()
        async with AsyncSessionLocal() as session:
            async with session.begin():
                await session.execute(
                    delete(AppUser).where(
                        AppUser.email.like("web-finalize-%@example.invalid"),
                    ),
                )
                await session.execute(
                    delete(LegalDocument).where(
                        LegalDocument.version.like("web-finalize-%"),
                    ),
                )
                await session.execute(
                    delete(Community).where(Community.id == self.community_id),
                )
        await engine.dispose()

    def payload(self, **updates) -> WebRegistrationIntentRequest:
        data = {
            "event_id": self.event_id,
            "occurrence_id": None,
            "first_name": "Иван",
            "last_name": "Тестов",
            "phone": self.phone,
            "email": self.email,
            "seats_count": 1,
            "option_selections": [],
            "answers": [],
            "legal_acceptances": [
                {
                    "document_id": self.document_id,
                    "content_hash": f"sha256:{self.marker}",
                },
            ],
            "account_choice": "without_password",
            "idempotency_key": f"web-finalize-{uuid4().hex}",
        }
        data.update(updates)
        return WebRegistrationIntentRequest.model_validate(data)

    async def create(self, payload: WebRegistrationIntentRequest | None = None):
        resolved = payload or self.payload()
        async with AsyncSessionLocal() as session:
            created = await service.create_intent(session, resolved, "192.0.2.1")
        return created, self.verification_deliveries[-1][1]

    async def backdate_latest_code(self, intent_id, *, seconds: int = 120) -> None:
        async with AsyncSessionLocal() as session:
            async with session.begin():
                latest = await session.scalar(
                    select(WebRegistrationVerificationCode)
                    .where(
                        WebRegistrationVerificationCode.registration_intent_id
                        == intent_id,
                    )
                    .order_by(WebRegistrationVerificationCode.created_at.desc()),
                )
                latest.created_at = self.now - timedelta(seconds=seconds)

    async def test_schema_is_hash_only_constrained_and_cascades(self) -> None:
        created, plaintext = await self.create()
        async with AsyncSessionLocal() as session:
            intent = await session.scalar(
                select(WebRegistrationIntent).where(
                    WebRegistrationIntent.flow_token_hash
                    == service._flow_hash(created.flow_id),
                ),
            )
            code_row = await session.scalar(
                select(WebRegistrationVerificationCode).where(
                    WebRegistrationVerificationCode.registration_intent_id
                    == intent.id,
                ),
            )
            intent_id = intent.id
            self.assertNotEqual(code_row.code_hash, plaintext)
            self.assertTrue(verify_token_hash(plaintext, code_row.code_hash))
            self.assertEqual(code_row.attempt_count, 0)
            columns = set(
                await session.scalars(
                    text(
                        "SELECT column_name FROM information_schema.columns "
                        "WHERE table_name='web_registration_verification_codes'",
                    ),
                ),
            )
            self.assertEqual(
                columns,
                {
                    "id",
                    "registration_intent_id",
                    "code_hash",
                    "expires_at",
                    "consumed_at",
                    "attempt_count",
                    "created_at",
                },
            )
            code_row.attempt_count = -1
            with self.assertRaises(IntegrityError):
                await session.commit()
            await session.rollback()

        invalid_rows = (
            {
                "code_hash": "",
                "created_at": self.now,
                "expires_at": self.now + timedelta(minutes=1),
                "consumed_at": None,
            },
            {
                "code_hash": f"invalid-expiry-{uuid4().hex}",
                "created_at": self.now,
                "expires_at": self.now,
                "consumed_at": None,
            },
            {
                "code_hash": f"invalid-consumed-{uuid4().hex}",
                "created_at": self.now,
                "expires_at": self.now + timedelta(minutes=1),
                "consumed_at": self.now - timedelta(seconds=1),
            },
        )
        for values in invalid_rows:
            async with AsyncSessionLocal() as session:
                session.add(
                    WebRegistrationVerificationCode(
                        registration_intent_id=intent_id,
                        attempt_count=0,
                        **values,
                    ),
                )
                with self.assertRaises(IntegrityError):
                    await session.commit()
                await session.rollback()

        async with AsyncSessionLocal() as session:
            await session.execute(
                delete(WebRegistrationIntent).where(WebRegistrationIntent.id == intent_id),
            )
            await session.commit()
            self.assertEqual(
                await session.scalar(
                    select(func.count())
                    .select_from(WebRegistrationVerificationCode)
                    .where(
                        WebRegistrationVerificationCode.registration_intent_id
                        == intent_id,
                    ),
                ),
                0,
            )

    async def test_initial_delivery_idempotency_failure_and_recovery(self) -> None:
        payload = self.payload(idempotency_key="web-finalize-stable-delivery")
        created, first_code = await self.create(payload)
        async with AsyncSessionLocal() as session:
            again = await service.create_intent(session, payload, "192.0.2.1")
        self.assertEqual(created.flow_id, again.flow_id)
        self.assertEqual(len(self.verification_deliveries), 1)
        self.assertNotIn(first_code, repr(payload.model_dump()))

        recovery_payload = self.payload(
            email=f"web-finalize-recovery-{self.marker}@example.invalid",
            phone=f"+7901{int(self.marker[:8], 16) % 10**7:07d}",
            idempotency_key="web-finalize-delivery-recovery",
        )
        with patch(
            "app.services.web_registration.send_web_registration_verification_code",
            side_effect=WebRegistrationEmailDeliveryError("synthetic"),
        ):
            async with AsyncSessionLocal() as session:
                with self.assertRaises(HTTPException) as raised:
                    await service.create_intent(
                        session,
                        recovery_payload,
                        "192.0.2.2",
                    )
        self.assertEqual(raised.exception.status_code, 503)
        self.assertEqual(raised.exception.detail["code"], "email_delivery_unavailable")
        async with AsyncSessionLocal() as session:
            intent = await session.scalar(
                select(WebRegistrationIntent).where(
                    WebRegistrationIntent.idempotency_key_hash
                    == service._idempotency_hash("web-finalize-delivery-recovery"),
                ),
            )
            self.assertIsNotNone(intent)
            self.assertEqual(
                await session.scalar(
                    select(func.count())
                    .select_from(WebRegistrationVerificationCode)
                    .where(
                        WebRegistrationVerificationCode.registration_intent_id
                        == intent.id,
                    ),
                ),
                0,
            )
            recovered = await service.create_intent(
                session,
                recovery_payload,
                "192.0.2.2",
            )
        self.assertEqual(recovered.flow_id, service._flow_id(service._idempotency_hash("web-finalize-delivery-recovery")))

    def test_disabled_email_is_not_success(self) -> None:
        with self.assertRaises(WebRegistrationEmailDeliveryError):
            send_web_registration_verification_code(
                to_address="disabled@example.invalid",
                code="123456",
                expiration_minutes=15,
                settings=Settings(api_email_enabled=False),
            )

    async def test_resend_is_atomic_and_old_code_stops_working(self) -> None:
        created, old_code = await self.create()
        async with AsyncSessionLocal() as session:
            intent = await session.scalar(
                select(WebRegistrationIntent).where(
                    WebRegistrationIntent.flow_token_hash
                    == service._flow_hash(created.flow_id),
                ),
            )
        await self.backdate_latest_code(intent.id)
        with patch(
            "app.services.web_registration.send_web_registration_verification_code",
            side_effect=WebRegistrationEmailDeliveryError("synthetic"),
        ):
            async with AsyncSessionLocal() as session:
                with self.assertRaises(HTTPException) as raised:
                    await service.resend_code(session, created.flow_id, "192.0.2.3")
        self.assertEqual(raised.exception.status_code, 503)
        async with AsyncSessionLocal() as session:
            old_row = await session.scalar(
                select(WebRegistrationVerificationCode).where(
                    WebRegistrationVerificationCode.registration_intent_id == intent.id,
                ),
            )
            self.assertIsNone(old_row.consumed_at)
            resent = await service.resend_code(session, created.flow_id, "192.0.2.3")
        new_code = self.verification_deliveries[-1][1]
        self.assertNotEqual(old_code, new_code)
        self.assertGreater(resent.expires_at, self.now)
        async with AsyncSessionLocal() as session:
            with self.assertRaises(HTTPException) as invalid:
                await service.confirm_email(
                    session,
                    created.flow_id,
                    old_code,
                    "192.0.2.3",
                )
        self.assertEqual(invalid.exception.detail, service.INVALID_CODE_DETAIL)
        async with AsyncSessionLocal() as session:
            result = await service.confirm_email(
                session,
                created.flow_id,
                new_code,
                "192.0.2.3",
            )
        self.assertEqual(result.intent_status, "confirmed")

    async def test_invalid_attempts_persist_and_consume_at_limit(self) -> None:
        created, _ = await self.create()
        for _ in range(Settings().api_web_registration_code_max_attempts):
            async with AsyncSessionLocal() as session:
                with self.assertRaises(HTTPException) as raised:
                    await service.confirm_email(
                        session,
                        created.flow_id,
                        "999999",
                        "192.0.2.4",
                    )
            self.assertEqual(raised.exception.detail, service.INVALID_CODE_DETAIL)
        async with AsyncSessionLocal() as session:
            code_row = await session.scalar(
                select(WebRegistrationVerificationCode)
                .order_by(WebRegistrationVerificationCode.created_at.desc()),
            )
            self.assertEqual(
                code_row.attempt_count,
                Settings().api_web_registration_code_max_attempts,
            )
            self.assertIsNotNone(code_row.consumed_at)

    async def test_confirmation_creates_user_profile_registration_and_legal_evidence(self) -> None:
        created, code = await self.create()
        async with AsyncSessionLocal() as session:
            before_memberships = await session.scalar(
                select(func.count()).select_from(CommunityMembership),
            )
            result = await service.confirm_email(
                session,
                created.flow_id,
                code,
                "192.0.2.5",
            )
        self.assertEqual(result.account_next_step, "none")
        self.assertEqual(result.registration.status, "confirmed")
        self.assertEqual(len(self.result_deliveries), 1)
        async with AsyncSessionLocal() as session:
            user = await session.scalar(
                select(AppUser).where(func.lower(AppUser.email) == self.email),
            )
            profile = await session.scalar(select(Profile).where(Profile.user_id == user.id))
            registration = await session.get(EventRegistration, result.registration.id)
            acceptance = await session.scalar(
                select(LegalAcceptance).where(
                    LegalAcceptance.registration_id == registration.id,
                ),
            )
            code_rows = list(
                await session.scalars(
                    select(WebRegistrationVerificationCode).where(
                        WebRegistrationVerificationCode.registration_intent_id
                        == (select(WebRegistrationIntent.id).where(
                            WebRegistrationIntent.flow_token_hash
                            == service._flow_hash(created.flow_id),
                        ).scalar_subquery()),
                    ),
                ),
            )
            self.assertEqual((user.account_origin, user.claim_state), ("web_guest", "unclaimed"))
            self.assertIsNone(user.password_hash)
            self.assertIsNotNone(user.email_verified_at)
            self.assertIsNone(user.phone_verified_at)
            self.assertEqual((profile.first_name, profile.last_name), ("Иван", "Тестов"))
            self.assertEqual(registration.source_channel, "public_web")
            self.assertEqual(
                (acceptance.acceptance_method, acceptance.source_channel, acceptance.evidence_version),
                (
                    "checkbox_plus_email_verification",
                    "public_web",
                    "web-registration-email-code-v1",
                ),
            )
            self.assertTrue(all(item.consumed_at is not None for item in code_rows))
            self.assertEqual(
                await session.scalar(select(func.count()).select_from(CommunityMembership)),
                before_memberships,
            )

    async def test_capacity_recheck_rolls_back_and_allows_retry(self) -> None:
        created, code = await self.create(self.payload(seats_count=2))
        blocker = AppUser(
            email=f"web-finalize-blocker-{self.marker}@example.invalid",
            phone=f"+7902{int(self.marker[:8], 16) % 10**7:07d}",
            password_hash="unchanged",
            account_origin="password_signup",
            claim_state="claimed",
            status="active",
        )
        async with AsyncSessionLocal() as session:
            async with session.begin():
                session.add(blocker)
                await session.flush()
                session.add(
                    EventRegistration(
                        event_id=self.event_id,
                        user_id=blocker.id,
                        status="confirmed",
                        source_channel="mobile",
                        seats_count=1,
                        guest_names=[],
                        registered_at=self.now,
                        confirmed_at=self.now,
                        payment_status="not_required",
                    ),
                )
        async with AsyncSessionLocal() as session:
            with self.assertRaises(HTTPException) as raised:
                await service.confirm_email(
                    session,
                    created.flow_id,
                    code,
                    "192.0.2.6",
                )
        self.assertEqual(raised.exception.detail["code"], "capacity_unavailable")
        async with AsyncSessionLocal() as session:
            intent = await session.scalar(
                select(WebRegistrationIntent).where(
                    WebRegistrationIntent.flow_token_hash
                    == service._flow_hash(created.flow_id),
                ),
            )
            code_row = await session.scalar(
                select(WebRegistrationVerificationCode).where(
                    WebRegistrationVerificationCode.registration_intent_id == intent.id,
                ),
            )
            self.assertEqual(intent.status, "email_verification_required")
            self.assertIsNone(code_row.consumed_at)
            await session.execute(
                delete(EventRegistration).where(EventRegistration.user_id == blocker.id),
            )
            await session.commit()
            result = await service.confirm_email(
                session,
                created.flow_id,
                code,
                "192.0.2.6",
            )
        self.assertEqual(result.registration.seats_count, 2)

    async def test_identity_is_re_resolved_and_claimed_profile_is_not_overwritten(self) -> None:
        claimed = AppUser(
            email=self.email,
            phone=None,
            password_hash="unchanged",
            account_origin="password_signup",
            claim_state="claimed",
            claimed_at=self.now,
            status="active",
        )
        async with AsyncSessionLocal() as session:
            async with session.begin():
                session.add(claimed)
                await session.flush()
                session.add(
                    Profile(
                        user_id=claimed.id,
                        first_name="Сохранённое",
                        last_name="Имя",
                        full_name="Сохранённое Имя",
                        display_name="Сохранённое Имя",
                        email=self.email,
                    ),
                )
                existing_registration = EventRegistration(
                    event_id=self.event_id,
                    user_id=claimed.id,
                    status="confirmed",
                    source_channel="mobile",
                    seats_count=1,
                    guest_names=[],
                    registered_at=self.now,
                    confirmed_at=self.now,
                    payment_status="not_required",
                )
                session.add(existing_registration)
        created, code = await self.create()
        async with AsyncSessionLocal() as session:
            result = await service.confirm_email(
                session,
                created.flow_id,
                code,
                "192.0.2.7",
            )
            refreshed = await session.get(AppUser, claimed.id)
            profile = await session.scalar(select(Profile).where(Profile.user_id == claimed.id))
        self.assertEqual(result.account_next_step, "sign_in")
        self.assertEqual(result.registration.id, existing_registration.id)
        self.assertIsNone(refreshed.phone)
        self.assertEqual(profile.first_name, "Сохранённое")
        async with AsyncSessionLocal() as session:
            self.assertEqual(
                await session.scalar(
                    select(func.count()).select_from(EventRegistration).where(
                        EventRegistration.event_id == self.event_id,
                        EventRegistration.user_id == claimed.id,
                    ),
                ),
                1,
            )

    async def test_identity_race_phone_only_fails_without_duplicate(self) -> None:
        created, code = await self.create()
        phone_owner = AppUser(
            email=f"web-finalize-phone-owner-{self.marker}@example.invalid",
            phone=self.phone,
            password_hash="unchanged",
            account_origin="password_signup",
            claim_state="claimed",
            status="active",
        )
        async with AsyncSessionLocal() as session:
            async with session.begin():
                session.add(phone_owner)
        async with AsyncSessionLocal() as session:
            with self.assertRaises(HTTPException) as raised:
                await service.confirm_email(
                    session,
                    created.flow_id,
                    code,
                    "192.0.2.8",
                )
        self.assertEqual(raised.exception.detail, service.IDENTITY_UNAVAILABLE_DETAIL)
        async with AsyncSessionLocal() as session:
            self.assertIsNone(
                await session.scalar(select(AppUser).where(AppUser.email == self.email)),
            )
            self.assertEqual(
                await session.scalar(
                    select(func.count()).select_from(EventRegistration).where(
                        EventRegistration.event_id == self.event_id,
                    ),
                ),
                0,
            )

    async def test_unclaimed_email_owner_receives_free_phone_and_profile_update(self) -> None:
        user = AppUser(
            email=self.email,
            phone=None,
            password_hash=None,
            account_origin="web_guest",
            claim_state="unclaimed",
            status="active",
        )
        async with AsyncSessionLocal() as session:
            async with session.begin():
                session.add(user)
                await session.flush()
                session.add(
                    Profile(
                        user_id=user.id,
                        first_name="Старое",
                        last_name="Имя",
                        full_name="Старое Имя",
                        display_name="Старое Имя",
                        email=self.email,
                    ),
                )
        created, code = await self.create()
        async with AsyncSessionLocal() as session:
            await service.confirm_email(
                session,
                created.flow_id,
                code,
                "192.0.2.81",
            )
            refreshed = await session.get(AppUser, user.id)
            profile = await session.scalar(select(Profile).where(Profile.user_id == user.id))
        self.assertEqual(refreshed.phone, self.phone)
        self.assertEqual((profile.first_name, profile.last_name), ("Иван", "Тестов"))

    async def test_different_user_and_deletion_races_stay_generic(self) -> None:
        different_payload = self.payload(
            email=f"web-finalize-different-email-{self.marker}@example.invalid",
            phone=f"+7903{int(self.marker[:8], 16) % 10**7:07d}",
            idempotency_key="web-finalize-different-race",
        )
        different_created, different_code = await self.create(different_payload)
        email_owner = AppUser(
            email=different_payload.email,
            phone=f"+7904{int(self.marker[:8], 16) % 10**7:07d}",
            password_hash="unchanged",
            account_origin="password_signup",
            claim_state="claimed",
            status="active",
        )
        phone_owner = AppUser(
            email=f"web-finalize-different-phone-{self.marker}@example.invalid",
            phone=different_payload.phone,
            password_hash="unchanged",
            account_origin="password_signup",
            claim_state="claimed",
            status="active",
        )
        async with AsyncSessionLocal() as session:
            async with session.begin():
                session.add_all((email_owner, phone_owner))
        async with AsyncSessionLocal() as session:
            with self.assertRaises(HTTPException) as different_error:
                await service.confirm_email(
                    session,
                    different_created.flow_id,
                    different_code,
                    "192.0.2.82",
                )
            conflict = await session.scalar(
                select(WebRegistrationIdentityConflict).where(
                    WebRegistrationIdentityConflict.email_user_id == email_owner.id,
                    WebRegistrationIdentityConflict.phone_user_id == phone_owner.id,
                ),
            )
        self.assertEqual(different_error.exception.detail, service.IDENTITY_UNAVAILABLE_DETAIL)
        self.assertIsNotNone(conflict)

        deletion_payload = self.payload(
            email=f"web-finalize-deleting-{self.marker}@example.invalid",
            phone=f"+7905{int(self.marker[:8], 16) % 10**7:07d}",
            idempotency_key="web-finalize-deletion-race",
        )
        deletion_created, deletion_code = await self.create(deletion_payload)
        deleting = AppUser(
            email=deletion_payload.email,
            phone=f"+7906{int(self.marker[:8], 16) % 10**7:07d}",
            password_hash=None,
            account_origin="web_guest",
            claim_state="unclaimed",
            status="deletion_pending",
            deletion_requested_at=self.now,
        )
        async with AsyncSessionLocal() as session:
            async with session.begin():
                session.add(deleting)
        async with AsyncSessionLocal() as session:
            with self.assertRaises(HTTPException) as deletion_error:
                await service.confirm_email(
                    session,
                    deletion_created.flow_id,
                    deletion_code,
                    "192.0.2.83",
                )
            self.assertIsNone(
                await session.scalar(
                    select(WebRegistrationIntent).where(
                        WebRegistrationIntent.flow_token_hash
                        == service._flow_hash(deletion_created.flow_id),
                    ),
                ),
            )
        self.assertEqual(deletion_error.exception.detail, service.IDENTITY_UNAVAILABLE_DETAIL)

    async def test_create_account_handoff_is_hash_only_single_use_and_replay_safe(self) -> None:
        created, code = await self.create(
            self.payload(account_choice="create_account"),
        )
        async with AsyncSessionLocal() as session:
            result = await service.confirm_email(
                session,
                created.flow_id,
                code,
                "192.0.2.9",
            )
        self.assertEqual(result.account_next_step, "set_password")
        self.assertIsNotNone(result.set_password_code)
        async with AsyncSessionLocal() as session:
            user = await session.scalar(select(AppUser).where(AppUser.email == self.email))
            handoff = await session.scalar(
                select(AuthSetPasswordCode).where(AuthSetPasswordCode.user_id == user.id),
            )
            self.assertNotEqual(handoff.code_hash, result.set_password_code)
            self.assertTrue(verify_token_hash(result.set_password_code, handoff.code_hash))
            replay = await service.confirm_email(
                session,
                created.flow_id,
                code,
                "192.0.2.9",
            )
            self.assertEqual(replay.account_next_step, "request_set_password")
            self.assertIsNone(replay.set_password_code)
            await auth_service.confirm_set_password(
                session,
                code=result.set_password_code,
                new_password="synthetic-password-123",
            )
            await session.refresh(user)
            self.assertEqual(user.claim_state, "claimed")
            self.assertIsNotNone(user.claimed_at)
            after_claim = await service.confirm_email(
                session,
                created.flow_id,
                code,
                "192.0.2.9",
            )
        self.assertEqual(after_claim.account_next_step, "sign_in")
        self.assertEqual(after_claim.registration.id, result.registration.id)

    async def test_templates_router_status_and_redacted_secondary_failure_log(self) -> None:
        rendered = render_verification_code_email(
            code="123456",
            expiration_minutes=15,
        )
        self.assertIn("123456", rendered.text_body)
        self.assertIn("15", rendered.text_body)
        self.assertIn("Никому", rendered.text_body)
        self.assertNotIn("http", rendered.text_body)
        result_rendered = render_registration_result_email(
            registration_status="confirmed",
        )
        self.assertIn("не маркетинговая", result_rendered.text_body)

        payload = self.payload(idempotency_key="web-finalize-router-flow")
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app),
            base_url="http://testserver",
        ) as client:
            create_response = await client.post(
                "/web/registration-intents",
                json=payload.model_dump(mode="json"),
            )
            self.assertEqual(create_response.status_code, 201)
            flow_id = create_response.json()["data"]["flow_id"]
            code = self.verification_deliveries[-1][1]
            with patch(
                "app.services.web_registration.send_web_registration_result",
                side_effect=WebRegistrationEmailDeliveryError("synthetic"),
            ), self.assertLogs("app.services.web_registration", level="WARNING") as logs:
                confirm_response = await client.post(
                    f"/web/registration-intents/{flow_id}/confirm-email",
                    json={"code": code},
                )
            self.assertEqual(confirm_response.status_code, 200)
            status_response = await client.get(
                f"/web/registration-intents/{flow_id}/status",
            )
        self.assertEqual(status_response.status_code, 200)
        status_data = status_response.json()["data"]
        self.assertEqual(status_data["state"], "confirmed")
        self.assertEqual(
            set(status_data),
            {"state", "expires_at", "registration", "account_next_step"},
        )
        combined_logs = " ".join(logs.output)
        self.assertNotIn(self.email, combined_logs)
        self.assertNotIn(code, combined_logs)
        self.assertNotIn(flow_id, combined_logs)

    async def test_unknown_flow_is_generic_and_migration_is_head(self) -> None:
        async with AsyncSessionLocal() as session:
            with self.assertRaises(HTTPException) as resend_error:
                await service.resend_code(session, "x" * 43, "192.0.2.10")
            with self.assertRaises(HTTPException) as confirm_error:
                await service.confirm_email(
                    session,
                    "x" * 43,
                    "123456",
                    "192.0.2.10",
                )
            actual = await session.scalar(text("SELECT version_num FROM alembic_version"))
        self.assertEqual(resend_error.exception.detail, service.FLOW_UNAVAILABLE_DETAIL)
        self.assertEqual(confirm_error.exception.detail, service.INVALID_CODE_DETAIL)
        expected = ScriptDirectory.from_config(Config("alembic.ini")).get_current_head()
        self.assertEqual(actual, expected)


if __name__ == "__main__":
    unittest.main()
