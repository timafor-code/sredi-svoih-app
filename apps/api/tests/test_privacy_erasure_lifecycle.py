from __future__ import annotations

import inspect as pyinspect
import logging
import unittest
from datetime import UTC, datetime, timedelta
from unittest.mock import patch
from uuid import UUID, uuid4

import httpx
import jwt
from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy import delete, func, inspect, select
from sqlalchemy.exc import IntegrityError

from app.core.config import get_settings
from app.core.passwords import hash_password
from app.core.tokens import create_access_token, decode_access_token
from app.db.models.auth import (
    AuthEmailVerificationCode,
    AuthSession,
    AuthSetPasswordCode,
    PasswordResetCode,
    PrivacyAccessCode,
    PrivacyAccessSession,
    WebRegistrationVerificationCode,
)
from app.db.models.core import (
    AppUser,
    Community,
    Event,
    EventCategory,
    EventRegistration,
    EventRegistrationOptionSelection,
    LegalDocument,
    PrivacyDestructionEvidence,
    PrivacyRequest,
    WebRegistrationIntent,
)
from app.db.session import AsyncSessionLocal, engine
from app.main import app
from app.schemas.registrations import RegisterEventRequest
from app.services import privacy_access, registrations, web_registration
from app.services.auth_tokens import hash_token
from app.services.email_delivery import EmailSendResult
from app.services.privacy_erasure_email_service import (
    PrivacyErasureEmailDeliveryError,
)


class PrivacyErasureLifecycleTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        privacy_access._privacy_email_rate_limiter = None
        web_registration._rate_limiter = None
        self.marker = uuid4().hex[:12]
        self.now = datetime.now(UTC).replace(microsecond=0)
        self.community_id = uuid4()
        self.legal_document_id = uuid4()
        self.user_ids: list[UUID] = []
        self.request_ids: list[UUID] = []
        self.event_ids: list[UUID] = []
        self.email_mock = patch(
            "app.services.privacy_erasure.send_privacy_erasure_accepted",
            return_value=EmailSendResult(sent=True, disabled=False),
        ).start()
        self.addCleanup(patch.stopall)

        async with AsyncSessionLocal() as session:
            async with session.begin():
                session.add(
                    Community(
                        id=self.community_id,
                        name="Synthetic erasure community",
                        city="Moscow",
                        slug=f"erasure-{self.marker}",
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
                session.add(
                    LegalDocument(
                        id=self.legal_document_id,
                        document_type="event_registration_consent",
                        version=f"erasure-{self.marker}",
                        title="Synthetic registration consent",
                        content_hash=f"sha256:{self.marker}",
                        published_url="https://example.invalid/consent",
                        effective_at=self.now - timedelta(days=1),
                    ),
                )

        self.client = httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app),
            base_url="http://testserver",
        )

    async def asyncTearDown(self) -> None:
        await self.client.aclose()
        try:
            async with AsyncSessionLocal() as session:
                async with session.begin():
                    if self.request_ids:
                        await session.execute(
                            delete(PrivacyRequest).where(
                                PrivacyRequest.id.in_(self.request_ids),
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

    async def _add_user(
        self,
        *,
        status: str = "active",
        password: bool = True,
    ) -> tuple[UUID, str, str]:
        user_id = uuid4()
        email = f"erasure-{self.marker}-{len(self.user_ids)}@example.invalid"
        phone = f"+7900{len(self.user_ids) + int(self.marker[:6], 16) % 10**7:07d}"[-12:]
        if not phone.startswith("+7"):
            phone = f"+790{len(self.user_ids)}{int(self.marker[:7], 16) % 10**7:07d}"
        self.user_ids.append(user_id)
        async with AsyncSessionLocal() as session:
            async with session.begin():
                session.add(
                    AppUser(
                        id=user_id,
                        email=email,
                        phone=phone,
                        password_hash=hash_password("Synthetic-password-1")
                        if password
                        else None,
                        account_origin="password_signup",
                        claim_state="claimed",
                        claimed_at=self.now,
                        status=status,
                    ),
                )
        return user_id, email, phone

    async def _add_request(
        self,
        user_id: UUID,
        *,
        request_type: str = "deletion",
        identity_verified: bool = True,
        **values,
    ) -> UUID:
        request_id = uuid4()
        self.request_ids.append(request_id)
        async with AsyncSessionLocal() as session:
            async with session.begin():
                session.add(
                    PrivacyRequest(
                        id=request_id,
                        user_id=user_id,
                        request_type=request_type,
                        status=values.pop("status", "open"),
                        identity_verified_at=self.now if identity_verified else None,
                        created_at=self.now,
                        updated_at=self.now,
                        **values,
                    ),
                )
        return request_id

    async def _add_privacy_session(self, user_id: UUID) -> str:
        token = f"privacy-token-{uuid4().hex}"
        async with AsyncSessionLocal() as session:
            async with session.begin():
                session.add(
                    PrivacyAccessSession(
                        user_id=user_id,
                        token_hash=privacy_access._privacy_session_hash(token),
                        scope="privacy_self_service",
                        expires_at=self.now + timedelta(hours=1),
                        created_at=self.now,
                    ),
                )
        return token

    async def _add_event(
        self,
        *,
        starts_at: datetime,
        registration_mode: str = "internal_free",
        capacity: int | None = None,
        price_amount: int | None = None,
        web_visibility: str = "disabled",
    ) -> UUID:
        event_id = uuid4()
        self.event_ids.append(event_id)
        async with AsyncSessionLocal() as session:
            async with session.begin():
                session.add(
                    Event(
                        id=event_id,
                        community_id=self.community_id,
                        title=f"Synthetic erasure event {len(self.event_ids)}",
                        starts_at=starts_at,
                        category="community",
                        registration_mode=registration_mode,
                        capacity=capacity,
                        price_amount=price_amount,
                        status="published",
                        visibility="public",
                        web_visibility=web_visibility,
                    ),
                )
        return event_id

    async def _add_registration(
        self,
        *,
        event_id: UUID,
        user_id: UUID,
        status: str,
        payment_status: str = "not_required",
        payment_id: str | None = None,
    ) -> UUID:
        registration_id = uuid4()
        async with AsyncSessionLocal() as session:
            async with session.begin():
                session.add(
                    EventRegistration(
                        id=registration_id,
                        event_id=event_id,
                        user_id=user_id,
                        status=status,
                        source_channel="mobile",
                        seats_count=1,
                        payment_status=payment_status,
                        payment_id=payment_id,
                    ),
                )
        return registration_id

    async def _confirm(self, request_id: UUID, token: str) -> httpx.Response:
        return await self.client.post(
            f"/privacy/requests/{request_id}/confirm-erasure",
            headers={"Authorization": f"Bearer {token}"},
            json={"confirmation": "delete_my_data"},
        )

    @staticmethod
    def _legacy_access_token(user_id: UUID) -> str:
        settings = get_settings()
        issued_at = datetime.now(UTC)
        payload: dict[str, object] = {
            "sub": str(user_id),
            "iat": issued_at,
            "exp": issued_at
            + timedelta(minutes=settings.api_access_token_ttl_minutes),
            "typ": "access",
        }
        if settings.api_jwt_issuer:
            payload["iss"] = settings.api_jwt_issuer
        if settings.api_jwt_audience:
            payload["aud"] = settings.api_jwt_audience
        return jwt.encode(payload, settings.api_jwt_secret, algorithm="HS256")

    @staticmethod
    def _supabase_access_token(user_id: UUID, signing_key: str) -> str:
        issued_at = datetime.now(UTC)
        return jwt.encode(
            {
                "sub": str(user_id),
                "iat": issued_at,
                "exp": issued_at + timedelta(minutes=15),
            },
            signing_key,
            algorithm="HS256",
        )

    async def _new_privacy_token_via_email(self, email: str) -> str:
        deliveries: list[str] = []

        def capture(**kwargs):
            deliveries.append(kwargs["code"])
            return EmailSendResult(sent=True, disabled=False)

        with patch(
            "app.services.privacy_access.send_privacy_access_code",
            side_effect=capture,
        ):
            requested = await self.client.post(
                "/privacy/access/request",
                json={"email": email},
            )
        self.assertEqual(requested.status_code, 202)
        self.assertEqual(len(deliveries), 1)
        confirmed = await self.client.post(
            "/privacy/access/confirm",
            json={"email": email, "code": deliveries[0]},
        )
        self.assertEqual(confirmed.status_code, 200)
        return confirmed.json()["data"]["privacy_session_token"]

    async def _add_credentials(self, user_id: UUID) -> dict[str, UUID]:
        ids = {
            "auth_session": uuid4(),
            "privacy_session": uuid4(),
            "email_code": uuid4(),
            "reset_code": uuid4(),
            "set_password_code": uuid4(),
            "privacy_code": uuid4(),
        }
        expires_at = self.now + timedelta(hours=1)
        async with AsyncSessionLocal() as session:
            async with session.begin():
                session.add_all(
                    [
                        AuthSession(
                            id=ids["auth_session"],
                            user_id=user_id,
                            refresh_token_hash=f"refresh-{uuid4().hex}",
                            expires_at=expires_at,
                            created_at=self.now,
                            updated_at=self.now,
                        ),
                        PrivacyAccessSession(
                            id=ids["privacy_session"],
                            user_id=user_id,
                            token_hash=f"privacy-session-{uuid4().hex}",
                            scope="privacy_self_service",
                            expires_at=expires_at,
                            created_at=self.now,
                        ),
                        AuthEmailVerificationCode(
                            id=ids["email_code"],
                            user_id=user_id,
                            code_hash=f"email-code-{uuid4().hex}",
                            expires_at=expires_at,
                            created_at=self.now,
                            updated_at=self.now,
                        ),
                        PasswordResetCode(
                            id=ids["reset_code"],
                            user_id=user_id,
                            code_hash=f"reset-code-{uuid4().hex}",
                            expires_at=expires_at,
                            created_at=self.now,
                            updated_at=self.now,
                        ),
                        AuthSetPasswordCode(
                            id=ids["set_password_code"],
                            user_id=user_id,
                            code_hash=f"set-code-{uuid4().hex}",
                            expires_at=expires_at,
                            created_at=self.now,
                            updated_at=self.now,
                        ),
                        PrivacyAccessCode(
                            id=ids["privacy_code"],
                            user_id=user_id,
                            code_hash=f"privacy-code-{uuid4().hex}",
                            expires_at=expires_at,
                            created_at=self.now,
                            updated_at=self.now,
                        ),
                    ],
                )
        return ids

    async def test_migration_metadata_constraints_queue_index_and_defaults(self) -> None:
        script = ScriptDirectory.from_config(Config("alembic.ini"))
        expected_head = script.get_current_head()
        self.assertIsNotNone(expected_head)
        notification_revision = script.get_revision("20260806200000")
        audit_revision = script.get_revision("20260806190000")
        worker_revision = script.get_revision("20260806180000")
        token_revision = script.get_revision("20260806170000")
        lifecycle_revision = script.get_revision("20260806160000")
        self.assertEqual(notification_revision.down_revision, "20260806190000")
        self.assertEqual(audit_revision.down_revision, "20260806180000")
        self.assertEqual(worker_revision.down_revision, "20260806170000")
        self.assertEqual(token_revision.down_revision, "20260806160000")
        self.assertEqual(lifecycle_revision.down_revision, "20260806120000")

        async with engine.connect() as connection:
            metadata = await connection.run_sync(self._read_lifecycle_metadata)
        self.assertTrue(
            {"pre_deletion_user_status", "cancelled_at"}.issubset(
                metadata["columns"],
            ),
        )
        self.assertIn("auth_token_version", metadata["app_user_columns"])
        self.assertIn(
            "app_users_auth_token_version_nonnegative_check",
            metadata["app_user_constraints"],
        )
        self.assertTrue(
            {
                "privacy_requests_pre_deletion_status_not_empty",
                "privacy_requests_pre_deletion_status_not_pending",
                "privacy_requests_processing_requires_pre_status",
                "privacy_requests_cancelled_requires_processing_stop",
                "privacy_requests_cancelled_after_processing_stop",
                "privacy_requests_cancelled_without_completion",
                "privacy_requests_cancelled_without_evidence",
                "privacy_requests_cancelled_before_execution",
            }.issubset(metadata["constraints"]),
        )
        queue_index = metadata["queue_index"]
        self.assertEqual(queue_index["column_names"], ["created_at", "id"])
        predicate = str(queue_index["dialect_options"]["postgresql_where"])
        for fragment in (
            "request_type = 'deletion'",
            "processing_stopped_at IS NOT NULL",
            "cancelled_at IS NULL",
            "completed_at IS NULL",
        ):
            self.assertIn(fragment.lower(), predicate.lower())

        lifecycle_downgrade_source = pyinspect.getsource(
            lifecycle_revision.module.downgrade,
        )
        self.assertIn(
            "privacy_requests_deletion_queue_idx",
            lifecycle_downgrade_source,
        )
        self.assertIn(
            'drop_column("privacy_requests", "cancelled_at")',
            lifecycle_downgrade_source,
        )
        self.assertIn(
            'drop_column("privacy_requests", "pre_deletion_user_status")',
            lifecycle_downgrade_source,
        )
        self.assertNotIn(
            "due_at",
            pyinspect.getsource(lifecycle_revision.module.upgrade),
        )
        self.assertNotIn(
            "retention",
            pyinspect.getsource(lifecycle_revision.module.upgrade),
        )
        token_upgrade_source = pyinspect.getsource(token_revision.module.upgrade)
        token_downgrade_source = pyinspect.getsource(token_revision.module.downgrade)
        self.assertIn("auth_token_version", token_upgrade_source)
        self.assertIn("auth_token_version >= 0", token_upgrade_source)
        self.assertIn(
            'drop_column("app_users", "auth_token_version")',
            token_downgrade_source,
        )

        user_id, _, _ = await self._add_user()
        request_id = await self._add_request(user_id)
        async with AsyncSessionLocal() as session:
            row = await session.get(PrivacyRequest, request_id)
            user = await session.get(AppUser, user_id)
        self.assertIsNone(row.pre_deletion_user_status)
        self.assertIsNone(row.cancelled_at)
        self.assertEqual(user.auth_token_version, 0)

    @staticmethod
    def _read_lifecycle_metadata(sync_connection) -> dict[str, object]:
        inspector = inspect(sync_connection)
        indexes = inspector.get_indexes("privacy_requests")
        return {
            "app_user_columns": {
                item["name"] for item in inspector.get_columns("app_users")
            },
            "app_user_constraints": {
                item["name"]
                for item in inspector.get_check_constraints("app_users")
            },
            "columns": {
                item["name"] for item in inspector.get_columns("privacy_requests")
            },
            "constraints": {
                item["name"]
                for item in inspector.get_check_constraints("privacy_requests")
            },
            "queue_index": next(
                item
                for item in indexes
                if item["name"] == "privacy_requests_deletion_queue_idx"
            ),
        }

    async def test_lifecycle_constraints_reject_invalid_states(self) -> None:
        user_id, _, _ = await self._add_user()
        base = {
            "user_id": user_id,
            "request_type": "deletion",
            "status": "open",
            "identity_verified_at": self.now,
            "created_at": self.now,
            "updated_at": self.now,
        }
        invalid_rows = [
            PrivacyRequest(**base, pre_deletion_user_status=" "),
            PrivacyRequest(**base, pre_deletion_user_status="deletion_pending"),
            PrivacyRequest(
                **base,
                processing_stopped_at=self.now + timedelta(seconds=1),
            ),
            PrivacyRequest(
                **base,
                pre_deletion_user_status="active",
                cancelled_at=self.now + timedelta(seconds=1),
            ),
            PrivacyRequest(
                **base,
                pre_deletion_user_status="active",
                processing_stopped_at=self.now + timedelta(seconds=2),
                cancelled_at=self.now + timedelta(seconds=1),
            ),
            PrivacyRequest(
                **base,
                pre_deletion_user_status="active",
                processing_stopped_at=self.now + timedelta(seconds=1),
                execution_started_at=self.now + timedelta(seconds=2),
                cancelled_at=self.now + timedelta(seconds=3),
            ),
            PrivacyRequest(
                **base,
                pre_deletion_user_status="active",
                processing_stopped_at=self.now + timedelta(seconds=1),
                execution_started_at=self.now + timedelta(seconds=2),
                completed_at=self.now + timedelta(seconds=3),
                cancelled_at=self.now + timedelta(seconds=4),
            ),
        ]
        async with AsyncSessionLocal() as session:
            async with session.begin():
                for row in invalid_rows:
                    with self.assertRaises(IntegrityError):
                        async with session.begin_nested():
                            session.add(row)
                            await session.flush()

    async def test_confirm_authorization_validation_and_safe_ownership(self) -> None:
        user_id, _, _ = await self._add_user()
        other_id, _, _ = await self._add_user()
        deletion_id = await self._add_request(user_id)
        correction_id = await self._add_request(
            user_id,
            request_type="correction",
        )
        token = await self._add_privacy_session(user_id)

        missing = await self.client.post(
            f"/privacy/requests/{deletion_id}/confirm-erasure",
            json={"confirmation": "delete_my_data"},
        )
        jwt = await self.client.post(
            f"/privacy/requests/{deletion_id}/confirm-erasure",
            headers={"Authorization": f"Bearer {create_access_token(user_id)}"},
            json={"confirmation": "delete_my_data"},
        )
        foreign = await self.client.post(
            f"/privacy/requests/{deletion_id}/confirm-erasure",
            headers={
                "Authorization": f"Bearer {await self._add_privacy_session(other_id)}",
            },
            json={"confirmation": "delete_my_data"},
        )
        non_deletion = await self.client.post(
            f"/privacy/requests/{correction_id}/confirm-erasure",
            headers={"Authorization": f"Bearer {token}"},
            json={"confirmation": "delete_my_data"},
        )
        wrong_literal = await self.client.post(
            f"/privacy/requests/{deletion_id}/confirm-erasure",
            headers={"Authorization": f"Bearer {token}"},
            json={"confirmation": "please delete"},
        )
        unknown = await self.client.post(
            f"/privacy/requests/{deletion_id}/confirm-erasure",
            headers={"Authorization": f"Bearer {token}"},
            json={"confirmation": "delete_my_data", "user_id": str(user_id)},
        )

        self.assertEqual(missing.status_code, 401)
        self.assertEqual(jwt.status_code, 401)
        self.assertEqual(jwt.json()["error"]["code"], "privacy_session_required")
        self.assertEqual(foreign.status_code, 404)
        self.assertEqual(foreign.json()["error"]["code"], "not_found")
        self.assertEqual(non_deletion.status_code, 409)
        self.assertEqual(wrong_literal.status_code, 422)
        self.assertEqual(unknown.status_code, 422)

    async def test_confirm_transition_revokes_credentials_cancels_future_and_releases_capacity(self) -> None:
        user_id, email, _ = await self._add_user()
        other_id, _, _ = await self._add_user()
        request_id = await self._add_request(user_id, identity_verified=False)
        credentials = await self._add_credentials(user_id)
        token = await self._add_privacy_session(user_id)

        capacity_event = await self._add_event(
            starts_at=self.now + timedelta(days=2),
            capacity=1,
        )
        pending_event = await self._add_event(starts_at=self.now + timedelta(days=3))
        waitlist_event = await self._add_event(starts_at=self.now + timedelta(days=4))
        past_event = await self._add_event(starts_at=self.now - timedelta(days=2))
        attended_event = await self._add_event(starts_at=self.now - timedelta(days=3))
        no_show_event = await self._add_event(starts_at=self.now - timedelta(days=4))
        other_event = await self._add_event(starts_at=self.now + timedelta(days=5))

        registration_ids = {
            "confirmed": await self._add_registration(
                event_id=capacity_event,
                user_id=user_id,
                status="confirmed",
            ),
            "pending": await self._add_registration(
                event_id=pending_event,
                user_id=user_id,
                status="pending",
            ),
            "waitlisted": await self._add_registration(
                event_id=waitlist_event,
                user_id=user_id,
                status="waitlisted",
            ),
            "past": await self._add_registration(
                event_id=past_event,
                user_id=user_id,
                status="pending",
            ),
            "attended": await self._add_registration(
                event_id=attended_event,
                user_id=user_id,
                status="attended",
            ),
            "no_show": await self._add_registration(
                event_id=no_show_event,
                user_id=user_id,
                status="no_show",
            ),
            "other": await self._add_registration(
                event_id=other_event,
                user_id=other_id,
                status="confirmed",
            ),
        }

        flow_id = "f" * 43
        intent_id = uuid4()
        async with AsyncSessionLocal() as session:
            async with session.begin():
                session.add(
                    WebRegistrationIntent(
                        id=intent_id,
                        flow_token_hash=hash_token(flow_id),
                        event_id=capacity_event,
                        matched_user_id=user_id,
                        first_name="Synthetic",
                        last_name="Subject",
                        email_normalized=email,
                        phone_normalized="+79000000123",
                        seats_count=1,
                        option_payload=[],
                        answer_payload=None,
                        legal_acceptance_payload=[],
                        account_choice="without_password",
                        status="email_verification_required",
                        idempotency_key_hash=f"intent-key-{uuid4().hex}",
                        request_fingerprint_hash=f"fingerprint-{uuid4().hex}",
                        expires_at=self.now + timedelta(hours=1),
                        created_at=self.now,
                    ),
                )
                await session.flush()
                session.add(
                    WebRegistrationVerificationCode(
                        registration_intent_id=intent_id,
                        code_hash=web_registration._verification_code_hash(
                            intent_id,
                            "123456",
                        ),
                        expires_at=self.now + timedelta(minutes=10),
                        created_at=self.now,
                    ),
                )
            evidence_before = await session.scalar(
                select(func.count()).select_from(PrivacyDestructionEvidence),
            )

        confirmed = await self._confirm(request_id, token)
        self.assertEqual(confirmed.status_code, 200)
        self.assertEqual(confirmed.headers["Cache-Control"], "no-store")
        data = confirmed.json()["data"]
        self.assertEqual(
            set(data),
            {
                "request_id",
                "state",
                "processing_stopped_at",
                "cancelled_at",
                "registrations_require_reregistration_after_cancel",
            },
        )
        self.assertEqual(data["state"], "deletion_pending")
        self.assertIsNone(data["cancelled_at"])
        self.assertTrue(data["registrations_require_reregistration_after_cancel"])
        self.assertNotIn(email, confirmed.text)
        self.assertNotIn(token, confirmed.text)

        stopped_flow = await self.client.post(
            f"/web/registration-intents/{flow_id}/confirm-email",
            json={"code": "123456"},
        )
        self.assertEqual(stopped_flow.status_code, 400)
        self.assertEqual(
            stopped_flow.json()["error"]["code"],
            "invalid_verification_code",
        )

        async with AsyncSessionLocal() as session:
            user = await session.get(AppUser, user_id)
            request = await session.get(PrivacyRequest, request_id)
            registrations_by_id = {
                key: await session.get(EventRegistration, value)
                for key, value in registration_ids.items()
            }
            auth_session = await session.get(AuthSession, credentials["auth_session"])
            privacy_session = await session.get(
                PrivacyAccessSession,
                credentials["privacy_session"],
            )
            email_code = await session.get(
                AuthEmailVerificationCode,
                credentials["email_code"],
            )
            reset_code = await session.get(
                PasswordResetCode,
                credentials["reset_code"],
            )
            set_code = await session.get(
                AuthSetPasswordCode,
                credentials["set_password_code"],
            )
            privacy_code = await session.get(
                PrivacyAccessCode,
                credentials["privacy_code"],
            )
            self.assertIsNone(await session.get(WebRegistrationIntent, intent_id))
            evidence_after = await session.scalar(
                select(func.count()).select_from(PrivacyDestructionEvidence),
            )

        self.assertEqual(user.status, "deletion_pending")
        self.assertEqual(user.auth_token_version, 1)
        self.assertIsNotNone(user.deletion_requested_at)
        self.assertEqual(request.pre_deletion_user_status, "active")
        self.assertIsNotNone(request.identity_verified_at)
        self.assertIsNotNone(request.processing_stopped_at)
        self.assertIsNone(request.execution_started_at)
        self.assertIsNone(request.completed_at)
        self.assertIsNone(request.destruction_evidence_id)
        self.assertIsNone(request.due_at)
        self.assertEqual(evidence_after, evidence_before)
        for key in ("confirmed", "pending", "waitlisted"):
            self.assertEqual(registrations_by_id[key].status, "cancelled")
            self.assertIsNotNone(registrations_by_id[key].cancelled_at)
        self.assertEqual(registrations_by_id["past"].status, "pending")
        self.assertEqual(registrations_by_id["attended"].status, "attended")
        self.assertEqual(registrations_by_id["no_show"].status, "no_show")
        self.assertEqual(registrations_by_id["other"].status, "confirmed")
        self.assertIsNotNone(auth_session.revoked_at)
        self.assertIsNotNone(privacy_session.revoked_at)
        for code in (email_code, reset_code, set_code, privacy_code):
            self.assertIsNotNone(code.consumed_at)
        self.email_mock.assert_called_once_with(to_address=email)

        revoked = await self.client.get(
            "/privacy/data-summary",
            headers={"Authorization": f"Bearer {token}"},
        )
        self.assertEqual(revoked.status_code, 401)
        self.assertEqual(revoked.json()["error"]["code"], "privacy_session_revoked")

        async with AsyncSessionLocal() as session:
            async with session.begin():
                other = await session.get(AppUser, other_id)
                replacement = await registrations.register_user_for_event(
                    session,
                    user=other,
                    event_id=capacity_event,
                    payload=RegisterEventRequest(),
                    source_channel="mobile",
                )
                self.assertEqual(replacement.status, "confirmed")

        first_cancelled_at = registrations_by_id["confirmed"].cancelled_at
        replay_token = await self._add_privacy_session(user_id)
        replay = await self._confirm(request_id, replay_token)
        self.assertEqual(replay.status_code, 200)
        self.email_mock.assert_called_once()
        async with AsyncSessionLocal() as session:
            replayed_registration = await session.get(
                EventRegistration,
                registration_ids["confirmed"],
            )
            replayed_request = await session.get(PrivacyRequest, request_id)
            replayed_user = await session.get(AppUser, user_id)
        self.assertEqual(replayed_registration.cancelled_at, first_cancelled_at)
        self.assertEqual(replayed_request.pre_deletion_user_status, "active")
        self.assertEqual(replayed_user.auth_token_version, 1)

    async def test_financial_indicators_fail_closed_without_partial_mutation(self) -> None:
        cases = ("paid", "donation", "payment_id", "priced_option")
        for case in cases:
            with self.subTest(case=case):
                user_id, _, _ = await self._add_user()
                request_id = await self._add_request(user_id)
                token = await self._add_privacy_session(user_id)
                event_id = await self._add_event(
                    starts_at=self.now + timedelta(days=2),
                    registration_mode="internal_paid"
                    if case == "paid"
                    else "internal_free",
                )
                registration_id = await self._add_registration(
                    event_id=event_id,
                    user_id=user_id,
                    status="confirmed",
                    payment_status="pending" if case == "paid" else "not_required",
                    payment_id="synthetic-payment" if case == "payment_id" else None,
                )
                if case in {"donation", "priced_option"}:
                    async with AsyncSessionLocal() as session:
                        async with session.begin():
                            session.add(
                                EventRegistrationOptionSelection(
                                    registration_id=registration_id,
                                    title_snapshot="Synthetic financial option",
                                    option_type_snapshot=(
                                        "donation"
                                        if case == "donation"
                                        else "participation"
                                    ),
                                    quantity=1,
                                    unit_price_amount=(
                                        0 if case == "donation" else 100
                                    ),
                                    total_amount=0 if case == "donation" else 100,
                                    currency="RUB",
                                    counts_toward_capacity=False,
                                    seats_count=0,
                                    is_donation=case == "donation",
                                ),
                            )

                blocked = await self._confirm(request_id, token)
                self.assertEqual(blocked.status_code, 409)
                self.assertEqual(
                    blocked.json()["error"]["code"],
                    "privacy_erasure_manual_review_required",
                )
                self.assertNotIn("synthetic-payment", blocked.text)
                async with AsyncSessionLocal() as session:
                    user = await session.get(AppUser, user_id)
                    request = await session.get(PrivacyRequest, request_id)
                    registration = await session.get(
                        EventRegistration,
                        registration_id,
                    )
                    privacy_session = await session.scalar(
                        select(PrivacyAccessSession).where(
                            PrivacyAccessSession.user_id == user_id,
                            PrivacyAccessSession.token_hash
                            == privacy_access._privacy_session_hash(token),
                        ),
                    )
                self.assertEqual(user.status, "active")
                self.assertEqual(user.auth_token_version, 0)
                self.assertIsNone(user.deletion_requested_at)
                self.assertIsNone(request.processing_stopped_at)
                self.assertIsNone(request.pre_deletion_user_status)
                self.assertEqual(registration.status, "confirmed")
                self.assertIsNone(privacy_session.revoked_at)
        self.email_mock.assert_not_called()

    async def test_processing_stop_keeps_public_auth_generic_and_blocks_new_work(self) -> None:
        user_id, email, phone = await self._add_user()
        request_id = await self._add_request(user_id)
        token = await self._add_privacy_session(user_id)
        event_id = await self._add_event(
            starts_at=self.now + timedelta(days=2),
            web_visibility="unlisted",
        )
        confirmed = await self._confirm(request_id, token)
        self.assertEqual(confirmed.status_code, 200)

        login = await self.client.post(
            "/auth/login",
            json={"email": email, "password": "Synthetic-password-1"},
        )
        self.assertEqual(login.status_code, 401)

        with (
            patch("app.services.auth.send_password_reset_email") as reset_email,
            patch("app.services.auth.send_email_verification_email") as verify_email,
            patch("app.services.auth.send_set_password_email") as set_email,
        ):
            reset = await self.client.post(
                "/auth/request-password-reset",
                json={"email": email},
            )
            verify = await self.client.post(
                "/auth/request-email-verification",
                json={"email": email},
            )
            async with AsyncSessionLocal() as session:
                async with session.begin():
                    user = await session.get(AppUser, user_id, with_for_update=True)
                    user.password_hash = None
            set_password = await self.client.post(
                "/auth/request-set-password",
                json={"email": email},
            )
        self.assertEqual(reset.json(), set_password.json())
        self.assertEqual(verify.json(), set_password.json())
        reset_email.assert_not_called()
        verify_email.assert_not_called()
        set_email.assert_not_called()
        async with AsyncSessionLocal() as session:
            self.assertEqual(
                await session.scalar(
                    select(func.count()).select_from(PasswordResetCode).where(
                        PasswordResetCode.user_id == user_id,
                        PasswordResetCode.consumed_at.is_(None),
                    ),
                ),
                0,
            )
            self.assertEqual(
                await session.scalar(
                    select(func.count())
                    .select_from(AuthEmailVerificationCode)
                    .where(
                        AuthEmailVerificationCode.user_id == user_id,
                        AuthEmailVerificationCode.consumed_at.is_(None),
                    ),
                ),
                0,
            )
            self.assertEqual(
                await session.scalar(
                    select(func.count()).select_from(AuthSetPasswordCode).where(
                        AuthSetPasswordCode.user_id == user_id,
                        AuthSetPasswordCode.consumed_at.is_(None),
                    ),
                ),
                0,
            )

        jwt_headers = {"Authorization": f"Bearer {create_access_token(user_id)}"}
        registration = await self.client.post(
            f"/events/{event_id}/register",
            headers=jwt_headers,
            json={},
        )
        profile = await self.client.patch(
            "/me/profile",
            headers=jwt_headers,
            json={"first_name": "Blocked"},
        )
        device = await self.client.post(
            "/me/device-tokens",
            headers=jwt_headers,
            json={
                "expo_push_token": f"ExponentPushToken[{self.marker}]",
                "platform": "ios",
                "environment": "development",
            },
        )
        invite = await self.client.post(
            "/auth/accept-invite",
            headers=jwt_headers,
            json={"invite_code": "synthetic-invite"},
        )
        for response in (registration, profile, device, invite):
            self.assertEqual(response.status_code, 401)

        payload = {
            "event_id": str(event_id),
            "occurrence_id": None,
            "first_name": "Synthetic",
            "last_name": "Subject",
            "phone": phone,
            "email": email,
            "seats_count": 1,
            "option_selections": [],
            "answers": [],
            "legal_acceptances": [
                {
                    "document_id": str(self.legal_document_id),
                    "content_hash": f"sha256:{self.marker}",
                },
            ],
            "account_choice": "without_password",
            "idempotency_key": f"erasure-intent-{self.marker}",
        }
        public_intent = await self.client.post(
            "/web/registration-intents",
            json=payload,
        )
        self.assertEqual(public_intent.status_code, 409)
        self.assertEqual(
            public_intent.json()["error"]["code"],
            "identity_confirmation_unavailable",
        )
        async with AsyncSessionLocal() as session:
            self.assertEqual(
                await session.scalar(
                    select(func.count()).select_from(WebRegistrationIntent).where(
                        WebRegistrationIntent.email_normalized == email,
                    ),
                ),
                0,
            )

        new_token = await self._new_privacy_token_via_email(email)
        summary = await self.client.get(
            "/privacy/data-summary",
            headers={"Authorization": f"Bearer {new_token}"},
        )
        self.assertEqual(summary.status_code, 200)

    async def test_cancel_restores_original_status_without_restoring_access_or_registrations(self) -> None:
        for original_status in ("active", "suspended"):
            with self.subTest(original_status=original_status):
                user_id, email, _ = await self._add_user(status=original_status)
                request_id = await self._add_request(user_id)
                credentials = await self._add_credentials(user_id)
                token = await self._add_privacy_session(user_id)
                event_id = await self._add_event(
                    starts_at=self.now + timedelta(days=2),
                )
                registration_id = await self._add_registration(
                    event_id=event_id,
                    user_id=user_id,
                    status="confirmed",
                )
                confirmed = await self._confirm(request_id, token)
                self.assertEqual(confirmed.status_code, 200)

                cancel_token = await self._new_privacy_token_via_email(email)
                cancelled = await self.client.post(
                    f"/privacy/requests/{request_id}/cancel-erasure",
                    headers={"Authorization": f"Bearer {cancel_token}"},
                )
                self.assertEqual(cancelled.status_code, 200)
                self.assertEqual(cancelled.headers["Cache-Control"], "no-store")
                data = cancelled.json()["data"]
                self.assertEqual(data["state"], "cancelled")
                self.assertIsNotNone(data["processing_stopped_at"])
                self.assertIsNotNone(data["cancelled_at"])
                self.assertTrue(
                    data["registrations_require_reregistration_after_cancel"],
                )

                async with AsyncSessionLocal() as session:
                    user = await session.get(AppUser, user_id)
                    request = await session.get(PrivacyRequest, request_id)
                    registration = await session.get(
                        EventRegistration,
                        registration_id,
                    )
                    auth_session = await session.get(
                        AuthSession,
                        credentials["auth_session"],
                    )
                    reset_code = await session.get(
                        PasswordResetCode,
                        credentials["reset_code"],
                    )
                self.assertEqual(user.status, original_status)
                self.assertEqual(user.auth_token_version, 1)
                self.assertIsNone(user.deletion_requested_at)
                self.assertEqual(request.status, "closed")
                self.assertEqual(request.pre_deletion_user_status, original_status)
                self.assertIsNotNone(request.processing_stopped_at)
                self.assertIsNotNone(request.cancelled_at)
                self.assertIsNotNone(request.identity_verified_at)
                self.assertEqual(registration.status, "cancelled")
                self.assertIsNotNone(auth_session.revoked_at)
                self.assertIsNotNone(reset_code.consumed_at)

                first_cancelled_at = request.cancelled_at
                replay = await self.client.post(
                    f"/privacy/requests/{request_id}/cancel-erasure",
                    headers={"Authorization": f"Bearer {cancel_token}"},
                )
                self.assertEqual(replay.status_code, 200)
                async with AsyncSessionLocal() as session:
                    replayed = await session.get(PrivacyRequest, request_id)
                self.assertEqual(replayed.cancelled_at, first_cancelled_at)

                login = await self.client.post(
                    "/auth/login",
                    json={"email": email, "password": "Synthetic-password-1"},
                )
                self.assertEqual(
                    login.status_code,
                    200 if original_status == "active" else 401,
                )

    async def test_cancel_does_not_revive_native_access_or_refresh_credentials(self) -> None:
        user_id, email, _ = await self._add_user()
        other_id, _, _ = await self._add_user()
        request_id = await self._add_request(user_id)
        privacy_token = await self._add_privacy_session(user_id)

        login = await self.client.post(
            "/auth/login",
            json={"email": email, "password": "Synthetic-password-1"},
        )
        self.assertEqual(login.status_code, 200)
        old_access_token = login.json()["access_token"]
        old_refresh_token = login.json()["refresh_token"]
        self.assertEqual(decode_access_token(old_access_token).auth_token_version, 0)
        other_access_token = create_access_token(other_id)

        before = await self.client.get(
            "/auth/me",
            headers={"Authorization": f"Bearer {old_access_token}"},
        )
        other_before = await self.client.get(
            "/auth/me",
            headers={"Authorization": f"Bearer {other_access_token}"},
        )
        self.assertEqual(before.status_code, 200)
        self.assertEqual(other_before.status_code, 200)

        confirmed = await self._confirm(request_id, privacy_token)
        self.assertEqual(confirmed.status_code, 200)
        during_pending = await self.client.get(
            "/auth/me",
            headers={"Authorization": f"Bearer {old_access_token}"},
        )
        self.assertEqual(during_pending.status_code, 401)

        cancel_token = await self._new_privacy_token_via_email(email)
        repeated = await self._confirm(request_id, cancel_token)
        self.assertEqual(repeated.status_code, 200)
        async with AsyncSessionLocal() as session:
            repeated_user = await session.get(AppUser, user_id)
        self.assertEqual(repeated_user.auth_token_version, 1)

        cancelled = await self.client.post(
            f"/privacy/requests/{request_id}/cancel-erasure",
            headers={"Authorization": f"Bearer {cancel_token}"},
        )
        self.assertEqual(cancelled.status_code, 200)

        after_cancel = await self.client.get(
            "/auth/me",
            headers={"Authorization": f"Bearer {old_access_token}"},
        )
        revoked_refresh = await self.client.post(
            "/auth/refresh",
            json={"refresh_token": old_refresh_token},
        )
        other_after = await self.client.get(
            "/auth/me",
            headers={"Authorization": f"Bearer {other_access_token}"},
        )
        self.assertEqual(after_cancel.status_code, 401)
        self.assertEqual(revoked_refresh.status_code, 401)
        self.assertEqual(other_after.status_code, 200)

        new_login = await self.client.post(
            "/auth/login",
            json={"email": email, "password": "Synthetic-password-1"},
        )
        self.assertEqual(new_login.status_code, 200)
        new_access_token = new_login.json()["access_token"]
        self.assertEqual(decode_access_token(new_access_token).auth_token_version, 1)
        current = await self.client.get(
            "/auth/me",
            headers={"Authorization": f"Bearer {new_access_token}"},
        )
        self.assertEqual(current.status_code, 200)

    async def test_legacy_native_token_is_limited_to_version_zero(self) -> None:
        user_id, _, _ = await self._add_user()
        legacy_token = self._legacy_access_token(user_id)
        decoded = decode_access_token(legacy_token)
        self.assertEqual(decoded.auth_token_version, 0)

        accepted = await self.client.get(
            "/auth/me",
            headers={"Authorization": f"Bearer {legacy_token}"},
        )
        self.assertEqual(accepted.status_code, 200)

        async with AsyncSessionLocal() as session:
            async with session.begin():
                user = await session.get(AppUser, user_id, with_for_update=True)
                user.auth_token_version = 1

        rejected = await self.client.get(
            "/auth/me",
            headers={"Authorization": f"Bearer {legacy_token}"},
        )
        self.assertEqual(rejected.status_code, 401)

    async def test_supabase_fallback_is_limited_to_version_zero(self) -> None:
        user_id, email, _ = await self._add_user()
        request_id = await self._add_request(user_id)
        privacy_token = await self._add_privacy_session(user_id)
        signing_key = f"synthetic-supabase-signing-key-{self.marker}"
        supabase_token = self._supabase_access_token(user_id, signing_key)
        bridge_settings = get_settings().model_copy(
            update={
                "migration_accept_supabase_jwt": True,
                "supabase_jwt_signing_key": signing_key,
                "supabase_jwt_issuer": "",
                "supabase_jwt_audience": "",
            },
        )

        with (
            patch(
                "app.core.authorization.get_settings",
                return_value=bridge_settings,
            ),
            patch(
                "app.core.supabase_jwt.get_settings",
                return_value=bridge_settings,
            ),
        ):
            accepted = await self.client.get(
                "/auth/me",
                headers={"Authorization": f"Bearer {supabase_token}"},
            )
            self.assertEqual(accepted.status_code, 200)

            confirmed = await self._confirm(request_id, privacy_token)
            self.assertEqual(confirmed.status_code, 200)
            cancel_token = await self._new_privacy_token_via_email(email)
            cancelled = await self.client.post(
                f"/privacy/requests/{request_id}/cancel-erasure",
                headers={"Authorization": f"Bearer {cancel_token}"},
            )
            self.assertEqual(cancelled.status_code, 200)

            rejected = await self.client.get(
                "/auth/me",
                headers={"Authorization": f"Bearer {supabase_token}"},
            )
            self.assertEqual(rejected.status_code, 401)

    async def test_cancel_rejects_foreign_started_and_completed_requests(self) -> None:
        user_id, _, _ = await self._add_user(status="deletion_pending")
        other_id, _, _ = await self._add_user()
        processing = self.now + timedelta(seconds=1)
        started_id = await self._add_request(
            user_id,
            pre_deletion_user_status="active",
            processing_stopped_at=processing,
            execution_started_at=processing + timedelta(seconds=1),
        )
        completed_id = await self._add_request(
            user_id,
            pre_deletion_user_status="active",
            processing_stopped_at=processing,
            execution_started_at=processing + timedelta(seconds=1),
            completed_at=processing + timedelta(seconds=2),
        )
        token = await self._add_privacy_session(user_id)
        jwt_cancel = await self.client.post(
            f"/privacy/requests/{started_id}/cancel-erasure",
            headers={"Authorization": f"Bearer {create_access_token(user_id)}"},
        )
        self.assertEqual(jwt_cancel.status_code, 401)
        self.assertEqual(
            jwt_cancel.json()["error"]["code"],
            "privacy_session_required",
        )
        for request_id in (started_id, completed_id):
            response = await self.client.post(
                f"/privacy/requests/{request_id}/cancel-erasure",
                headers={"Authorization": f"Bearer {token}"},
            )
            self.assertEqual(response.status_code, 409)
            self.assertEqual(
                response.json()["error"]["code"],
                "privacy_erasure_already_started",
            )

        foreign = await self.client.post(
            f"/privacy/requests/{started_id}/cancel-erasure",
            headers={
                "Authorization": f"Bearer {await self._add_privacy_session(other_id)}",
            },
        )
        self.assertEqual(foreign.status_code, 404)

    async def test_email_is_post_transition_idempotent_and_failure_is_generic(self) -> None:
        user_id, email, _ = await self._add_user()
        request_id = await self._add_request(user_id)
        token = await self._add_privacy_session(user_id)
        self.email_mock.side_effect = PrivacyErasureEmailDeliveryError(
            "Synthetic provider exception",
        )
        with self.assertLogs(
            "app.services.privacy_erasure",
            level=logging.WARNING,
        ) as logs:
            response = await self._confirm(request_id, token)
        self.assertEqual(response.status_code, 200)
        async with AsyncSessionLocal() as session:
            user = await session.get(AppUser, user_id)
            request = await session.get(PrivacyRequest, request_id)
        self.assertEqual(user.status, "deletion_pending")
        self.assertIsNotNone(request.processing_stopped_at)
        log_text = " ".join(logs.output)
        self.assertNotIn(email, log_text)
        self.assertNotIn(str(user_id), log_text)
        self.assertNotIn("Synthetic provider exception", log_text)
        self.assertNotIn("completion", log_text.lower())

        self.email_mock.side_effect = None
        replay = await self._confirm(
            request_id,
            await self._add_privacy_session(user_id),
        )
        self.assertEqual(replay.status_code, 200)
        self.assertEqual(self.email_mock.call_count, 1)


if __name__ == "__main__":
    unittest.main()
