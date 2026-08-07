from __future__ import annotations

import logging
import unittest
from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, patch
from uuid import UUID, uuid4

import httpx
from fastapi import BackgroundTasks, Response
from sqlalchemy import delete, event, func, select, update

from app.api import privacy as privacy_api
from app.core.tokens import create_access_token
from app.db.models.auth import AuthSession, PrivacyAccessCode, PrivacyAccessSession
from app.db.models.avatar import ProfileAvatar
from app.db.models.core import (
    AppUser,
    Community,
    CommunityMembership,
    DeviceToken,
    Event,
    EventCategory,
    EventRegistration,
    EventRegistrationAnswer,
    EventRegistrationForm,
    EventRegistrationFormField,
    EventRegistrationOptionSelection,
    LegalAcceptance,
    LegalDocument,
    PrivacyDestructionEvidence,
    PrivacyRequest,
    Profile,
    SyncedContact,
)
from app.db.session import AsyncSessionLocal, engine
from app.main import app
from app.schemas.privacy import PrivacyAccessRequest
from app.services import privacy_access as service
from app.services.auth_tokens import hash_token
from app.services.email_delivery import EmailSendResult
from app.services.privacy_email_service import PrivacyEmailDeliveryError


class PrivacySelfServiceAccessTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        service._privacy_email_rate_limiter = None
        self.marker = uuid4().hex[:12]
        self.now = datetime.now(UTC).replace(microsecond=0)
        self.user_id = uuid4()
        self.other_user_id = uuid4()
        self.erased_user_id = uuid4()
        self.community_id = uuid4()
        self.event_id = uuid4()
        self.registration_id = uuid4()
        self.other_registration_id = uuid4()
        self.questionnaire_form_id = uuid4()
        self.questionnaire_field_id = uuid4()
        self.legal_document_id = uuid4()
        self.email = f"privacy-{self.marker}@example.invalid"
        self.other_email = f"privacy-other-{self.marker}@example.invalid"
        self.erased_email = f"privacy-erased-{self.marker}@example.invalid"
        self.profile_only_email = f"privacy-profile-{self.marker}@example.invalid"
        phone_suffix = f"{int(self.marker[:8], 16) % 10**7:07d}"
        self.phone = f"+7900{phone_suffix}"
        self.other_phone = f"+7901{phone_suffix}"
        self.deliveries: list[tuple[str, str]] = []

        def capture_delivery(**kwargs):
            self.deliveries.append((kwargs["to_address"], kwargs["code"]))
            return EmailSendResult(sent=True, disabled=False)

        self.delivery_patcher = patch(
            "app.services.privacy_access.send_privacy_access_code",
            side_effect=capture_delivery,
        )
        self.delivery_patcher.start()

        async with AsyncSessionLocal() as session:
            async with session.begin():
                session.add_all(
                    [
                        Community(
                            id=self.community_id,
                            name="Synthetic privacy community",
                            city="Moscow",
                            slug=f"privacy-{self.marker}",
                        ),
                        AppUser(
                            id=self.user_id,
                            email=self.email,
                            phone=self.phone,
                            account_origin="web_guest",
                            claim_state="unclaimed",
                            status="suspended",
                        ),
                        AppUser(
                            id=self.other_user_id,
                            email=self.other_email,
                            phone=self.other_phone,
                            account_origin="migration",
                            claim_state="legacy_external",
                            status="active",
                        ),
                        AppUser(
                            id=self.erased_user_id,
                            email=self.erased_email,
                            account_origin="migration",
                            claim_state="legacy_external",
                            status="inactive",
                            erased_at=self.now,
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
            async with session.begin():
                session.add_all(
                    [
                        Profile(
                            user_id=self.user_id,
                            community_id=self.community_id,
                            full_name="Synthetic Subject",
                            first_name="Synthetic",
                            last_name="Subject",
                            email="profile-subject@example.invalid",
                            phone="+79000000003",
                            city="Moscow",
                        ),
                        Profile(
                            user_id=self.other_user_id,
                            community_id=self.community_id,
                            full_name="Synthetic Other",
                            email=self.profile_only_email,
                        ),
                        CommunityMembership(
                            community_id=self.community_id,
                            user_id=self.user_id,
                            role="member",
                            status="active",
                            joined_at=self.now,
                        ),
                        CommunityMembership(
                            community_id=self.community_id,
                            user_id=self.other_user_id,
                            role="member",
                            status="active",
                            joined_at=self.now,
                        ),
                        Event(
                            id=self.event_id,
                            community_id=self.community_id,
                            title="Synthetic privacy event",
                            starts_at=self.now + timedelta(days=2),
                            category="community",
                            registration_mode="internal_free",
                            status="published",
                            visibility="public",
                        ),
                        LegalDocument(
                            id=self.legal_document_id,
                            document_type="privacy_policy",
                            version=f"privacy-{self.marker}",
                            title="Synthetic privacy policy",
                            content_hash=f"sha256:{self.marker}",
                            published_url="https://example.invalid/privacy",
                            effective_at=self.now - timedelta(days=1),
                        ),
                    ],
                )
            async with session.begin():
                session.add_all(
                    [
                        EventRegistration(
                            id=self.registration_id,
                            event_id=self.event_id,
                            user_id=self.user_id,
                            status="confirmed",
                            source_channel="mobile",
                            seats_count=1,
                        ),
                        EventRegistration(
                            id=self.other_registration_id,
                            event_id=self.event_id,
                            user_id=self.other_user_id,
                            status="confirmed",
                            source_channel="mobile",
                            seats_count=2,
                        ),
                        PrivacyRequest(
                            user_id=self.user_id,
                            community_id=self.community_id,
                            request_type="correction",
                            message="Synthetic own request",
                            status="open",
                        ),
                        DeviceToken(
                            user_id=self.user_id,
                            platform="ios",
                            expo_push_token=f"ExponentPushToken[{self.marker}]",
                            device_id="synthetic-device",
                            app_version="1.2.3",
                            build_version="123",
                            environment="development",
                        ),
                        DeviceToken(
                            user_id=self.other_user_id,
                            platform="android",
                            expo_push_token=f"ExponentPushToken[other-{self.marker}]",
                            environment="development",
                        ),
                        SyncedContact(
                            user_id=self.user_id,
                            name="Synthetic Third Party",
                            phone_hash=f"phone-hash-{self.marker}",
                            email_hash=f"email-hash-{self.marker}",
                        ),
                        ProfileAvatar(
                            user_id=self.user_id,
                            object_key=f"avatars/{self.marker}/secret-key",
                            content_type="image/png",
                            size_bytes=1234,
                            etag=f"etag-{self.marker}",
                            status="active",
                            confirmed_at=self.now,
                        ),
                    ],
                )
            async with session.begin():
                questionnaire = EventRegistrationForm(
                    id=self.questionnaire_form_id,
                    event_id=self.event_id,
                    channel="web",
                    version=1,
                    purpose="Ordinary privacy export context",
                    status="draft",
                )
                session.add(questionnaire)
                await session.flush()
                session.add(
                    EventRegistrationFormField(
                        id=self.questionnaire_field_id,
                        form_id=self.questionnaire_form_id,
                        field_key="arrival_note",
                        field_type="short_text",
                        label="Arrival note",
                        required=False,
                        purpose="Coordinate event arrival",
                        retention_days=14,
                        options_payload=[],
                        validation_payload={},
                        data_category="ordinary",
                        sort_order=0,
                    ),
                )
                await session.flush()
                questionnaire.status = "published"
                questionnaire.published_at = self.now
            async with session.begin():
                session.add_all(
                    [
                        EventRegistrationAnswer(
                            registration_id=self.registration_id,
                            field_id=self.questionnaire_field_id,
                            value_payload="Own arrival answer",
                            created_at=self.now,
                            purge_at=self.now + timedelta(days=14),
                        ),
                        EventRegistrationAnswer(
                            registration_id=self.other_registration_id,
                            field_id=self.questionnaire_field_id,
                            value_payload="Other arrival answer",
                            created_at=self.now,
                            purge_at=self.now + timedelta(days=14),
                        ),
                    ],
                )
            async with session.begin():
                session.add_all(
                    [
                        EventRegistrationOptionSelection(
                            registration_id=self.registration_id,
                            title_snapshot="Own option",
                            option_type_snapshot="participation",
                            quantity=1,
                            unit_price_amount=0,
                            total_amount=0,
                            currency="RUB",
                            counts_toward_capacity=True,
                            seats_count=1,
                            is_donation=False,
                        ),
                        EventRegistrationOptionSelection(
                            registration_id=self.other_registration_id,
                            title_snapshot="Other option",
                            option_type_snapshot="participation",
                            quantity=1,
                            unit_price_amount=0,
                            total_amount=0,
                            currency="RUB",
                            counts_toward_capacity=True,
                            seats_count=1,
                            is_donation=False,
                        ),
                        LegalAcceptance(
                            user_id=self.user_id,
                            registration_id=self.registration_id,
                            legal_document_id=self.legal_document_id,
                            accepted_at=self.now,
                            acceptance_method="authenticated_action",
                            source_channel="mobile",
                            evidence_version="synthetic-v1",
                        ),
                    ],
                )

        self.client = httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app),
            base_url="http://testserver",
        )

    async def asyncTearDown(self) -> None:
        await self.client.aclose()
        self.delivery_patcher.stop()
        async with AsyncSessionLocal() as session:
            async with session.begin():
                await session.execute(
                    delete(AppUser).where(
                        AppUser.id.in_(
                            [self.user_id, self.other_user_id, self.erased_user_id],
                        ),
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
        await engine.dispose()

    async def _request_code(self, email: str | None = None) -> str:
        response = await self.client.post(
            "/privacy/access/request",
            json={"email": email or self.email},
        )
        self.assertEqual(response.status_code, 202)
        self.assertTrue(response.json()["data"]["accepted"])
        return self.deliveries[-1][1]

    async def _privacy_token(self, email: str | None = None) -> str:
        resolved_email = email or self.email
        code = await self._request_code(resolved_email)
        response = await self.client.post(
            "/privacy/access/confirm",
            json={"email": resolved_email, "code": code},
        )
        self.assertEqual(response.status_code, 200)
        return response.json()["data"]["privacy_session_token"]

    @staticmethod
    def _bearer(token: str) -> dict[str, str]:
        return {"Authorization": f"Bearer {token}"}

    async def test_access_route_only_schedules_the_same_background_handler(self) -> None:
        scheduled = []
        with patch("app.services.privacy_access.send_privacy_access_code") as delivery:
            for email in (
                self.email,
                f"missing-{self.marker}@example.invalid",
            ):
                background_tasks = BackgroundTasks()
                response = Response()
                result = await privacy_api.request_privacy_access(
                    PrivacyAccessRequest(email=email),
                    background_tasks,
                    response,
                )

                self.assertTrue(result.data.accepted)
                self.assertEqual(response.headers["Cache-Control"], "no-store")
                self.assertEqual(len(background_tasks.tasks), 1)
                scheduled.append(background_tasks.tasks[0])

        delivery.assert_not_called()
        self.assertIs(scheduled[0].func, service.process_privacy_access_request)
        self.assertIs(scheduled[1].func, service.process_privacy_access_request)
        self.assertEqual(scheduled[0].kwargs, {"normalized_email": self.email})
        self.assertEqual(
            scheduled[1].kwargs,
            {"normalized_email": f"missing-{self.marker}@example.invalid"},
        )

    async def test_background_handler_opens_its_own_database_session(self) -> None:
        background_session = object()

        class SessionContext:
            async def __aenter__(self):
                return background_session

            async def __aexit__(self, _exc_type, _exc, _traceback):
                return False

        processor = AsyncMock()
        with patch.object(service, "AsyncSessionLocal", return_value=SessionContext()), patch.object(
            service,
            "_process_privacy_access_request",
            processor,
        ):
            await service.process_privacy_access_request(
                normalized_email=self.email,
            )

        processor.assert_awaited_once_with(
            background_session,
            normalized_email=self.email,
        )

    async def test_access_request_is_generic_and_uses_only_canonical_email(self) -> None:
        known = await self.client.post(
            "/privacy/access/request",
            json={"email": self.email.upper()},
        )
        unknown = await self.client.post(
            "/privacy/access/request",
            json={"email": f"missing-{self.marker}@example.invalid"},
        )
        erased = await self.client.post(
            "/privacy/access/request",
            json={"email": self.erased_email},
        )
        profile_only = await self.client.post(
            "/privacy/access/request",
            json={"email": self.profile_only_email},
        )

        for response in (known, unknown, erased, profile_only):
            self.assertEqual(response.status_code, 202)
            self.assertEqual(response.json()["data"], {"accepted": True})
            self.assertIsNone(response.json()["error"])
            self.assertEqual(set(response.json()["meta"]), {"request_id"})
        self.assertEqual([item[0] for item in self.deliveries], [self.email])
        async with AsyncSessionLocal() as session:
            code_counts = {
                user_id: await session.scalar(
                    select(func.count(PrivacyAccessCode.id)).where(
                        PrivacyAccessCode.user_id == user_id,
                    ),
                )
                for user_id in (
                    self.user_id,
                    self.other_user_id,
                    self.erased_user_id,
                )
            }
        self.assertEqual(code_counts[self.user_id], 1)
        self.assertEqual(code_counts[self.other_user_id], 0)
        self.assertEqual(code_counts[self.erased_user_id], 0)

    async def test_passwordless_suspended_user_needs_no_membership(self) -> None:
        async with AsyncSessionLocal() as session:
            async with session.begin():
                await session.execute(
                    delete(CommunityMembership).where(
                        CommunityMembership.user_id == self.user_id,
                    ),
                )
        code = await self._request_code()
        self.assertRegex(code, r"^[0-9]{6}$")

    async def test_rate_limit_smtp_disabled_and_failure_remain_generic(self) -> None:
        responses = [
            await self.client.post(
                "/privacy/access/request",
                json={"email": self.email},
            )
            for _ in range(6)
        ]
        self.assertTrue(all(item.status_code == 202 for item in responses))
        self.assertTrue(all(item.json()["data"] == {"accepted": True} for item in responses))
        self.assertEqual(len(self.deliveries), 5)
        async with AsyncSessionLocal() as session:
            created_before_rate_limit = await session.scalar(
                select(func.count(PrivacyAccessCode.id)).where(
                    PrivacyAccessCode.user_id == self.user_id,
                ),
            )
        self.assertEqual(created_before_rate_limit, 5)

        service._privacy_email_rate_limiter = None
        with patch(
            "app.services.privacy_access.send_privacy_access_code",
            return_value=EmailSendResult(sent=False, disabled=True),
        ):
            disabled = await self.client.post(
                "/privacy/access/request",
                json={"email": self.other_email},
            )
        self.assertEqual(disabled.status_code, 202)

        service._privacy_email_rate_limiter = None
        with patch(
            "app.services.privacy_access.send_privacy_access_code",
            side_effect=PrivacyEmailDeliveryError("Synthetic provider failure"),
        ), self.assertLogs("app.services.privacy_access", level=logging.WARNING) as logs:
            failed = await self.client.post(
                "/privacy/access/request",
                json={"email": self.other_email},
            )
        self.assertEqual(failed.status_code, 202)
        log_text = " ".join(logs.output)
        self.assertNotIn(self.other_email, log_text)
        self.assertNotIn("Synthetic provider failure", log_text)

        async with AsyncSessionLocal() as session:
            usable = await session.scalar(
                select(func.count(PrivacyAccessCode.id)).where(
                    PrivacyAccessCode.user_id == self.other_user_id,
                    PrivacyAccessCode.consumed_at.is_(None),
                ),
            )
        self.assertEqual(usable, 0)

    async def test_privacy_credentials_and_data_are_not_cacheable(self) -> None:
        requested = await self.client.post(
            "/privacy/access/request",
            json={"email": self.email},
        )
        self.assertEqual(requested.headers.get("Cache-Control"), "no-store")
        code = self.deliveries[-1][1]

        confirmed = await self.client.post(
            "/privacy/access/confirm",
            json={"email": self.email, "code": code},
        )
        self.assertEqual(confirmed.status_code, 200)
        self.assertEqual(confirmed.headers.get("Cache-Control"), "no-store")
        token = confirmed.json()["data"]["privacy_session_token"]

        summary = await self.client.get(
            "/privacy/data-summary",
            headers=self._bearer(token),
        )
        self.assertEqual(summary.status_code, 200)
        self.assertEqual(summary.headers.get("Cache-Control"), "no-store")

        exported = await self.client.post(
            "/privacy/data-export",
            headers=self._bearer(token),
            json={"format": "json"},
        )
        self.assertEqual(exported.status_code, 200)
        self.assertEqual(exported.headers.get("Cache-Control"), "no-store")

    async def test_codes_are_hash_only_user_domain_separated_and_replaced(self) -> None:
        with patch("app.services.privacy_access.secrets.randbelow", return_value=123456):
            first = await self._request_code(self.email)
            second_user = await self._request_code(self.other_email)
        self.assertEqual(first, "123456")
        self.assertEqual(second_user, "123456")

        async with AsyncSessionLocal() as session:
            subject_row = await session.scalar(
                select(PrivacyAccessCode)
                .where(PrivacyAccessCode.user_id == self.user_id)
                .order_by(PrivacyAccessCode.created_at.desc()),
            )
            other_row = await session.scalar(
                select(PrivacyAccessCode)
                .where(PrivacyAccessCode.user_id == self.other_user_id)
                .order_by(PrivacyAccessCode.created_at.desc()),
            )
        self.assertNotEqual(subject_row.code_hash, first)
        self.assertNotEqual(subject_row.code_hash, other_row.code_hash)
        self.assertTrue(service._verify_privacy_code(self.user_id, first, subject_row.code_hash))
        self.assertFalse(service._verify_privacy_code(self.other_user_id, first, subject_row.code_hash))

        replacement = await self._request_code(self.email)
        async with AsyncSessionLocal() as session:
            rows = list(
                await session.scalars(
                    select(PrivacyAccessCode)
                    .where(PrivacyAccessCode.user_id == self.user_id)
                    .order_by(PrivacyAccessCode.created_at),
                ),
            )
        self.assertIsNotNone(rows[0].consumed_at)
        self.assertIsNone(rows[-1].consumed_at)
        self.assertNotIn(replacement, {row.code_hash for row in rows})

    async def test_confirm_errors_are_safe_and_attempt_limited(self) -> None:
        code = await self._request_code()
        error_shapes = []
        for _ in range(5):
            wrong = await self.client.post(
                "/privacy/access/confirm",
                json={"email": self.email, "code": "000000" if code != "000000" else "999999"},
            )
            self.assertEqual(wrong.status_code, 400)
            error_shapes.append(wrong.json()["error"])
        exhausted = await self.client.post(
            "/privacy/access/confirm",
            json={"email": self.email, "code": code},
        )
        unknown = await self.client.post(
            "/privacy/access/confirm",
            json={"email": f"missing-{self.marker}@example.invalid", "code": code},
        )
        erased = await self.client.post(
            "/privacy/access/confirm",
            json={"email": self.erased_email, "code": code},
        )
        for response in (exhausted, unknown, erased):
            self.assertEqual(response.status_code, 400)
            self.assertEqual(response.json()["error"], error_shapes[0])
        async with AsyncSessionLocal() as session:
            row = await session.scalar(
                select(PrivacyAccessCode)
                .where(PrivacyAccessCode.user_id == self.user_id)
                .order_by(PrivacyAccessCode.created_at.desc()),
            )
        self.assertEqual(row.attempt_count, 5)

    async def test_expired_and_consumed_codes_are_rejected(self) -> None:
        code = await self._request_code()
        async with AsyncSessionLocal() as session:
            async with session.begin():
                await session.execute(
                    update(PrivacyAccessCode)
                    .where(PrivacyAccessCode.user_id == self.user_id)
                    .values(
                        created_at=self.now - timedelta(hours=1),
                        expires_at=self.now - timedelta(minutes=30),
                        updated_at=self.now,
                    ),
                )
        expired = await self.client.post(
            "/privacy/access/confirm",
            json={"email": self.email, "code": code},
        )
        self.assertEqual(expired.json()["error"]["code"], "invalid_or_expired_privacy_code")

        code = await self._request_code()
        successful = await self.client.post(
            "/privacy/access/confirm",
            json={"email": self.email, "code": code},
        )
        self.assertEqual(successful.status_code, 200)
        consumed = await self.client.post(
            "/privacy/access/confirm",
            json={"email": self.email, "code": code},
        )
        self.assertEqual(consumed.json()["error"], expired.json()["error"])

    async def test_confirm_issues_hash_only_session_and_revokes_old_session(self) -> None:
        old_token = "synthetic-old-privacy-token"
        async with AsyncSessionLocal() as session:
            async with session.begin():
                session.add(
                    PrivacyAccessSession(
                        user_id=self.user_id,
                        token_hash=service._privacy_session_hash(old_token),
                        scope="privacy_self_service",
                        expires_at=self.now + timedelta(minutes=15),
                        created_at=self.now,
                    ),
                )
        code = await self._request_code()
        confirmed = await self.client.post(
            "/privacy/access/confirm",
            json={"email": self.email, "code": code},
        )
        data = confirmed.json()["data"]
        self.assertEqual(set(data), {"privacy_session_token", "token_type", "scope", "expires_at"})
        self.assertEqual(data["scope"], "privacy_self_service")
        token = data["privacy_session_token"]

        async with AsyncSessionLocal() as session:
            code_row = await session.scalar(
                select(PrivacyAccessCode)
                .where(PrivacyAccessCode.user_id == self.user_id)
                .order_by(PrivacyAccessCode.created_at.desc()),
            )
            sessions = list(
                await session.scalars(
                    select(PrivacyAccessSession)
                    .where(PrivacyAccessSession.user_id == self.user_id)
                    .order_by(PrivacyAccessSession.created_at),
                ),
            )
        self.assertIsNotNone(code_row.consumed_at)
        self.assertIsNotNone(sessions[0].revoked_at)
        self.assertNotEqual(sessions[-1].token_hash, token)
        self.assertEqual(sessions[-1].token_hash, service._privacy_session_hash(token))

    async def test_privacy_session_boundaries_last_used_expiry_revocation_and_erasure(self) -> None:
        token = await self._privacy_token()
        summary = await self.client.get(
            "/privacy/data-summary",
            headers=self._bearer(token),
        )
        self.assertEqual(summary.status_code, 200)
        async with AsyncSessionLocal() as session:
            row = await session.scalar(
                select(PrivacyAccessSession).where(
                    PrivacyAccessSession.token_hash == service._privacy_session_hash(token),
                ),
            )
        self.assertIsNotNone(row.last_used_at)

        ordinary_jwt = create_access_token(self.other_user_id)
        jwt_summary = await self.client.get(
            "/privacy/data-summary",
            headers=self._bearer(ordinary_jwt),
        )
        self.assertEqual(jwt_summary.json()["error"]["code"], "privacy_session_required")
        for path in ("/auth/me", "/me/contact-visibility", "/admin/privacy/requests"):
            rejected = await self.client.get(path, headers=self._bearer(token))
            self.assertIn(rejected.status_code, {401, 422})
            self.assertNotEqual(rejected.status_code, 200)

        async with AsyncSessionLocal() as session:
            async with session.begin():
                await session.execute(
                    update(PrivacyAccessSession)
                    .where(PrivacyAccessSession.token_hash == service._privacy_session_hash(token))
                    .values(
                        created_at=self.now - timedelta(hours=1),
                        expires_at=self.now - timedelta(minutes=30),
                    ),
                )
        expired = await self.client.get(
            "/privacy/data-summary",
            headers=self._bearer(token),
        )
        self.assertEqual(expired.json()["error"]["code"], "privacy_session_expired")

        token = await self._privacy_token()
        async with AsyncSessionLocal() as session:
            async with session.begin():
                await session.execute(
                    update(PrivacyAccessSession)
                    .where(PrivacyAccessSession.token_hash == service._privacy_session_hash(token))
                    .values(revoked_at=datetime.now(UTC)),
                )
        revoked = await self.client.get(
            "/privacy/data-summary",
            headers=self._bearer(token),
        )
        self.assertEqual(revoked.json()["error"]["code"], "privacy_session_revoked")

        token = await self._privacy_token()
        async with AsyncSessionLocal() as session:
            async with session.begin():
                await session.execute(
                    update(AppUser)
                    .where(AppUser.id == self.user_id)
                    .values(erased_at=self.now),
                )
        erased = await self.client.get(
            "/privacy/data-summary",
            headers=self._bearer(token),
        )
        self.assertEqual(erased.json()["error"]["code"], "privacy_session_revoked")

    async def test_summary_is_counts_only_own_scoped_and_never_queries_prayer(self) -> None:
        token = await self._privacy_token()
        statements: list[str] = []

        def capture_statement(_conn, _cursor, statement, _params, _context, _many):
            statements.append(statement)

        event.listen(engine.sync_engine, "before_cursor_execute", capture_statement)
        try:
            response = await self.client.get(
                "/privacy/data-summary",
                headers=self._bearer(token),
            )
        finally:
            event.remove(engine.sync_engine, "before_cursor_execute", capture_statement)
        self.assertEqual(response.status_code, 200)
        data = response.json()["data"]
        categories = {item["code"]: item["record_count"] for item in data["categories"]}
        self.assertEqual(
            set(categories),
            {
                "account",
                "profile",
                "memberships",
                "event_registrations",
                "registration_options",
                "questionnaire_answers",
                "legal_acceptances",
                "privacy_requests",
                "device_metadata",
                "synced_contacts_summary",
                "avatar_metadata",
            },
        )
        self.assertEqual(categories["event_registrations"], 1)
        self.assertEqual(categories["registration_options"], 1)
        self.assertEqual(categories["questionnaire_answers"], 1)
        serialized = response.text
        for forbidden in (
            self.email,
            self.phone,
            "Synthetic Subject",
            f"ExponentPushToken[{self.marker}]",
            f"phone-hash-{self.marker}",
            "secret-key",
        ):
            self.assertNotIn(forbidden, serialized)
        self.assertIn("prayer_activity", serialized)
        self.assertFalse(any("prayer_activity_logs" in item.lower() for item in statements))

    async def test_export_is_allowlisted_own_only_and_never_queries_prayer(self) -> None:
        token = await self._privacy_token()
        statements: list[str] = []

        def capture_statement(_conn, _cursor, statement, _params, _context, _many):
            statements.append(statement)

        event.listen(engine.sync_engine, "before_cursor_execute", capture_statement)
        try:
            response = await self.client.post(
                "/privacy/data-export",
                headers=self._bearer(token),
                json={"format": "json"},
            )
        finally:
            event.remove(engine.sync_engine, "before_cursor_execute", capture_statement)
        self.assertEqual(response.status_code, 200)
        data = response.json()["data"]
        self.assertEqual(data["export_version"], "privacy-self-service-v1")
        self.assertEqual(data["account"]["id"], str(self.user_id))
        self.assertNotIn("password_hash", data["account"])
        self.assertEqual(len(data["memberships"]), 1)
        self.assertEqual(
            [item["registration_id"] for item in data["event_registrations"]],
            [str(self.registration_id)],
        )
        self.assertEqual(
            [item["registration_id"] for item in data["registration_options"]],
            [str(self.registration_id)],
        )
        self.assertEqual(
            data["questionnaire_answers"],
            [
                {
                    "registration_id": str(self.registration_id),
                    "field_id": str(self.questionnaire_field_id),
                    "field_key": "arrival_note",
                    "question_label": "Arrival note",
                    "field_purpose": "Coordinate event arrival",
                    "value": "Own arrival answer",
                    "created_at": self.now.isoformat().replace("+00:00", "Z"),
                    "purge_at": (self.now + timedelta(days=14)).isoformat().replace("+00:00", "Z"),
                },
            ],
        )
        self.assertEqual(len(data["legal_acceptances"]), 1)
        self.assertEqual(data["synced_contacts_summary"], {"record_count": 1})
        serialized = response.text
        for forbidden in (
            f"ExponentPushToken[{self.marker}]",
            f"phone-hash-{self.marker}",
            f"email-hash-{self.marker}",
            f"avatars/{self.marker}/secret-key",
            f"etag-{self.marker}",
            "signed_url",
            "password_hash",
            str(self.other_registration_id),
            "Other option",
            "Other arrival answer",
        ):
            self.assertNotIn(forbidden, serialized)
        excluded = {item["code"] for item in data["excluded_categories"]}
        self.assertTrue(
            {"prayer_activity", "feedback_content", "avatar_binary", "synced_contact_hashes"}
            <= excluded,
        )
        self.assertFalse(any("prayer_activity_logs" in item.lower() for item in statements))

        jwt_export = await self.client.post(
            "/privacy/data-export",
            headers=self._bearer(create_access_token(self.other_user_id)),
            json={"format": "json"},
        )
        self.assertEqual(jwt_export.json()["error"]["code"], "privacy_session_required")

    async def test_privacy_session_creates_verified_request_without_destructive_effects(self) -> None:
        token = await self._privacy_token()
        async with AsyncSessionLocal() as session:
            async with session.begin():
                session.add(
                    AuthSession(
                        user_id=self.user_id,
                        refresh_token_hash=hash_token(f"synthetic-refresh-{self.marker}"),
                        expires_at=self.now + timedelta(days=1),
                    ),
                )
        created = await self.client.post(
            "/privacy/requests",
            headers=self._bearer(token),
            json={"request_type": "deletion"},
        )
        self.assertEqual(created.status_code, 201)
        request_id = UUID(created.json()["data"]["id"])

        spoofed = await self.client.post(
            "/privacy/requests",
            headers=self._bearer(token),
            json={"request_type": "other", "user_id": str(self.other_user_id)},
        )
        self.assertEqual(spoofed.status_code, 422)

        async with AsyncSessionLocal() as session:
            row = await session.get(PrivacyRequest, request_id)
            user = await session.get(AppUser, self.user_id)
            registration = await session.get(EventRegistration, self.registration_id)
            active_auth_sessions = await session.scalar(
                select(func.count(AuthSession.id)).where(
                    AuthSession.user_id == self.user_id,
                    AuthSession.revoked_at.is_(None),
                ),
            )
            evidence_count = await session.scalar(
                select(func.count(PrivacyDestructionEvidence.id)),
            )
        self.assertEqual(row.user_id, self.user_id)
        self.assertIsNotNone(row.identity_verified_at)
        self.assertIsNone(row.processing_stopped_at)
        self.assertIsNone(row.execution_started_at)
        self.assertIsNone(row.completed_at)
        self.assertIsNone(row.destruction_evidence_id)
        self.assertEqual(user.status, "suspended")
        self.assertIsNone(user.deletion_requested_at)
        self.assertIsNone(user.erased_at)
        self.assertEqual(registration.status, "confirmed")
        self.assertEqual(active_auth_sessions, 1)
        self.assertEqual(evidence_count, 0)

        lifecycle_calls = (
            ("confirm-erasure", {"json": {"confirmation": "delete_my_data"}}),
            ("cancel-erasure", {}),
        )
        for suffix, request_kwargs in lifecycle_calls:
            for headers in (
                None,
                self._bearer(create_access_token(self.user_id)),
            ):
                rejected = await self.client.post(
                    f"/privacy/requests/{request_id}/{suffix}",
                    headers=headers,
                    **request_kwargs,
                )
                self.assertEqual(rejected.status_code, 401)
                self.assertEqual(
                    rejected.json()["error"]["code"],
                    "privacy_session_required",
                )

    async def test_existing_authenticated_request_semantics_and_get_remain_auth_only(self) -> None:
        headers = self._bearer(create_access_token(self.other_user_id))
        created = await self.client.post(
            "/privacy/requests",
            headers=headers,
            json={"request_type": "other", "message": "Synthetic ordinary request"},
        )
        self.assertEqual(created.status_code, 201)
        request_id = UUID(created.json()["data"]["id"])
        async with AsyncSessionLocal() as session:
            row = await session.get(PrivacyRequest, request_id)
        self.assertEqual(row.user_id, self.other_user_id)
        self.assertIsNone(row.identity_verified_at)

        listed = await self.client.get("/privacy/requests", headers=headers)
        self.assertEqual(listed.status_code, 200)
        self.assertIn(str(request_id), [item["id"] for item in listed.json()["data"]])

        privacy_token = await self._privacy_token(self.other_email)
        rejected = await self.client.get(
            "/privacy/requests",
            headers=self._bearer(privacy_token),
        )
        self.assertEqual(rejected.status_code, 401)

    async def test_validation_rejects_non_ascii_or_non_six_digit_codes_and_unknown_fields(self) -> None:
        for code in ("12345", "1234567", "１２３４５６", "abcdef", "123 456"):
            response = await self.client.post(
                "/privacy/access/confirm",
                json={"email": self.email, "code": code},
            )
            self.assertEqual(response.status_code, 422)
            self.assertEqual(response.json()["error"]["code"], "validation_error")
        trimmed = await self.client.post(
            "/privacy/access/confirm",
            json={"email": self.email, "code": " 123456 "},
        )
        self.assertEqual(trimmed.status_code, 400)
        extra = await self.client.post(
            "/privacy/access/request",
            json={"email": self.email, "user_id": str(self.other_user_id)},
        )
        self.assertEqual(extra.status_code, 422)


if __name__ == "__main__":
    unittest.main()
